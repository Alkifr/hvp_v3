import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import { authMe } from "../auth/authApi";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";

type RefKind =
  | "operators"
  | "aircraft-types"
  | "aircraft"
  | "aircraft-type-palette"
  | "event-types"
  | "hangars"
  | "layouts"
  | "stands"
  | "skills"
  | "persons"
  | "shifts"
  | "materials"
  | "warehouses";

type RefGroup = { label: string; items: Array<{ kind: RefKind; title: string; hint?: string }> };

const REF_GROUPS: RefGroup[] = [
  {
    label: "Авиация",
    items: [
      { kind: "operators", title: "Операторы" },
      { kind: "aircraft-types", title: "Типы ВС" },
      { kind: "aircraft", title: "Бортовые номера" },
      { kind: "aircraft-type-palette", title: "Палитра ВС", hint: "оператор × тип" }
    ]
  },
  {
    label: "Инфраструктура",
    items: [
      { kind: "hangars", title: "Ангары" },
      { kind: "layouts", title: "Варианты расстановки" },
      { kind: "stands", title: "Места (стоянки)" }
    ]
  },
  {
    label: "События",
    items: [{ kind: "event-types", title: "Типы событий" }]
  },
  {
    label: "Персонал",
    items: [
      { kind: "skills", title: "Квалификации" },
      { kind: "persons", title: "Сотрудники" },
      { kind: "shifts", title: "Смены" }
    ]
  },
  {
    label: "Снабжение",
    items: [
      { kind: "materials", title: "Материалы" },
      { kind: "warehouses", title: "Склады" }
    ]
  }
];

const REF_TITLE: Record<RefKind, string> = Object.fromEntries(
  REF_GROUPS.flatMap((g) => g.items.map((i) => [i.kind, i.title]))
) as Record<RefKind, string>;

const REF_SINGULAR: Record<RefKind, string> = {
  operators: "Оператор",
  "aircraft-types": "Тип ВС",
  aircraft: "Борт",
  "aircraft-type-palette": "Правило палитры",
  "event-types": "Тип события",
  hangars: "Ангар",
  layouts: "Вариант расстановки",
  stands: "Место (стоянка)",
  skills: "Квалификация",
  persons: "Сотрудник",
  shifts: "Смена",
  materials: "Материал",
  warehouses: "Склад"
};

function formatMinutesOfDay(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const hh = Math.floor(n / 60)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor(n % 60)
    .toString()
    .padStart(2, "0");
  return `${hh}:${mm}`;
}

function bodyTypeLabel(v: unknown): string | null {
  if (v === "NARROW_BODY") return "Узкий";
  if (v === "WIDE_BODY") return "Широкий";
  return null;
}

type Operator = { id: string; code: string; name: string; isActive: boolean };
type AircraftType = { id: string; icaoType?: string | null; name: string; manufacturer?: string | null; isActive: boolean };
type Hangar = { id: string; code: string; name: string; isActive: boolean };
type Layout = {
  id: string;
  hangarId: string;
  code: string;
  name: string;
  description?: string | null;
  widthMeters?: number | null;
  heightMeters?: number | null;
  capacitySummary?: string;
  isActive: boolean;
};
type LayoutDetail = Layout & {
  widthMeters?: number | null;
  heightMeters?: number | null;
  obstacles?: Array<{ type: string; x: number; y: number; w: number; h: number }> | null;
  stands: Array<{
    id: string;
    code: string;
    name: string;
    bodyType?: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
    rotate?: number | null;
    isActive?: boolean;
  }>;
  hangar?: Hangar;
};
type Skill = { id: string; code: string; name: string; isActive: boolean };

function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties }) {
  return <input value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} style={props.style} />;
}

function NumberInput(props: { value: number; onChange: (v: number) => void; step?: number; style?: React.CSSProperties }) {
  return (
    <input
      type="number"
      step={props.step ?? 1}
      value={Number.isFinite(props.value) ? String(props.value) : ""}
      onChange={(e) => props.onChange(Number(e.target.value))}
      style={props.style}
    />
  );
}

function BoolToggle(props: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" style={{ gap: 6 }}>
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="muted">активен</span>
    </label>
  );
}

function refNum(v: unknown, fallback = 0): number {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : fallback;
}

function refStr(v: unknown): string {
  return String(v ?? "").trim();
}

function pickCell(row: Record<string, unknown>, keys: string[]): unknown {
  const normalized = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const key of keys) {
    const found = normalized.get(key.toLowerCase());
    if (found != null && String(found).trim() !== "") return found;
  }
  return "";
}

function normalizeBodyType(v: unknown): "NARROW_BODY" | "WIDE_BODY" | null {
  const s = refStr(v).toLowerCase();
  if (!s) return null;
  if (s.includes("wide") || s.includes("шир")) return "WIDE_BODY";
  if (s.includes("narrow") || s.includes("узк")) return "NARROW_BODY";
  return null;
}

function buildLayoutImportPayload(rows: Array<Record<string, unknown>>) {
  const hangars = new Map<string, any>();
  for (const row of rows) {
    const hangarCode = refStr(pickCell(row, ["hangarCode", "код ангара", "ангар код", "ангар"]));
    const hangarName = refStr(pickCell(row, ["hangarName", "название ангара", "ангар название"])) || hangarCode;
    const layoutCode = refStr(pickCell(row, ["layoutCode", "код схемы", "код варианта", "схема код", "вариант код"]));
    const layoutName = refStr(pickCell(row, ["layoutName", "название схемы", "название варианта", "схема", "вариант"])) || layoutCode;
    const standCode = refStr(pickCell(row, ["standCode", "код места", "место код", "место"]));
    if (!hangarCode || !layoutCode || !standCode) continue;

    const hangar = hangars.get(hangarCode) ?? { code: hangarCode, name: hangarName, layouts: new Map<string, any>() };
    hangars.set(hangarCode, hangar);
    const layouts = hangar.layouts as Map<string, any>;
    const layout =
      layouts.get(layoutCode) ??
      {
        code: layoutCode,
        name: layoutName,
        description: refStr(pickCell(row, ["description", "описание"])) || undefined,
        widthMeters: refNum(pickCell(row, ["widthMeters", "ширина ангара", "ширина схемы", "width"]), 80),
        heightMeters: refNum(pickCell(row, ["heightMeters", "высота ангара", "высота схемы", "height"]), 50),
        stands: []
      };
    layouts.set(layoutCode, layout);
    layout.stands.push({
      code: standCode,
      name: refStr(pickCell(row, ["standName", "название места", "место название"])) || standCode,
      bodyType: normalizeBodyType(pickCell(row, ["bodyType", "тип фюзеляжа", "фюзеляж"])),
      x: refNum(pickCell(row, ["x", "X"])),
      y: refNum(pickCell(row, ["y", "Y"])),
      w: refNum(pickCell(row, ["w", "ширина места", "standWidth"]), 10),
      h: refNum(pickCell(row, ["h", "высота места", "standHeight"]), 10),
      rotate: refNum(pickCell(row, ["rotate", "поворот"]), 0)
    });
  }
  return {
    hangars: Array.from(hangars.values()).map((h) => ({
      code: h.code,
      name: h.name,
      layouts: Array.from((h.layouts as Map<string, any>).values())
    }))
  };
}

function LayoutSchemePreview(props: { detail?: LayoutDetail | null; selectedStandId?: string }) {
  const detail = props.detail;
  if (!detail) return <div className="muted">Выберите вариант расстановки, чтобы увидеть схему.</div>;
  const width = detail.widthMeters ?? 80;
  const height = detail.heightMeters ?? 50;
  return (
    <div className="refSchemePreview">
      <div className="refSchemePreviewHead">
        <div>
          <strong>{detail.name}</strong>
          <span className="muted"> · {detail.hangar?.name ?? "ангар"} · {detail.stands.length} мест</span>
        </div>
        <span className="muted">{width} × {height} м</span>
      </div>
      <div className="refSchemeCanvas">
        <svg viewBox={`0 0 ${width} ${height}`}>
          <rect x="0" y="0" width={width} height={height} fill="#0f172a" />
          <rect x="0.5" y="0.5" width={width - 1} height={height - 1} fill="transparent" stroke="rgba(148,163,184,0.4)" strokeWidth="0.12" />
          {detail.obstacles?.map((ob, idx) =>
            ob.type === "rect" ? (
              <rect key={idx} x={ob.x} y={ob.y} width={ob.w} height={ob.h} fill="rgba(71,85,105,0.65)" stroke="rgba(226,232,240,0.32)" strokeWidth="0.08" />
            ) : null
          )}
          {detail.stands.map((s) => {
            const selected = s.id === props.selectedStandId;
            const fill = s.bodyType === "WIDE_BODY" ? "rgba(249,115,22,0.78)" : s.bodyType === "NARROW_BODY" ? "rgba(37,99,235,0.78)" : "rgba(34,197,94,0.72)";
            return (
              <g key={s.id} transform={`rotate(${s.rotate ?? 0} ${s.x + s.w / 2} ${s.y + s.h / 2})`}>
                <title>{s.code} · {s.name} · {bodyTypeLabel(s.bodyType) ?? "Любой"}</title>
                <rect
                  x={s.x + 0.08}
                  y={s.y + 0.08}
                  width={s.w - 0.16}
                  height={s.h - 0.16}
                  rx="0.35"
                  fill={fill}
                  stroke={selected ? "#facc15" : "rgba(226,232,240,0.72)"}
                  strokeWidth={selected ? 0.4 : 0.1}
                />
                <text x={s.x + s.w / 2} y={s.y + s.h / 2} fill="white" fontSize="2" textAnchor="middle" dominantBaseline="middle" style={{ userSelect: "none", fontWeight: 700 }}>
                  {s.code}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function ReferenceView() {
  const [kind, setKind] = useState<RefKind>("operators");
  const [search, setSearch] = useState<string>("");
  const qc = useQueryClient();

  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => authMe(), retry: 0, staleTime: 60_000 });
  const me = meQ.data && (meQ.data as any).ok ? (meQ.data as any).user : null;
  const isAdmin = Boolean(me?.roles?.includes("ADMIN"));
  const canWrite = Boolean(me?.roles?.includes("ADMIN") || me?.roles?.includes("PLANNER"));

  const url = useMemo(() => `/api/ref/${kind}`, [kind]);

  // зависимости для dropdown
  const operatorsQ = useQuery({ queryKey: ["ref", "operators"], queryFn: () => apiGet<Operator[]>("/api/ref/operators") });
  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftType[]>("/api/ref/aircraft-types")
  });
  const hangarsQ = useQuery({ queryKey: ["ref", "hangars"], queryFn: () => apiGet<Hangar[]>("/api/ref/hangars") });
  const skillsQ = useQuery({ queryKey: ["ref", "skills"], queryFn: () => apiGet<Skill[]>("/api/ref/skills") });

  const [filterHangarId, setFilterHangarId] = useState<string>("");
  const [filterLayoutId, setFilterLayoutId] = useState<string>("");

  const listUrl = useMemo(() => {
    if (kind === "layouts" && filterHangarId) return `/api/ref/layouts?hangarId=${encodeURIComponent(filterHangarId)}`;
    if (kind === "stands" && filterLayoutId) return `/api/ref/stands?layoutId=${encodeURIComponent(filterLayoutId)}`;
    return url;
  }, [kind, filterHangarId, filterLayoutId, url]);

  const listQ = useQuery({
    queryKey: ["ref", kind, filterHangarId, filterLayoutId],
    queryFn: () => apiGet<any[]>(listUrl)
  });

  const layoutsForStandsQ = useQuery({
    queryKey: ["ref", "layouts", filterHangarId],
    queryFn: () => apiGet<Layout[]>(filterHangarId ? `/api/ref/layouts?hangarId=${encodeURIComponent(filterHangarId)}` : "/api/ref/layouts"),
    enabled: kind === "stands" || kind === "layouts"
  });

  const createM = useMutation({
    mutationFn: (payload: any) => apiPost<any>(url, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ref", kind] });
      await qc.invalidateQueries({ queryKey: ["ref", kind, filterHangarId, filterLayoutId] });
      // HangarView использует отдельный ключ для деталей раскладки
      if (kind === "stands" || kind === "layouts") {
        await qc.invalidateQueries({ queryKey: ["layout"] });
      }
    }
  });

  const updateM = useMutation({
    mutationFn: (p: { id: string; payload: any }) => apiPatch<any>(`${url}/${p.id}`, p.payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ref", kind] });
      await qc.invalidateQueries({ queryKey: ["ref", kind, filterHangarId, filterLayoutId] });
      if (kind === "stands" || kind === "layouts") {
        await qc.invalidateQueries({ queryKey: ["layout"] });
      }
    }
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => apiDelete<any>(`${url}/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ref", kind] });
      await qc.invalidateQueries({ queryKey: ["ref", kind, filterHangarId, filterLayoutId] });
      if (kind === "stands" || kind === "layouts") {
        await qc.invalidateQueries({ queryKey: ["layout"] });
      }
    }
  });

  // Импорт CSV для "Бортовые номера"
  const [aircraftCsvFile, setAircraftCsvFile] = useState<File | null>(null);
  const [aircraftCsvText, setAircraftCsvText] = useState<string>("");
  const [aircraftCsvParseError, setAircraftCsvParseError] = useState<string | null>(null);
  const [aircraftImportOperatorId, setAircraftImportOperatorId] = useState<string>("");
  const [aircraftImportTypeId, setAircraftImportTypeId] = useState<string>("");
  const [aircraftImportResult, setAircraftImportResult] = useState<any>(null);
  const [layoutImportFile, setLayoutImportFile] = useState<File | null>(null);
  const [layoutImportRows, setLayoutImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [layoutImportError, setLayoutImportError] = useState<string | null>(null);
  const [layoutImportResult, setLayoutImportResult] = useState<any>(null);
  const [previewLayoutId, setPreviewLayoutId] = useState<string>("");
  const [previewStandId, setPreviewStandId] = useState<string>("");

  const parseTailNumbersFromCsvText = (text: string) => {
    // Минимальный парсер: берём 1-й столбец из строк; разделитель , ; \t
    const lines = text.replace(/\r/g, "").split("\n");
    const out: string[] = [];
    for (const line of lines) {
      const raw = line.trim();
      if (!raw) continue;
      // пропустим "шапку"
      const lower = raw.toLowerCase();
      if (lower.includes("tail") || lower.includes("борт") || lower.includes("tailnumber")) continue;
      const firstCell = raw.split(/[;,\\t]/)[0] ?? "";
      const v = firstCell.trim().replace(/^"+|"+$/g, "");
      if (v) out.push(v);
    }
    return out;
  };

  const aircraftImportM = useMutation({
    mutationFn: async (payload: { operatorId: string; typeId: string; tailNumbers: string[] }) =>
      apiPost("/api/ref/aircraft/import", payload),
    onSuccess: async (res) => {
      setAircraftImportResult(res);
      await qc.invalidateQueries({ queryKey: ["ref", "aircraft"] });
      await qc.invalidateQueries({ queryKey: ["ref", "aircraft", filterHangarId, filterLayoutId] });
    }
  });

  const layoutImportM = useMutation({
    mutationFn: async (payload: any) => apiPost("/api/ref/layouts/import", payload),
    onSuccess: async (res) => {
      setLayoutImportResult(res);
      await qc.invalidateQueries({ queryKey: ["ref", "hangars"] });
      await qc.invalidateQueries({ queryKey: ["ref", "layouts"] });
      await qc.invalidateQueries({ queryKey: ["ref", "stands"] });
      await qc.invalidateQueries({ queryKey: ["layout"] });
      await qc.invalidateQueries({ queryKey: ["hangar-planning"] });
    }
  });

  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState<string>("");

  // формы (минимально достаточные поля + зависимости)
  const [fCode, setFCode] = useState("");
  const [fName, setFName] = useState("");
  const [fIsActive, setFIsActive] = useState(true);
  const [fIcaoType, setFIcaoType] = useState("");
  const [fManufacturer, setFManufacturer] = useState("");
  const [fTailNumber, setFTailNumber] = useState("");
  const [fSerialNumber, setFSerialNumber] = useState("");
  const [fOperatorId, setFOperatorId] = useState("");
  const [fTypeId, setFTypeId] = useState("");
  const [fColor, setFColor] = useState("#3b82f6");
  const [fHangarId, setFHangarId] = useState("");
  const [fLayoutId, setFLayoutId] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fWidth, setFWidth] = useState(60);
  const [fHeight, setFHeight] = useState(40);
  const [fX, setFX] = useState(5);
  const [fY, setFY] = useState(5);
  const [fW, setFW] = useState(18);
  const [fH, setFH] = useState(10);
  const [fRotate, setFRotate] = useState(0);
  const [fBodyType, setFBodyType] = useState<string>("");
  const [fStartMin, setFStartMin] = useState(8 * 60);
  const [fEndMin, setFEndMin] = useState(20 * 60);
  const [fUom, setFUom] = useState("EA");
  const [fPersonSkillIds, setFPersonSkillIds] = useState<string[]>([]);

  const resetFormForKind = (k: RefKind) => {
    setFIsActive(true);
    setFCode("");
    setFName("");
    setFIcaoType("");
    setFManufacturer("");
    setFTailNumber("");
    setFSerialNumber("");
    setFOperatorId(operatorsQ.data?.[0]?.id ?? "");
    setFTypeId(aircraftTypesQ.data?.[0]?.id ?? "");
    setFColor("#3b82f6");
    setFHangarId(hangarsQ.data?.[0]?.id ?? "");
    setFLayoutId(layoutsForStandsQ.data?.[0]?.id ?? "");
    setFDescription("");
    setFWidth(60);
    setFHeight(40);
    setFX(5);
    setFY(5);
    setFW(18);
    setFH(10);
    setFRotate(0);
    setFStartMin(8 * 60);
    setFEndMin(20 * 60);
    setFUom("EA");
    setFPersonSkillIds([]);
    setFBodyType("");

    if (k === "operators") {
      setFCode("NEW");
      setFName("Новый оператор");
    } else if (k === "aircraft-types") {
      setFIcaoType("A320");
      setFName("Тип ВС");
      setFManufacturer("Производитель");
    } else if (k === "aircraft") {
      setFTailNumber("RA-XXXXX");
      setFSerialNumber("");
      setAircraftImportOperatorId(operatorsQ.data?.[0]?.id ?? "");
      setAircraftImportTypeId(aircraftTypesQ.data?.[0]?.id ?? "");
    } else if (k === "aircraft-type-palette") {
      setFOperatorId(operatorsQ.data?.[0]?.id ?? "");
      setFTypeId(aircraftTypesQ.data?.[0]?.id ?? "");
      setFColor("#f59e0b");
    } else if (k === "event-types") {
      setFCode("NEW_EVENT");
      setFName("Событие");
      setFColor("#3b82f6");
    } else if (k === "hangars") {
      setFCode("HNEW");
      setFName("Ангар");
    } else if (k === "layouts") {
      setFCode("BASE");
      setFName("Вариант");
    } else if (k === "stands") {
      setFCode("S1");
      setFName("Место");
    } else if (k === "skills") {
      setFCode("MECH");
      setFName("Квалификация");
    } else if (k === "persons") {
      setFCode("P001");
      setFName("Сотрудник");
      setFPersonSkillIds([]);
    } else if (k === "shifts") {
      setFCode("DAY");
      setFName("Смена");
      setFStartMin(8 * 60);
      setFEndMin(20 * 60);
    } else if (k === "materials") {
      setFCode("MAT-001");
      setFName("Материал");
      setFUom("EA");
    } else if (k === "warehouses") {
      setFCode("MAIN");
      setFName("Склад");
    }
  };

  const openCreate = () => {
    resetFormForKind(kind);
    setMode("create");
    setEditId("");
  };

  const openEdit = (row: any) => {
    setMode("edit");
    setEditId(row.id);
    setFIsActive(Boolean(row.isActive ?? true));
    setFCode(String(row.code ?? ""));
    setFName(String(row.name ?? ""));
    setFIcaoType(String(row.icaoType ?? ""));
    setFManufacturer(String(row.manufacturer ?? ""));
    setFBodyType(String(row.bodyType ?? ""));
    setFTailNumber(String(row.tailNumber ?? ""));
    setFSerialNumber(String(row.serialNumber ?? ""));
    setFOperatorId(String(row.operatorId ?? ""));
    setFTypeId(String(row.typeId ?? row.aircraftTypeId ?? ""));
    setFColor(String(row.color ?? "#3b82f6"));
    setFHangarId(String(row.hangarId ?? ""));
    setFLayoutId(String(row.layoutId ?? ""));
    setFDescription(String(row.description ?? ""));
    setFWidth(Number(row.widthMeters ?? 60));
    setFHeight(Number(row.heightMeters ?? 40));
    setFX(Number(row.x ?? 0));
    setFY(Number(row.y ?? 0));
    setFW(Number(row.w ?? 18));
    setFH(Number(row.h ?? 10));
    setFRotate(Number(row.rotate ?? 0));
    setFBodyType(String(row.bodyType ?? ""));
    setFStartMin(Number(row.startMin ?? 8 * 60));
    setFEndMin(Number(row.endMin ?? 20 * 60));
    setFUom(String(row.uom ?? "EA"));
    setFPersonSkillIds(
      Array.isArray(row.skills) ? row.skills.map((s: any) => String(s.skill?.id ?? s.skillId ?? "")).filter(Boolean) : []
    );
  };

  const buildPayload = () => {
    if (kind === "operators") return { code: fCode.trim(), name: fName.trim(), isActive: fIsActive };
    if (kind === "aircraft-types")
      return {
        icaoType: fIcaoType.trim() ? fIcaoType.trim() : undefined,
        name: fName.trim(),
        manufacturer: fManufacturer.trim() ? fManufacturer.trim() : undefined,
        bodyType: fBodyType === "NARROW_BODY" || fBodyType === "WIDE_BODY" ? fBodyType : null,
        isActive: fIsActive
      };
    if (kind === "aircraft")
      return {
        tailNumber: fTailNumber.trim(),
        serialNumber: fSerialNumber.trim() ? fSerialNumber.trim() : undefined,
        operatorId: fOperatorId,
        typeId: fTypeId,
        isActive: fIsActive
      };
    if (kind === "aircraft-type-palette")
      return {
        operatorId: fOperatorId,
        aircraftTypeId: fTypeId,
        color: fColor.trim(),
        isActive: fIsActive
      };
    if (kind === "skills") return { code: fCode.trim(), name: fName.trim(), isActive: fIsActive };
    if (kind === "persons")
      return {
        code: fCode.trim() ? fCode.trim() : undefined,
        name: fName.trim(),
        isActive: fIsActive
      };
    if (kind === "shifts") return { code: fCode.trim(), name: fName.trim(), startMin: fStartMin, endMin: fEndMin, isActive: fIsActive };
    if (kind === "materials") return { code: fCode.trim(), name: fName.trim(), uom: fUom.trim() ? fUom.trim() : "EA", isActive: fIsActive };
    if (kind === "warehouses") return { code: fCode.trim(), name: fName.trim(), isActive: fIsActive };
    if (kind === "event-types")
      return { code: fCode.trim(), name: fName.trim(), color: fColor.trim() ? fColor.trim() : undefined, isActive: fIsActive };
    if (kind === "hangars") return { code: fCode.trim(), name: fName.trim(), isActive: fIsActive };
    if (kind === "layouts")
      return {
        hangarId: fHangarId,
        code: fCode.trim(),
        name: fName.trim(),
        description: fDescription.trim() ? fDescription.trim() : undefined,
        widthMeters: Number.isFinite(fWidth) ? fWidth : undefined,
        heightMeters: Number.isFinite(fHeight) ? fHeight : undefined,
        isActive: fIsActive
      };
    if (kind === "stands")
      return {
        layoutId: fLayoutId,
        code: fCode.trim(),
        name: fName.trim(),
        bodyType: fBodyType === "NARROW_BODY" || fBodyType === "WIDE_BODY" ? fBodyType : null,
        x: fX,
        y: fY,
        w: fW,
        h: fH,
        rotate: fRotate,
        isActive: fIsActive
      };
    return {};
  };

  // Фильтрация списка по строке поиска
  const filteredRows = useMemo(() => {
    const rows = listQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row: any) => {
      const fields = [
        row.name,
        row.code,
        row.icaoType,
        row.tailNumber,
        row.serialNumber,
        row.operator?.name,
        row.type?.name,
        row.type?.icaoType,
        row.aircraftType?.name,
        row.aircraftType?.icaoType,
        row.color,
        row.manufacturer,
        row.description
      ];
      return fields.some((f) => f != null && String(f).toLowerCase().includes(q));
    });
  }, [listQ.data, search]);

  const totalCount = listQ.data?.length ?? 0;
  const effectivePreviewLayoutId = useMemo(() => {
    if (previewLayoutId) return previewLayoutId;
    if (kind === "layouts") return String(filteredRows[0]?.id ?? "");
    if (kind === "stands") return filterLayoutId || String(filteredRows[0]?.layoutId ?? "");
    return "";
  }, [filteredRows, filterLayoutId, kind, previewLayoutId]);
  const previewQ = useQuery({
    queryKey: ["layout", "preview", effectivePreviewLayoutId],
    queryFn: () => apiGet<LayoutDetail>(`/api/ref/layouts/${effectivePreviewLayoutId}`),
    enabled: (kind === "layouts" || kind === "stands") && Boolean(effectivePreviewLayoutId)
  });

  return (
    <div className="refPage">
      <aside className="refSidebar card">
        <div className="refSidebarHeader">
          <strong>Справочники</strong>
          <span className="muted refSidebarHint">Выберите категорию</span>
        </div>
        <div className="refGroups">
          {REF_GROUPS.map((group) => (
            <div className="refGroup" key={group.label}>
              <div className="refGroupLabel">{group.label}</div>
              <div className="refGroupItems">
                {group.items.map((it) => {
                  const active = it.kind === kind;
                  return (
                    <button
                      key={it.kind}
                      type="button"
                      className={`refNavItem${active ? " refNavItemActive" : ""}`}
                      onClick={() => {
                        setKind(it.kind);
                        setSearch("");
                        setMode(null);
                      }}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="refNavItemTitle">{it.title}</span>
                      {it.hint ? <span className="refNavItemHint muted">{it.hint}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="refMain">
        <div className="card refHeader">
          <div className="refHeaderTitle">
            <div className="refHeaderCrumb muted">Справочники</div>
            <div className="refHeaderName">
              <strong>{REF_TITLE[kind]}</strong>
              <span className="refHeaderCount muted">
                {totalCount > 0 ? `· ${totalCount}` : listQ.isFetching ? "· загрузка…" : ""}
              </span>
            </div>
          </div>
          <div className="refHeaderActions">
            <div className="refSearch">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="9" cy="9" r="6" />
                <path d="m14 14 4 4" />
              </svg>
              <input
                type="search"
                placeholder="Поиск по названию, коду, оператору…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button className="refSearchClear" type="button" onClick={() => setSearch("")} aria-label="Очистить">
                  ×
                </button>
              ) : null}
            </div>
            {kind === "layouts" ? (
              <label className="refHeaderFilter">
                <span className="muted">Ангар</span>
                <select value={filterHangarId} onChange={(e) => setFilterHangarId(e.target.value)}>
                  <option value="">все</option>
                  {(hangarsQ.data ?? []).map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {kind === "stands" ? (
              <>
                <label className="refHeaderFilter">
                  <span className="muted">Ангар</span>
                  <select value={filterHangarId} onChange={(e) => setFilterHangarId(e.target.value)}>
                    <option value="">все</option>
                    {(hangarsQ.data ?? []).map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="refHeaderFilter">
                  <span className="muted">Вариант</span>
                  <select value={filterLayoutId} onChange={(e) => setFilterLayoutId(e.target.value)}>
                    <option value="">все</option>
                    {(layoutsForStandsQ.data ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            {canWrite ? (
              <button className="btn btnPrimary" onClick={openCreate}>
                + Добавить
              </button>
            ) : null}
          </div>
        </div>

      {kind === "aircraft" && canWrite ? (
        <div className="card refSection">
          <div className="refSectionHeader">
            <div>
              <strong>Импорт бортовых номеров из CSV</strong>
              <div className="muted refSectionHint">Берём 1-й столбец; разделитель: запятая/точка с запятой/таб.</div>
            </div>
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Оператор (для всех строк)</span>
              <select
                value={aircraftImportOperatorId || (operatorsQ.data?.[0]?.id ?? "")}
                onChange={(e) => setAircraftImportOperatorId(e.target.value)}
                style={{ width: 260 }}
              >
                {(operatorsQ.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Тип ВС (для всех строк)</span>
              <select
                value={aircraftImportTypeId || (aircraftTypesQ.data?.[0]?.id ?? "")}
                onChange={(e) => setAircraftImportTypeId(e.target.value)}
                style={{ width: 320 }}
              >
                {(aircraftTypesQ.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icaoType ? `${t.icaoType} • ${t.name}` : t.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">CSV файл</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0] ?? null;
                  setAircraftCsvFile(f);
                  setAircraftImportResult(null);
                  setAircraftCsvParseError(null);
                  setAircraftCsvText("");
                  if (!f) return;
                  try {
                    const text = await f.text();
                    setAircraftCsvText(text);
                  } catch (err: any) {
                    setAircraftCsvParseError(String(err?.message ?? err));
                  }
                }}
                style={{ width: 360 }}
              />
            </label>
            <button
              className="btn btnPrimary"
              disabled={
                aircraftImportM.isPending ||
                !aircraftCsvText ||
                !(aircraftImportOperatorId || operatorsQ.data?.[0]?.id) ||
                !(aircraftImportTypeId || aircraftTypesQ.data?.[0]?.id)
              }
              onClick={() => {
                try {
                  const tailNumbers = parseTailNumbersFromCsvText(aircraftCsvText);
                  if (tailNumbers.length === 0) throw new Error("В CSV не найдено ни одного бортового номера.");
                  aircraftImportM.mutate({
                    operatorId: aircraftImportOperatorId || (operatorsQ.data?.[0]?.id ?? ""),
                    typeId: aircraftImportTypeId || (aircraftTypesQ.data?.[0]?.id ?? ""),
                    tailNumbers
                  });
                } catch (err: any) {
                  setAircraftCsvParseError(String(err?.message ?? err));
                }
              }}
            >
              Импортировать
            </button>
            {aircraftImportM.error ? <span className="error">{String((aircraftImportM.error as any)?.message ?? aircraftImportM.error)}</span> : null}
          </div>
          {aircraftCsvParseError ? <div className="error">{aircraftCsvParseError}</div> : null}
          {aircraftCsvFile ? (
            <div className="muted">
              Файл: <strong>{aircraftCsvFile.name}</strong>{" "}
              {aircraftCsvText ? (
                <>
                  • строк: {aircraftCsvText.replace(/\r/g, "").split("\n").filter((l) => l.trim()).length} • к импорту:{" "}
                  {parseTailNumbersFromCsvText(aircraftCsvText).length}
                </>
              ) : null}
            </div>
          ) : null}
          {aircraftImportResult ? (
            <div className="refImportResult">
              <div className="row">
                <strong>Результат</strong>
                <span className="gpChip gpChipInfo">создано: {aircraftImportResult.created ?? 0}</span>
                <span className="gpChip">пропущено: {aircraftImportResult.duplicatesOrExisting ?? 0}</span>
                <span className="gpChip gpChipError">невалидных: {(aircraftImportResult.invalid ?? []).length}</span>
              </div>
              {isAdmin && (aircraftImportResult.invalid ?? []).length ? (
                <details className="refImportInvalid">
                  <summary>Подробности по невалидным строкам</summary>
                  <pre>{JSON.stringify(aircraftImportResult.invalid, null, 2)}</pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {(kind === "layouts" || kind === "stands") && canWrite ? (
        <div className="card refSection">
          <div className="refSectionHeader">
            <div>
              <strong>Импорт схем из Excel / CSV</strong>
              <div className="muted refSectionHint">
                Каждая строка — одно место стоянки. Обязательные колонки: hangarCode, layoutCode, standCode, x, y, w, h.
              </div>
            </div>
          </div>
          <div className="refLayoutImportGrid">
            <label className="refLabel">
              <span>Файл Excel / CSV</span>
              <input
                className="refInput"
                type="file"
                accept=".xlsx,.xls,.csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0] ?? null;
                  setLayoutImportFile(file);
                  setLayoutImportRows([]);
                  setLayoutImportError(null);
                  setLayoutImportResult(null);
                  if (!file) return;
                  try {
                    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
                    const sheet = wb.Sheets[wb.SheetNames[0]!];
                    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
                    setLayoutImportRows(rows);
                  } catch (err: any) {
                    setLayoutImportError(String(err?.message ?? err));
                  }
                }}
              />
            </label>
            <button
              className="btn btnPrimary"
              disabled={layoutImportRows.length === 0 || layoutImportM.isPending}
              onClick={() => {
                try {
                  const payload = buildLayoutImportPayload(layoutImportRows);
                  if (payload.hangars.length === 0) {
                    throw new Error("Не найдено строк с hangarCode, layoutCode и standCode.");
                  }
                  layoutImportM.mutate(payload);
                } catch (err: any) {
                  setLayoutImportError(String(err?.message ?? err));
                }
              }}
            >
              {layoutImportM.isPending ? "Импорт…" : "Импортировать схемы"}
            </button>
          </div>
          <div className="muted small">
            Рекомендуемые колонки: hangarCode, hangarName, layoutCode, layoutName, widthMeters, heightMeters, standCode,
            standName, bodyType, x, y, w, h, rotate. Значения bodyType: narrow/узкий или wide/широкий.
          </div>
          {layoutImportFile ? (
            <div className="muted">
              Файл: <strong>{layoutImportFile.name}</strong> · строк: {layoutImportRows.length}
            </div>
          ) : null}
          {layoutImportRows.length > 0 ? (
            <div className="refImportPreview">
              <strong>Предпросмотр первых строк</strong>
              <pre>{JSON.stringify(layoutImportRows.slice(0, 3), null, 2)}</pre>
            </div>
          ) : null}
          {layoutImportResult ? (
            <div className="refImportResult">
              <span className="gpChip gpChipInfo">ангаров: {layoutImportResult.hangars ?? 0}</span>
              <span className="gpChip">схем: {layoutImportResult.layouts ?? 0}</span>
              <span className="gpChip">мест: {layoutImportResult.stands ?? 0}</span>
            </div>
          ) : null}
          {layoutImportError || layoutImportM.error ? (
            <div className="error">{layoutImportError || String((layoutImportM.error as any)?.message ?? layoutImportM.error)}</div>
          ) : null}
        </div>
      ) : null}

      {kind === "layouts" || kind === "stands" ? (
        <div className="card refSection">
          <div className="refSectionHeader">
            <div>
              <strong>Визуальная схема</strong>
              <div className="muted refSectionHint">Предпросмотр выбранного варианта расстановки и его мест стоянки.</div>
            </div>
            {effectivePreviewLayoutId ? (
              <span className="muted small">layout: {previewQ.data?.code ?? "…"}</span>
            ) : null}
          </div>
          <LayoutSchemePreview detail={previewQ.data ?? null} selectedStandId={previewStandId} />
        </div>
      ) : null}

      {mode ? (
        <div className="card refSection">
          <div className="refSectionHeader">
            <div>
              <strong>{mode === "create" ? "Создание" : "Редактирование"}</strong>
              <div className="muted refSectionHint">{REF_SINGULAR[kind]}</div>
            </div>
            <button className="btn" onClick={() => setMode(null)}>
              Закрыть
            </button>
          </div>

          <div className="refForm">
            {kind === "operators" ||
            kind === "event-types" ||
            kind === "hangars" ||
            kind === "layouts" ||
            kind === "stands" ||
            kind === "skills" ||
            kind === "persons" ||
            kind === "shifts" ||
            kind === "materials" ||
            kind === "warehouses" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Код</span>
                <TextInput value={fCode} onChange={setFCode} style={{ width: 220 }} />
              </label>
            ) : null}

            {kind === "aircraft-types" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">ICAO</span>
                <TextInput value={fIcaoType} onChange={setFIcaoType} style={{ width: 220 }} />
              </label>
            ) : null}

            {kind === "aircraft" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Бортовой номер</span>
                <TextInput value={fTailNumber} onChange={setFTailNumber} style={{ width: 220 }} />
              </label>
            ) : null}

            {kind !== "aircraft" && kind !== "persons" && kind !== "aircraft-type-palette" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Название</span>
                <TextInput value={fName} onChange={setFName} style={{ width: 320 }} />
              </label>
            ) : null}

            {kind === "persons" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Имя</span>
                  <TextInput value={fName} onChange={setFName} style={{ width: 320 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Квалификации</span>
                  <div style={{ width: 320 }}>
                    <MultiSelectDropdown
                      options={(skillsQ.data ?? []).map((s) => ({ id: s.id, label: `${s.code} • ${s.name}` }))}
                      value={fPersonSkillIds}
                      onChange={setFPersonSkillIds}
                      width={320}
                      maxHeight={260}
                    />
                  </div>
                </label>
              </>
            ) : null}

            {kind === "aircraft" || kind === "aircraft-type-palette" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Оператор</span>
                  <select value={fOperatorId} onChange={(e) => setFOperatorId(e.target.value)} style={{ width: 240 }}>
                    {(operatorsQ.data ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Тип ВС</span>
                  <select value={fTypeId} onChange={(e) => setFTypeId(e.target.value)} style={{ width: 240 }}>
                    {(aircraftTypesQ.data ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.icaoType ? `${t.icaoType} • ${t.name}` : t.name}
                      </option>
                    ))}
                  </select>
                </label>
                {kind === "aircraft" ? (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span className="muted">Зав. №</span>
                    <TextInput value={fSerialNumber} onChange={setFSerialNumber} style={{ width: 220 }} />
                  </label>
                ) : null}
              </>
            ) : null}

            {kind === "aircraft-types" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Производитель</span>
                <TextInput value={fManufacturer} onChange={setFManufacturer} style={{ width: 240 }} />
              </label>
            ) : null}
            {kind === "aircraft-types" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Тип фюзеляжа</span>
                <select value={fBodyType} onChange={(e) => setFBodyType(e.target.value)} style={{ width: 220 }}>
                  <option value="">— любой —</option>
                  <option value="NARROW_BODY">Узкий (A320, B737…)</option>
                  <option value="WIDE_BODY">Широкий (A330, B777…)</option>
                </select>
              </label>
            ) : null}

            {kind === "event-types" || kind === "aircraft-type-palette" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Цвет</span>
                <div className="row" style={{ gap: 8 }}>
                  <input type="color" value={fColor} onChange={(e) => setFColor(e.target.value)} />
                  <TextInput value={fColor} onChange={setFColor} style={{ width: 140 }} />
                </div>
              </label>
            ) : null}

            {kind === "shifts" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Начало смены</span>
                  <NumberInput value={fStartMin} onChange={setFStartMin} step={15} style={{ width: 140 }} />
                  <span className="muted" style={{ fontSize: 11 }}>
                    мин. от 00:00 · {formatMinutesOfDay(fStartMin)}
                  </span>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Окончание смены</span>
                  <NumberInput value={fEndMin} onChange={setFEndMin} step={15} style={{ width: 140 }} />
                  <span className="muted" style={{ fontSize: 11 }}>
                    мин. от 00:00 · {formatMinutesOfDay(fEndMin)}
                  </span>
                </label>
              </>
            ) : null}

            {kind === "materials" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Ед. изм.</span>
                <TextInput value={fUom} onChange={setFUom} style={{ width: 140 }} />
              </label>
            ) : null}

            {kind === "layouts" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Ангар</span>
                  <select value={fHangarId} onChange={(e) => setFHangarId(e.target.value)} style={{ width: 240 }}>
                    {(hangarsQ.data ?? []).map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Ширина (м)</span>
                  <NumberInput value={fWidth} onChange={setFWidth} step={1} style={{ width: 140 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Высота (м)</span>
                  <NumberInput value={fHeight} onChange={setFHeight} step={1} style={{ width: 140 }} />
                </label>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Описание</span>
                  <TextInput value={fDescription} onChange={setFDescription} style={{ width: 360 }} />
                </label>
              </>
            ) : null}

            {kind === "stands" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Вариант</span>
                  <select value={fLayoutId} onChange={(e) => setFLayoutId(e.target.value)} style={{ width: 280 }}>
                    {(layoutsForStandsQ.data ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {(l as any).capacitySummary ? ` (${(l as any).capacitySummary})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Тип фюзеляжа (места)</span>
                  <select value={fBodyType} onChange={(e) => setFBodyType(e.target.value)} style={{ width: 220 }}>
                    <option value="">— любой —</option>
                    <option value="NARROW_BODY">Узкий</option>
                    <option value="WIDE_BODY">Широкий</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Название</span>
                  <TextInput value={fName} onChange={setFName} style={{ width: 240 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">X (м)</span>
                  <NumberInput value={fX} onChange={setFX} step={0.5} style={{ width: 90 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Y (м)</span>
                  <NumberInput value={fY} onChange={setFY} step={0.5} style={{ width: 90 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Ширина (м)</span>
                  <NumberInput value={fW} onChange={setFW} step={0.5} style={{ width: 90 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Высота (м)</span>
                  <NumberInput value={fH} onChange={setFH} step={0.5} style={{ width: 90 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Поворот (°)</span>
                  <NumberInput value={fRotate} onChange={setFRotate} step={1} style={{ width: 90 }} />
                </label>
              </>
            ) : null}

            <BoolToggle value={fIsActive} onChange={setFIsActive} />

            <button
              className="btn btnPrimary"
              disabled={createM.isPending || updateM.isPending}
              onClick={() => {
                const payload = buildPayload();
                if (kind === "persons") {
                  if (mode === "create") {
                    createM.mutate(payload, {
                      onSuccess: async (created) => {
                        if (created?.id) {
                          await apiPut(`/api/ref/persons/${created.id}/skills`, {
                            skills: fPersonSkillIds.map((skillId) => ({ skillId }))
                          });
                        }
                        await qc.invalidateQueries({ queryKey: ["ref", kind] });
                        await qc.invalidateQueries({ queryKey: ["ref", kind, filterHangarId, filterLayoutId] });
                      }
                    });
                    return;
                  }

                  updateM.mutate(
                    { id: editId, payload },
                    {
                      onSuccess: async (updated) => {
                        const pid = updated?.id ?? editId;
                        await apiPut(`/api/ref/persons/${pid}/skills`, {
                          skills: fPersonSkillIds.map((skillId) => ({ skillId }))
                        });
                        await qc.invalidateQueries({ queryKey: ["ref", kind] });
                        await qc.invalidateQueries({ queryKey: ["ref", kind, filterHangarId, filterLayoutId] });
                      }
                    }
                  );
                  return;
                }

                if (mode === "create") createM.mutate(payload);
                else updateM.mutate({ id: editId, payload });
              }}
            >
              {mode === "create" ? "Сохранить" : "Сохранить изменения"}
            </button>

            {createM.error || updateM.error ? (
              <span className="error">{String((createM.error ?? updateM.error)?.message ?? createM.error ?? updateM.error)}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="card refList">
        {listQ.error ? (
          <div className="error" style={{ marginBottom: 8 }}>
            {String(listQ.error.message || listQ.error)}
          </div>
        ) : null}
        {(listQ.data ?? []).length === 0 && !listQ.isFetching ? (
          <div className="refEmpty">
            <div className="refEmptyTitle">
              {search ? "Ничего не найдено" : "Записей пока нет"}
            </div>
            <div className="muted">
              {search
                ? "Попробуйте изменить запрос или очистить поиск."
                : canWrite
                  ? "Нажмите «Добавить», чтобы создать первую запись."
                  : "Обратитесь к администратору для наполнения справочника."}
            </div>
          </div>
        ) : (
          <table className="table refTable">
            <thead>
              <tr>
                <th>Название</th>
                <th>Код / идентификация</th>
                <th>Связи и параметры</th>
                <th>Статус</th>
                {isAdmin ? <th className="refTechColumn">Технические</th> : null}
                <th className="refActionsColumn">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row: any) => {
                const displayName =
                  kind === "aircraft-type-palette"
                    ? `${row.operator?.name ?? "Оператор"} × ${row.aircraftType?.icaoType ? `${row.aircraftType.icaoType} • ` : ""}${row.aircraftType?.name ?? "Тип ВС"}`
                    : row.name ?? row.tailNumber ?? "—";
                const idCodeLines: string[] = [];
                if (row.code) idCodeLines.push(String(row.code));
                if (row.icaoType) idCodeLines.push(`ICAO ${row.icaoType}`);
                if (row.tailNumber && kind !== "aircraft") idCodeLines.push(String(row.tailNumber));
                if (row.serialNumber) idCodeLines.push(`S/N ${row.serialNumber}`);
                const bodyLabel = bodyTypeLabel(row.bodyType);

                return (
                  <tr key={row.id}>
                    <td>
                      <div className="refCellTitle">
                        {row.color ? (
                          <span
                            className="refRowSwatch"
                            style={{ background: String(row.color) }}
                            title={String(row.color)}
                          />
                        ) : null}
                        <strong>{displayName}</strong>
                      </div>
                      {row.description ? (
                        <div className="muted refCellHint">{row.description}</div>
                      ) : null}
                    </td>
                    <td>
                      {idCodeLines.length > 0 ? (
                        <div className="refCellLines">
                          {idCodeLines.map((s, i) => (
                            <span className="refCellLine" key={i}>
                              {s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="refLinks">
                        {row.operator?.name ? (
                          <span className="refLink">Оператор: <strong>{row.operator.name}</strong></span>
                        ) : null}
                        {row.type?.name ? (
                          <span className="refLink">
                            Тип ВС: <strong>{row.type.icaoType ? `${row.type.icaoType} • ` : ""}{row.type.name}</strong>
                          </span>
                        ) : null}
                        {row.aircraftType?.name ? (
                          <span className="refLink">
                            Тип ВС: <strong>{row.aircraftType.icaoType ? `${row.aircraftType.icaoType} • ` : ""}{row.aircraftType.name}</strong>
                          </span>
                        ) : null}
                        {row.manufacturer ? (
                          <span className="refLink">Производитель: <strong>{row.manufacturer}</strong></span>
                        ) : null}
                        {row.hangar?.name ? (
                          <span className="refLink">Ангар: <strong>{row.hangar.name}</strong></span>
                        ) : null}
                        {row.layout?.name ? (
                          <span className="refLink">Вариант: <strong>{row.layout.name}</strong></span>
                        ) : null}
                        {(row as any).capacitySummary ? (
                          <span className="refLink">Вместимость: <strong>{(row as any).capacitySummary}</strong></span>
                        ) : null}
                        {bodyLabel ? (
                          <span className="refLink">Фюзеляж: <strong>{bodyLabel}</strong></span>
                        ) : null}
                        {row.uom ? <span className="refLink">Ед. изм.: <strong>{row.uom}</strong></span> : null}
                        {kind === "shifts" && row.startMin != null && row.endMin != null ? (
                          <span className="refLink">
                            Смена: <strong>{formatMinutesOfDay(row.startMin)} – {formatMinutesOfDay(row.endMin)}</strong>
                          </span>
                        ) : null}
                        {Array.isArray(row.skills) && row.skills.length > 0 ? (
                          <span className="refLink">
                            Квалификации:{" "}
                            <strong>
                              {row.skills
                                .map((s: any) => s.skill?.code || s.skill?.name || s.skillId)
                                .filter(Boolean)
                                .join(", ")}
                            </strong>
                          </span>
                        ) : null}
                        {(row as any).widthMeters != null && (row as any).heightMeters != null ? (
                          <span className="refLink">
                            Размер: <strong>{(row as any).widthMeters} × {(row as any).heightMeters} м</strong>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {row.isActive === false ? (
                        <span className="refStatus refStatusInactive">Неактивен</span>
                      ) : (
                        <span className="refStatus refStatusActive">Активен</span>
                      )}
                    </td>
                    {isAdmin ? (
                      <td className="refTechColumn">
                        <details className="refTechDetails">
                          <summary title="Технические данные записи">ID / JSON</summary>
                          <div className="refTechBody">
                            <div className="refTechId" title="ID записи">
                              <span className="muted">id:</span>{" "}
                              <code>{row.id}</code>
                            </div>
                            {row.hangarId ? (
                              <div className="refTechId">
                                <span className="muted">hangarId:</span> <code>{row.hangarId}</code>
                              </div>
                            ) : null}
                            {row.layoutId ? (
                              <div className="refTechId">
                                <span className="muted">layoutId:</span> <code>{row.layoutId}</code>
                              </div>
                            ) : null}
                            <pre className="refTechJson">{JSON.stringify(row, null, 2)}</pre>
                          </div>
                        </details>
                      </td>
                    ) : null}
                    <td className="refActionsColumn">
                      <div className="refRowActions">
                        {canWrite ? (
                          <>
                            <button className="btn btnGhost" onClick={() => openEdit(row)} title="Редактировать">
                              Изменить
                            </button>
                            {(kind === "layouts" || kind === "stands") ? (
                              <button
                                className="btn btnGhost"
                                onClick={() => {
                                  setPreviewLayoutId(String(kind === "layouts" ? row.id : row.layoutId ?? ""));
                                  setPreviewStandId(String(kind === "stands" ? row.id : ""));
                                }}
                                title="Показать на схеме"
                              >
                                Схема
                              </button>
                            ) : null}
                            <button
                              className="btn btnGhost refBtnDanger"
                              onClick={() => {
                                if (confirm("Удалить запись?")) deleteM.mutate(row.id);
                              }}
                              disabled={deleteM.isPending}
                              title="Удалить запись"
                            >
                              Удалить
                            </button>
                          </>
                        ) : (
                          <span className="muted">только просмотр</span>
                        )}
                      </div>
                      {deleteM.error ? (
                        <div className="error refCellHint">{String(deleteM.error.message || deleteM.error)}</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </div>
    </div>
  );
}

