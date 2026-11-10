import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import {
  dateInputToIso,
  formatAircraftAge,
  formatManufactureDateRu,
  toDateInputValue
} from "../../lib/aircraftAge";
import { parseHashPage } from "../../lib/eventDeepLink";
import { parseRefViewShare, syncRefViewHash, type RefShareKind } from "../../lib/viewShareUrl";
import { authMe } from "../auth/authApi";
import { DraftNumberInput } from "../components/DraftNumberInput";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { SwitchToggle } from "../components/SwitchToggle";
import {
  AircraftCardModal,
  AircraftLibrary,
  AircraftTypeCardModal,
  AircraftTypesTable,
  HangarCardModal,
  HangarsTable,
  PaletteCardModal,
  PaletteTable
} from "./FleetRefCards";
import { downloadRemainingRefXlsx, isRemainingRefKind, RemainingRefCard, RemainingRefTable, type RemainingRefKind, type RemainingRefValues } from "./CatalogRefCards";
import { LayoutCardModal, LayoutsLibrary, StandCardModal, StandsLibrary } from "./LayoutStandCards";
import { OperatorCardModal, OperatorsTable } from "./OperatorCard";
import { TowNormCardModal, TowNormsTable, type TowNormRow } from "./TowNormsTable";
import { isPersonnelCatalogKind, PersonnelCatalogPanel } from "./PersonnelCatalogPanels";
import { ChangeReasonsPanel } from "./ChangeReasonsPanel";

type RefKind = RefShareKind;

type RefGroup = { label: string; items: Array<{ kind: RefKind; title: string; hint?: string }> };

const REF_GROUPS: RefGroup[] = [
  {
    label: "Авиация",
    items: [
      { kind: "operators", title: "Операторы" },
      { kind: "aircraft-types", title: "Типы ВС" },
      { kind: "aircraft", title: "Бортовые номера", hint: "тип → борт" },
      { kind: "aircraft-type-palette", title: "Палитра ВС", hint: "оператор × тип" }
    ]
  },
  {
    label: "Инфраструктура",
    items: [
      { kind: "hangars", title: "Ангары" },
      { kind: "layouts", title: "Варианты расстановки", hint: "ангар → вариант" },
      { kind: "stands", title: "Места (стоянки)", hint: "ангар → место" }
    ]
  },
  {
    label: "События",
    items: [
      { kind: "event-types", title: "Типы событий" },
      { kind: "event-statuses", title: "Статусы", hint: "название и цвет на Гантте" },
      { kind: "change-reasons", title: "Причины изменения", hint: "выбор в окне изменения события" },
      { kind: "tow-norms", title: "Нормативы буксировки", hint: "минуты на край события" }
    ]
  },
  {
    label: "Планирование",
    items: [
      { kind: "placement-priorities", title: "Приоритеты размещения", hint: "ангар × вариант × место" },
      { kind: "optimization-profiles", title: "Профили оптимизации", hint: "наборы весов" },
      { kind: "optimization-score-rules", title: "Правила scoring", hint: "штрафы и поощрения" }
    ]
  },
  {
    label: "Персонал",
    items: [
      { kind: "workshops", title: "Цеха" },
      { kind: "skills", title: "Квалификации" },
      { kind: "personnel-composition", title: "Состав категорий", hint: "категория и квалификации" },
      { kind: "personnel-categories", title: "Категории цеха", hint: "цех и категории" },
      { kind: "personnel-hours", title: "Норма часов", hint: "часов на человека в смене" },
      { kind: "personnel-factors", title: "Коэффициенты MPS", hint: "по типу ВС" },
      { kind: "aircraft-workshops", title: "Борт и цех", hint: "A/C-check, ангар" },
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
  "event-statuses": "Статус события",
  "change-reasons": "Причина изменения",
  "tow-norms": "Норматив буксировки",
  workshops: "Цех",
  hangars: "Ангар",
  layouts: "Вариант расстановки",
  stands: "Место (стоянка)",
  "placement-priorities": "Приоритет размещения",
  "optimization-profiles": "Профиль оптимизации",
  "optimization-score-rules": "Правило scoring",
  skills: "Квалификация",
  persons: "Сотрудник",
  shifts: "Смена",
  "personnel-hours": "Норма часов",
  "personnel-factors": "Коэффициент MPS",
  "personnel-composition": "Состав категории",
  "personnel-categories": "Категории цеха",
  "aircraft-workshops": "Привязка борта к цеху",
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

type Operator = { id: string; code: string; name: string; isActive: boolean };
type AircraftType = { id: string; icaoType?: string | null; name: string; manufacturer?: string | null; isActive: boolean };
type EventType = { id: string; code: string; name: string; isActive: boolean };
type Hangar = { id: string; code: string; name: string; station?: string | null; isActive: boolean; isPhysical?: boolean };
type Layout = {
  id: string;
  hangarId: string;
  code: string;
  name: string;
  description?: string | null;
  widthMeters?: number | null;
  heightMeters?: number | null;
  capacitySummary?: string;
  standsSummary?: string;
  isActive: boolean;
  hangar?: { id?: string; name?: string | null } | null;
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
    allowedAircraftTypes?: Array<{ aircraftTypeId?: string; aircraftType?: Pick<AircraftType, "id" | "icaoType" | "name"> }>;
    aircraftTypeIds?: string[];
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
type OptimizationProfile = { id: string; code: string; name: string; isDefault?: boolean; isActive: boolean };

function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties; maxLength?: number }) {
  return <input value={props.value} placeholder={props.placeholder} maxLength={props.maxLength} onChange={(e) => props.onChange(e.target.value)} style={props.style} />;
}

function NumberInput(props: { value: number; onChange: (v: number) => void; step?: number; style?: React.CSSProperties }) {
  return (
    <DraftNumberInput
      value={Number.isFinite(props.value) ? props.value : 0}
      step={props.step ?? 1}
      style={props.style}
      onChange={props.onChange}
    />
  );
}

function BoolToggle(props: { value: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return <SwitchToggle compact checked={props.value} onChange={props.onChange} label={props.label ?? "активен"} disabled={props.disabled} />;
}

function aircraftTypeNameLabel(t: Pick<AircraftType, "name">): string {
  return t.name;
}

function standAllowedAircraftTypeIds(row: any): string[] {
  if (Array.isArray(row.aircraftTypeIds)) return row.aircraftTypeIds.map(String);
  if (!Array.isArray(row.allowedAircraftTypes)) return [];
  return row.allowedAircraftTypes
    .map((link: any) => String(link.aircraftType?.id ?? link.aircraftTypeId ?? ""))
    .filter(Boolean);
}

function standAllowedAircraftTypeLabel(row: any): string {
  if (!Array.isArray(row.allowedAircraftTypes) || row.allowedAircraftTypes.length === 0) return "Любой ВС";
  return row.allowedAircraftTypes
    .map((link: any) => link.aircraftType)
    .filter(Boolean)
    .map((t: AircraftType) => aircraftTypeNameLabel(t))
    .join(", ");
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
            const hasSpecificAircraftTypes = standAllowedAircraftTypeIds(s).length > 0;
            const fill = hasSpecificAircraftTypes ? "rgba(37,99,235,0.78)" : "rgba(34,197,94,0.72)";
            return (
              <g key={s.id} transform={`rotate(${s.rotate ?? 0} ${s.x + s.w / 2} ${s.y + s.h / 2})`}>
                <title>{s.code} · {s.name} · {standAllowedAircraftTypeLabel(s)}</title>
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
function downloadOperatorsXlsx(rows: Array<{ code?: string; name?: string; isActive?: boolean }>) {
  const sorted = [...rows].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ru"));
  const sheet = XLSX.utils.json_to_sheet(
    sorted.map((row) => ({
      Код: row.code ?? "",
      Название: row.name ?? "",
      Статус: row.isActive === false ? "Неактивен" : "Активен"
    }))
  );
  sheet["!cols"] = [{ wch: 16 }, { wch: 42 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Операторы");
  XLSX.writeFile(wb, "operators.xlsx");
}

function bodyTypeExcel(v: unknown): string {
  if (v === "NARROW_BODY") return "Узкий";
  if (v === "WIDE_BODY") return "Широкий";
  return "";
}

function downloadAircraftTypesXlsx(rows: Array<{ icaoType?: string | null; name?: string | null; manufacturer?: string | null; bodyType?: string | null; isActive?: boolean }>) {
  const sorted = [...rows].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ru"));
  const sheet = XLSX.utils.json_to_sheet(
    sorted.map((row) => ({
      ICAO: row.icaoType ?? "",
      Название: row.name ?? "",
      Производитель: row.manufacturer ?? "",
      Фюзеляж: bodyTypeExcel(row.bodyType),
      Статус: row.isActive === false ? "Неактивен" : "Активен"
    }))
  );
  sheet["!cols"] = [{ wch: 12 }, { wch: 36 }, { wch: 24 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Типы ВС");
  XLSX.writeFile(wb, "aircraft-types.xlsx");
}

function downloadAircraftXlsx(
  rows: Array<{
    tailNumber?: string | null;
    serialNumber?: string | null;
    manufactureDate?: string | null;
    isActive?: boolean;
    operator?: { name?: string | null } | null;
    type?: { name?: string | null; icaoType?: string | null } | null;
  }>
) {
  const sorted = [...rows].sort((a, b) => String(a.tailNumber ?? "").localeCompare(String(b.tailNumber ?? ""), "ru"));
  const sheet = XLSX.utils.json_to_sheet(
    sorted.map((row) => ({
      Борт: row.tailNumber ?? "",
      Оператор: row.operator?.name ?? "",
      "Тип ВС": row.type?.name ?? "",
      "Зав. №": row.serialNumber ?? "",
      "Дата производства": formatManufactureDateRu(row.manufactureDate) ?? "",
      Возраст: formatAircraftAge(row.manufactureDate) ?? "",
      Статус: row.isActive === false ? "Неактивен" : "Активен"
    }))
  );
  sheet["!cols"] = [{ wch: 16 }, { wch: 28 }, { wch: 32 }, { wch: 16 }, { wch: 20 }, { wch: 22 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Борта");
  XLSX.writeFile(wb, "aircraft.xlsx");
}

function downloadPaletteXlsx(
  rows: Array<{
    color?: string | null;
    isActive?: boolean;
    operator?: { name?: string | null } | null;
    aircraftType?: { name?: string | null } | null;
  }>
) {
  const sorted = [...rows].sort((a, b) => {
    const byOperator = String(a.operator?.name ?? "").localeCompare(String(b.operator?.name ?? ""), "ru");
    if (byOperator) return byOperator;
    return String(a.aircraftType?.name ?? "").localeCompare(String(b.aircraftType?.name ?? ""), "ru");
  });
  const sheet = XLSX.utils.json_to_sheet(
    sorted.map((row) => ({
      Оператор: row.operator?.name ?? "",
      "Тип ВС": row.aircraftType?.name ?? "",
      Цвет: row.color ?? "",
      Статус: row.isActive === false ? "Неактивен" : "Активен"
    }))
  );
  sheet["!cols"] = [{ wch: 28 }, { wch: 28 }, { wch: 12 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Палитра");
  XLSX.writeFile(wb, "aircraft-type-palette.xlsx");
}

function downloadHangarsXlsx(
  rows: Array<{ code?: string | null; name?: string | null; station?: string | null; isPhysical?: boolean; isActive?: boolean }>
) {
  const sorted = [...rows].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ru"));
  const sheet = XLSX.utils.json_to_sheet(
    sorted.map((row) => ({
      Код: row.code ?? "",
      Название: row.name ?? "",
      Станция: row.station ?? "",
      Тип: row.isPhysical === false ? "Внешний MRO" : "Физический",
      Статус: row.isActive === false ? "Неактивен" : "Активен"
    }))
  );
  sheet["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Ангары");
  XLSX.writeFile(wb, "hangars.xlsx");
}

function downloadLayoutsXlsx(
  rows: Array<{
    code?: string | null;
    name?: string | null;
    description?: string | null;
    widthMeters?: number | null;
    heightMeters?: number | null;
    standsSummary?: string | null;
    isActive?: boolean;
    hangar?: { name?: string | null } | null;
  }>
) {
  const sorted = [...rows].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ru"));
  const sheet = XLSX.utils.json_to_sheet(
    sorted.map((row) => ({
      Ангар: row.hangar?.name ?? "",
      Код: row.code ?? "",
      Название: row.name ?? "",
      Описание: row.description ?? "",
      "Ширина, м": row.widthMeters ?? "",
      "Высота, м": row.heightMeters ?? "",
      Места: row.standsSummary ?? "",
      Статус: row.isActive === false ? "Неактивен" : "Активен"
    }))
  );
  sheet["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 28 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 42 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Варианты");
  XLSX.writeFile(wb, "layouts.xlsx");
}

function downloadStandsXlsx(
  rows: Array<{
    code?: string | null;
    name?: string | null;
    x?: number | null;
    y?: number | null;
    w?: number | null;
    h?: number | null;
    rotate?: number | null;
    isActive?: boolean;
    layout?: { name?: string | null; hangar?: { name?: string | null } | null } | null;
    allowedAircraftTypes?: Array<{ aircraftType?: { name?: string | null } | null } | null>;
  }>
) {
  const sorted = [...rows].sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? ""), "ru", { numeric: true }));
  const sheet = XLSX.utils.json_to_sheet(
    sorted.map((row) => {
      const types = (row.allowedAircraftTypes ?? [])
        .map((link) => link?.aircraftType?.name)
        .filter((name): name is string => Boolean(name));
      return {
        Ангар: row.layout?.hangar?.name ?? "",
        Вариант: row.layout?.name ?? "",
        Код: row.code ?? "",
        Название: row.name ?? "",
        "Типы ВС": types.length ? types.join(", ") : "Любой ВС",
        "X, м": row.x ?? "",
        "Y, м": row.y ?? "",
        "Ширина, м": row.w ?? "",
        "Высота, м": row.h ?? "",
        "Поворот, °": row.rotate ?? 0,
        Статус: row.isActive === false ? "Неактивен" : "Активен"
      };
    })
  );
  sheet["!cols"] = [{ wch: 22 }, { wch: 24 }, { wch: 12 }, { wch: 22 }, { wch: 36 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Места");
  XLSX.writeFile(wb, "stands.xlsx");
}

function RefExcelButton(props: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      className="btn ganttIconBtn"
      type="button"
      disabled={props.disabled}
      title="Выгрузить справочник в Excel"
      aria-label="Выгрузить справочник в Excel"
      onClick={props.onClick}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 2h7l4 4v12H5z" />
        <path d="M12 2v4h4" />
        <path d="M7 14l2-4" />
        <path d="M11 14l-2-4" />
        <path d="M12.5 14h2.5" />
        <path d="M12.5 10h2.5" />
      </svg>
    </button>
  );
}
function isRefCardKind(kind: RefKind) {
  return (
    kind === "operators" ||
    kind === "aircraft-types" ||
    kind === "aircraft" ||
    kind === "aircraft-type-palette" ||
    kind === "hangars" ||
    kind === "tow-norms" ||
    kind === "layouts" ||
    kind === "stands" ||
    isRemainingRefKind(kind)
  );
}

function cardMutationError(...errors: unknown[]) {
  const err = errors.find(Boolean);
  if (!err) return null;
  const message = (err as { message?: string }).message;
  return String(message ?? err);
}

function showInlineRefEditor(mode: "create" | "edit" | null, kind: RefKind) {
  return mode != null && !isRefCardKind(kind);
}
export function ReferenceView() {
  const initialShare = useMemo(() => {
    if (typeof window === "undefined") return null;
    const { page, query } = parseHashPage(location.hash);
    if (page !== "ref") return null;
    return parseRefViewShare(query);
  }, []);
  const [kind, setKind] = useState<RefKind>(() => initialShare?.kind ?? "operators");
  const [search, setSearch] = useState<string>(() => initialShare?.search ?? "");
  const qc = useQueryClient();

  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => authMe(), retry: 0, staleTime: 60_000 });
  const me = meQ.data && (meQ.data as any).ok ? (meQ.data as any).user : null;
  const isAdmin = Boolean(me?.roles?.includes("ADMIN") || me?.roles?.includes("SUPER_ADMIN"));
  const canWrite = Boolean(me?.roles?.includes("ADMIN") || me?.roles?.includes("PLANNER") || me?.roles?.includes("SUPER_ADMIN"));
  const canMutate = kind === "event-statuses" || kind === "tow-norms" ? isAdmin : canWrite;
  const changeReasonCatalog = kind === "change-reasons";
  const catalogKind = isPersonnelCatalogKind(kind) || changeReasonCatalog;
  const canCreate = canMutate && !catalogKind;
  const catalogCreateRef = useRef<(() => void) | null>(null);
  const splitRef = kind === "aircraft" || kind === "stands" || kind === "layouts";

  const url = useMemo(() => `/api/ref/${kind}`, [kind]);

  // зависимости для dropdown
  const operatorsQ = useQuery({ queryKey: ["ref", "operators"], queryFn: () => apiGet<Operator[]>("/api/ref/operators") });
  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftType[]>("/api/ref/aircraft-types")
  });
  const eventTypesQ = useQuery({ queryKey: ["ref", "event-types"], queryFn: () => apiGet<EventType[]>("/api/ref/event-types") });
  const hangarsQ = useQuery({ queryKey: ["ref", "hangars"], queryFn: () => apiGet<Hangar[]>("/api/ref/hangars") });
  const skillsQ = useQuery({ queryKey: ["ref", "skills"], queryFn: () => apiGet<Skill[]>("/api/ref/skills") });
  const optimizationProfilesQ = useQuery({
    queryKey: ["ref", "optimization-profiles"],
    queryFn: () => apiGet<OptimizationProfile[]>("/api/ref/optimization-profiles")
  });

  const [filterAircraftTypeId, setFilterAircraftTypeId] = useState("");
  const [filterProfileId, setFilterProfileId] = useState("");
  const detailDirtyRef = useRef(false);
  const [filterHangarId, setFilterHangarId] = useState<string>(() => initialShare?.filterHangarId ?? "");
  const [filterLayoutId, setFilterLayoutId] = useState<string>(() => initialShare?.filterLayoutId ?? "");
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  useEffect(() => {
    syncRefViewHash({
      kind,
      search,
      filterHangarId,
      filterLayoutId
    });
  }, [kind, search, filterHangarId, filterLayoutId]);

  const showFeedback = (type: "success" | "error" | "info", message: string) => {
    setFeedback({ type, message });
  };

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), feedback.type === "error" ? 9000 : 5500);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const listUrl = useMemo(() => {
    if (kind === "layouts" && filterHangarId) return `/api/ref/layouts?hangarId=${encodeURIComponent(filterHangarId)}`;
    if (kind === "stands" && filterLayoutId) return `/api/ref/stands?layoutId=${encodeURIComponent(filterLayoutId)}`;
    if (kind === "stands" && filterHangarId) return `/api/ref/stands?hangarId=${encodeURIComponent(filterHangarId)}`;
    if (kind === "placement-priorities" && filterLayoutId) return `/api/ref/placement-priorities?layoutId=${encodeURIComponent(filterLayoutId)}`;
    if (kind === "placement-priorities" && filterHangarId) return `/api/ref/placement-priorities?hangarId=${encodeURIComponent(filterHangarId)}`;
    if (kind === "optimization-score-rules" && filterProfileId) return `/api/ref/optimization-score-rules?profileId=${encodeURIComponent(filterProfileId)}`;
    return url;
  }, [kind, filterHangarId, filterLayoutId, filterProfileId, url]);

  const listQ = useQuery({
    queryKey: ["ref", kind, filterHangarId, filterLayoutId, filterProfileId],
    queryFn: () => apiGet<any[]>(listUrl),
    enabled: !catalogKind
  });

  const layoutsForStandsQ = useQuery({
    queryKey: ["ref", "layouts", filterHangarId],
    queryFn: () => apiGet<Layout[]>(filterHangarId ? `/api/ref/layouts?hangarId=${encodeURIComponent(filterHangarId)}` : "/api/ref/layouts"),
    enabled: kind === "stands" || kind === "layouts" || kind === "placement-priorities"
  });
  const aircraftTypeOptions = useMemo(
    () => (aircraftTypesQ.data ?? []).map((t) => ({ id: t.id, label: aircraftTypeNameLabel(t) })),
    [aircraftTypesQ.data]
  );
  const eventTypeOptions = useMemo(
    () => (eventTypesQ.data ?? []).map((t) => ({ id: t.id, label: `${t.code} • ${t.name}` })),
    [eventTypesQ.data]
  );

  const createM = useMutation({
    mutationFn: (payload: any) => apiPost<any>(url, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ref", kind] });
      await qc.invalidateQueries({ queryKey: ["ref", kind, filterHangarId, filterLayoutId] });
      // HangarView использует отдельный ключ для деталей раскладки
      if (kind === "stands" || kind === "layouts") {
        await qc.invalidateQueries({ queryKey: ["layout"] });
      }
      showFeedback("success", `${REF_SINGULAR[kind]} добавлен(а). Справочник обновлён.`);
    },
    onError: (err) => showFeedback("error", `Не удалось добавить запись: ${String((err as any)?.message ?? err)}`)
  });

  const updateM = useMutation({
    mutationFn: (p: { id: string; payload: any }) => apiPatch<any>(`${url}/${p.id}`, p.payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ref", kind] });
      await qc.invalidateQueries({ queryKey: ["ref", kind, filterHangarId, filterLayoutId] });
      if (kind === "stands" || kind === "layouts") {
        await qc.invalidateQueries({ queryKey: ["layout"] });
      }
      showFeedback("success", `${REF_SINGULAR[kind]} сохранён(а). Изменения применены.`);
    },
    onError: (err) => showFeedback("error", `Не удалось сохранить изменения: ${String((err as any)?.message ?? err)}`)
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => apiDelete<any>(`${url}/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ref", kind] });
      await qc.invalidateQueries({ queryKey: ["ref", kind, filterHangarId, filterLayoutId] });
      if (kind === "stands" || kind === "layouts") {
        await qc.invalidateQueries({ queryKey: ["layout"] });
      }
      showFeedback("success", `${REF_SINGULAR[kind]} удалён(а). Список обновлён.`);
    },
    onError: (err) => showFeedback("error", `Не удалось удалить запись: ${String((err as any)?.message ?? err)}`)
  });

  const [previewLayoutId, setPreviewLayoutId] = useState<string>("");
  const [previewStandId, setPreviewStandId] = useState<string>("");

  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState<string>("");

  // формы (минимально достаточные поля + зависимости)
  const [fCode, setFCode] = useState("");
  const [fName, setFName] = useState("");
  const [fStation, setFStation] = useState("");
  const [fIsActive, setFIsActive] = useState(true);
  const [fIsPhysical, setFIsPhysical] = useState(true);
  const [fDefaultLineBase, setFDefaultLineBase] = useState<"" | "LINE" | "BASE">("");
  const [fIcaoType, setFIcaoType] = useState("");
  const [fManufacturer, setFManufacturer] = useState("");
  const [fTailNumber, setFTailNumber] = useState("");
  const [fSerialNumber, setFSerialNumber] = useState("");
  const [fManufactureDate, setFManufactureDate] = useState("");
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
  const [fStandAircraftTypeIds, setFStandAircraftTypeIds] = useState<string[]>([]);
  const [fPriorityScore, setFPriorityScore] = useState(500);
  const [fPriorityEventTypeIds, setFPriorityEventTypeIds] = useState<string[]>([]);
  const [fPriorityAircraftTypeIds, setFPriorityAircraftTypeIds] = useState<string[]>([]);
  const [fSourceEventName, setFSourceEventName] = useState("");
  const [fSourceAircraftTypeText, setFSourceAircraftTypeText] = useState("");
  const [fConditionText, setFConditionText] = useState("");
  const [fComment, setFComment] = useState("");
  const [fSource, setFSource] = useState("");
  const [fIsDefault, setFIsDefault] = useState(false);
  const [fProfileId, setFProfileId] = useState("");
  const [fScoreCategory, setFScoreCategory] = useState("REWARD");
  const [fScoreScope, setFScoreScope] = useState("PLACEMENT");
  const [fScoreValue, setFScoreValue] = useState(0);
  const [fScoreUnit, setFScoreUnit] = useState("POINTS");
  const [fSortOrder, setFSortOrder] = useState(0);
  const [fMinutes, setFMinutes] = useState(30);
  const [fAllowsAutoInProgress, setFAllowsAutoInProgress] = useState(false);
  const [fManualOnly, setFManualOnly] = useState(false);

  const standsForPriorityQ = useQuery({
    queryKey: ["ref", "stands", "priority-form", fLayoutId],
    queryFn: () => apiGet<any[]>(fLayoutId ? `/api/ref/stands?layoutId=${encodeURIComponent(fLayoutId)}` : "/api/ref/stands"),
    enabled: kind === "placement-priorities"
  });

  const resetFormForKind = (k: RefKind) => {
    setFIsActive(true);
    setFCode("");
    setFName("");
    setFMinutes(30);
    setFIcaoType("");
    setFManufacturer("");
    setFTailNumber("");
    setFSerialNumber("");
    setFManufactureDate("");
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
    setFStandAircraftTypeIds([]);
    setFPriorityScore(500);
    setFPriorityEventTypeIds([]);
    setFPriorityAircraftTypeIds([]);
    setFSourceEventName("");
    setFSourceAircraftTypeText("");
    setFConditionText("");
    setFComment("");
    setFSource("");
    setFIsDefault(false);
    setFProfileId(optimizationProfilesQ.data?.[0]?.id ?? "");
    setFScoreCategory("REWARD");
    setFScoreScope("PLACEMENT");
    setFScoreValue(0);
    setFScoreUnit("POINTS");
    setFSortOrder(0);
    setFAllowsAutoInProgress(false);
    setFManualOnly(false);
    setFBodyType("");

    if (k === "operators") {
      setFCode("");
      setFName("");
    } else if (k === "aircraft-types") {
      setFIcaoType("");
      setFName("");
      setFManufacturer("");
      setFBodyType("");
    } else if (k === "aircraft") {
      setFTailNumber("");
      setFSerialNumber("");
      setFManufactureDate("");
      setFOperatorId("");
      setFTypeId("");
    } else if (k === "aircraft-type-palette") {
      setFOperatorId("");
      setFTypeId("");
      setFColor("#f59e0b");
    } else if (k === "event-types") {
      setFCode("");
      setFName("");
      setFColor("#3b82f6");
    } else if (k === "event-statuses") {
      setFCode("");
      setFName("");
      setFColor("");
      setFSortOrder(0);
      setFAllowsAutoInProgress(false);
      setFManualOnly(false);
    } else if (k === "workshops") {
      setFCode("");
      setFName("");
      setFDefaultLineBase("");
    } else if (k === "hangars") {
      setFCode("");
      setFName("");
      setFStation("");
      setFIsPhysical(true);
    } else if (k === "layouts") {
      setFHangarId("");
      setFCode("");
      setFName("");
      setFDescription("");
      setFWidth(0);
      setFHeight(0);
    } else if (k === "stands") {
      setFLayoutId("");
      setFCode("");
      setFName("");
      setFStandAircraftTypeIds([]);
      setFX(0);
      setFY(0);
      setFW(0);
      setFH(0);
      setFRotate(0);
    } else if (k === "skills") {
      setFCode("");
      setFName("");
    } else if (k === "persons") {
      setFCode("");
      setFName("");
      setFPersonSkillIds([]);
    } else if (k === "shifts") {
      setFCode("");
      setFName("");
      setFStartMin(0);
      setFEndMin(0);
    } else if (k === "materials") {
      setFCode("");
      setFName("");
      setFUom("");
    } else if (k === "warehouses") {
      setFCode("");
      setFName("");
    } else if (k === "placement-priorities") {
      setFHangarId("");
      setFLayoutId("");
      setFTypeId("");
      setFPriorityScore(0);
      setFPriorityEventTypeIds([]);
      setFPriorityAircraftTypeIds([]);
      setFSourceEventName("");
      setFSourceAircraftTypeText("");
      setFConditionText("");
      setFComment("");
      setFSource("");
    } else if (k === "optimization-profiles") {
      setFCode("");
      setFName("");
      setFDescription("");
      setFIsDefault(false);
    } else if (k === "optimization-score-rules") {
      setFProfileId("");
      setFCode("");
      setFName("");
      setFScoreCategory("REWARD");
      setFScoreScope("PLACEMENT");
      setFScoreValue(0);
      setFScoreUnit("POINTS");
    }
  };

  const confirmLeaveDetail = () => {
    if (!detailDirtyRef.current) return true;
    return window.confirm("Закрыть карточку без сохранения?");
  };

  const closeDetail = () => {
    detailDirtyRef.current = false;
    setMode(null);
  };

  const openCreate = () => {
    if (splitRef && !confirmLeaveDetail()) return;
    resetFormForKind(kind);
    if (kind === "aircraft" && filterAircraftTypeId) setFTypeId(filterAircraftTypeId);
    if (kind === "stands" && filterLayoutId) setFLayoutId(filterLayoutId);
    if (kind === "layouts" && filterHangarId) setFHangarId(filterHangarId);
    if (kind === "optimization-score-rules" && filterProfileId) setFProfileId(filterProfileId);
    if (isRefCardKind(kind)) {
      createM.reset();
      updateM.reset();
    }
    setMode("create");
    setEditId("");
  };

  const openEdit = (row: any) => {
    if (isRefCardKind(kind)) {
      createM.reset();
      updateM.reset();
      deleteM.reset();
    }
    setMode("edit");
    setEditId(row.id);
    setFIsActive(Boolean(row.isActive ?? true));
    setFIsPhysical(row.isPhysical !== false);
    setFDefaultLineBase(row.defaultLineBase === "LINE" || row.defaultLineBase === "BASE" ? row.defaultLineBase : "");
    setFCode(String(row.code ?? ""));
    setFName(String(row.name ?? ""));
    setFMinutes(Number(row.minutes ?? 30));
    setFStation(String(row.station ?? ""));
    setFIcaoType(String(row.icaoType ?? ""));
    setFManufacturer(String(row.manufacturer ?? ""));
    setFBodyType(String(row.bodyType ?? ""));
    setFTailNumber(String(row.tailNumber ?? ""));
    setFSerialNumber(String(row.serialNumber ?? ""));
    setFManufactureDate(toDateInputValue(row.manufactureDate));
    setFOperatorId(String(row.operatorId ?? ""));
    setFTypeId(String(kind === "placement-priorities" ? row.standId ?? "" : row.typeId ?? row.aircraftTypeId ?? ""));
    setFColor(String(row.color ?? (kind === "event-statuses" ? "" : "#3b82f6")));
    setFHangarId(String(row.hangarId ?? ""));
    setFLayoutId(String(row.layoutId ?? ""));
    setFDescription(String(row.description ?? ""));
    setFWidth(kind === "layouts" ? Number(row.widthMeters ?? 0) : Number(row.widthMeters ?? 60));
    setFHeight(kind === "layouts" ? Number(row.heightMeters ?? 0) : Number(row.heightMeters ?? 40));
    setFX(Number(row.x ?? 0));
    setFY(Number(row.y ?? 0));
    setFW(kind === "stands" ? Number(row.w ?? 0) : Number(row.w ?? 18));
    setFH(kind === "stands" ? Number(row.h ?? 0) : Number(row.h ?? 10));
    setFRotate(Number(row.rotate ?? 0));
    setFBodyType(String(row.bodyType ?? ""));
    setFStartMin(Number(row.startMin ?? 8 * 60));
    setFEndMin(Number(row.endMin ?? 20 * 60));
    setFUom(String(row.uom ?? "EA"));
    setFPriorityScore(Number(row.priorityScore ?? 500));
    setFPriorityEventTypeIds(
      Array.isArray(row.eventTypes) ? row.eventTypes.map((link: any) => String(link.eventType?.id ?? link.eventTypeId ?? "")).filter(Boolean) : []
    );
    setFPriorityAircraftTypeIds(
      Array.isArray(row.aircraftTypes) ? row.aircraftTypes.map((link: any) => String(link.aircraftType?.id ?? link.aircraftTypeId ?? "")).filter(Boolean) : []
    );
    setFSourceEventName(String(row.sourceEventName ?? ""));
    setFSourceAircraftTypeText(String(row.sourceAircraftTypeText ?? ""));
    setFConditionText(String(row.conditionText ?? ""));
    setFComment(String(row.comment ?? ""));
    setFSource(String(row.source ?? ""));
    setFIsDefault(Boolean(row.isDefault ?? false));
    setFProfileId(String(row.profileId ?? row.profile?.id ?? optimizationProfilesQ.data?.[0]?.id ?? ""));
    setFScoreCategory(String(row.category ?? "REWARD"));
    setFScoreScope(String(row.scope ?? "PLACEMENT"));
    setFScoreValue(Number(row.value ?? 0));
    setFScoreUnit(String(row.unit ?? "POINTS"));
    setFSortOrder(Number(row.sortOrder ?? 0));
    setFAllowsAutoInProgress(Boolean(row.allowsAutoInProgress));
    setFManualOnly(Boolean(row.manualOnly));
    setFPersonSkillIds(
      Array.isArray(row.skills) ? row.skills.map((s: any) => String(s.skill?.id ?? s.skillId ?? "")).filter(Boolean) : []
    );
    setFStandAircraftTypeIds(standAllowedAircraftTypeIds(row));
  };

  useEffect(() => {
    if (isRefCardKind(kind) || mode !== "edit" || !editId) return;
    window.setTimeout(() => {
      document.getElementById("ref-editor-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 0);
  }, [editId, mode, kind]);

  const buildPayload = () => {
    if (kind === "operators") return { code: fCode.trim(), name: fName.trim(), isActive: fIsActive };
    if (kind === "tow-norms") return { name: fName.trim(), minutes: fMinutes, isActive: fIsActive };
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
        serialNumber: fSerialNumber.trim() ? fSerialNumber.trim() : mode === "edit" ? null : undefined,
        manufactureDate: dateInputToIso(fManufactureDate) ?? (mode === "edit" ? null : undefined),
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
        code: fCode.trim() ? fCode.trim() : mode === "edit" ? null : undefined,
        name: fName.trim(),
        isActive: fIsActive
      };
    if (kind === "shifts") return { code: fCode.trim(), name: fName.trim(), startMin: fStartMin, endMin: fEndMin, isActive: fIsActive };
    if (kind === "materials") return { code: fCode.trim(), name: fName.trim(), uom: fUom.trim(), isActive: fIsActive };
    if (kind === "warehouses") return { code: fCode.trim(), name: fName.trim(), isActive: fIsActive };
    if (kind === "placement-priorities")
      return {
        hangarId: fHangarId,
        layoutId: fLayoutId,
        standId: fTypeId,
        priorityScore: fPriorityScore,
        sourceEventName: fSourceEventName.trim() ? fSourceEventName.trim() : null,
        sourceAircraftTypeText: fSourceAircraftTypeText.trim() ? fSourceAircraftTypeText.trim() : null,
        conditionText: fConditionText.trim() ? fConditionText.trim() : null,
        comment: fComment.trim() ? fComment.trim() : null,
        source: fSource.trim() ? fSource.trim() : null,
        isActive: fIsActive,
        eventTypeIds: fPriorityEventTypeIds,
        aircraftTypeIds: fPriorityAircraftTypeIds
      };
    if (kind === "optimization-profiles")
      return {
        code: fCode.trim(),
        name: fName.trim(),
        description: fDescription.trim() ? fDescription.trim() : null,
        isDefault: fIsDefault,
        isActive: fIsActive
      };
    if (kind === "optimization-score-rules")
      return {
        profileId: fProfileId,
        code: fCode.trim(),
        name: fName.trim(),
        category: fScoreCategory,
        scope: fScoreScope,
        value: fScoreValue,
        unit: fScoreUnit,
        isActive: fIsActive
      };
    if (kind === "event-types")
      return { code: fCode.trim(), name: fName.trim(), color: fColor.trim() ? fColor.trim() : undefined, isActive: fIsActive };
    if (kind === "event-statuses")
      return {
        ...(mode === "create" ? { code: fCode.trim().toUpperCase().replace(/[\s-]+/g, "_") } : {}),
        name: fName.trim(),
        color: fColor.trim() ? fColor.trim() : null,
        sortOrder: Number.isFinite(fSortOrder) ? fSortOrder : 0,
        selectable: fIsActive,
        isActive: fIsActive,
        allowsAutoInProgress: fAllowsAutoInProgress,
        manualOnly: fManualOnly
      };
    if (kind === "workshops")
      return {
        code: fCode.trim(),
        name: fName.trim(),
        defaultLineBase: fDefaultLineBase === "LINE" || fDefaultLineBase === "BASE" ? fDefaultLineBase : null,
        isActive: fIsActive
      };
    if (kind === "hangars") {
      return {
        code: fCode.trim(),
        name: fName.trim(),
        station: fStation.trim() ? fStation.trim().toUpperCase() : null,
        isPhysical: fIsPhysical,
        isActive: fIsActive
      };
    }
    if (kind === "layouts")
      return {
        ...(mode === "create" ? { hangarId: fHangarId } : {}),
        code: fCode.trim(),
        name: fName.trim(),
        description: fDescription.trim() ? fDescription.trim() : mode === "edit" ? null : undefined,
        widthMeters: fWidth > 0 ? fWidth : mode === "edit" ? null : undefined,
        heightMeters: fHeight > 0 ? fHeight : mode === "edit" ? null : undefined,
        isActive: fIsActive
      };
    if (kind === "stands")
      return {
        ...(mode === "create" ? { layoutId: fLayoutId } : {}),
        code: fCode.trim(),
        name: fName.trim(),
        bodyType: fBodyType === "NARROW_BODY" || fBodyType === "WIDE_BODY" ? fBodyType : null,
        aircraftTypeIds: fStandAircraftTypeIds,
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
    const raw = listQ.data ?? [];
    const rows =
      kind === "event-statuses"
        ? raw.map((row: any) => ({
            ...row,
            id: row.code,
            isActive: row.selectable !== false
          }))
        : kind === "tow-norms"
          ? raw.map((row: any) => ({
              ...row,
              id: row.code
            }))
          : raw;
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
        row.description,
        row.conditionText,
        row.comment,
        row.sourceEventName,
        row.sourceAircraftTypeText,
        row.source,
        row.profile?.name,
        row.hangar?.name,
        row.layout?.name,
        row.layout?.hangar?.name,
        row.stand?.name,
        row.standsSummary,
        row.uom,
        row.profile?.code,
        ...(Array.isArray(row.skills)
          ? row.skills.flatMap((link: { skill?: { code?: string | null; name?: string | null } | null }) => [link?.skill?.code, link?.skill?.name])
          : []),
        ...(Array.isArray(row.eventTypes)
          ? row.eventTypes.flatMap((link: { eventType?: { code?: string | null; name?: string | null } | null }) => [link?.eventType?.code, link?.eventType?.name])
          : []),
        ...(Array.isArray(row.aircraftTypes)
          ? row.aircraftTypes.flatMap((link: { aircraftType?: { name?: string | null; icaoType?: string | null } | null }) => [
              link?.aircraftType?.name,
              link?.aircraftType?.icaoType
            ])
          : []),
        ...(Array.isArray(row.allowedAircraftTypes)
          ? row.allowedAircraftTypes.flatMap((link: { aircraftType?: { name?: string | null; icaoType?: string | null } | null }) => [
              link?.aircraftType?.name,
              link?.aircraftType?.icaoType
            ])
          : []),
        ...(Array.isArray(row.aircraftTypeNames) ? row.aircraftTypeNames : [])
      ];
      return fields.some((f) => f != null && String(f).toLowerCase().includes(q));
    });
  }, [listQ.data, search, kind]);

  const totalCount = listQ.data?.length ?? 0;
  const effectivePreviewLayoutId = useMemo(() => {
    if (previewLayoutId) return previewLayoutId;
    return "";
  }, [previewLayoutId]);
  const previewQ = useQuery({
    queryKey: ["layout", "preview", effectivePreviewLayoutId],
    queryFn: () => apiGet<LayoutDetail>(`/api/ref/layouts/${effectivePreviewLayoutId}`),
    enabled: (kind === "layouts" || kind === "stands") && Boolean(effectivePreviewLayoutId)
  });

  const renderRemainingCard = (docked: boolean) => (
    <RemainingRefCard
      key={`${kind}:${mode}:${editId}`}
      kind={kind as RemainingRefKind}
      docked={docked}
      onDirtyChange={
        docked
          ? (dirty) => {
              detailDirtyRef.current = dirty;
            }
          : undefined
      }
      mode={mode === "create" ? "create" : "edit"}
      values={{
        code: fCode,
        name: fName,
        isActive: fIsActive,
        color: fColor,
        sortOrder: fSortOrder,
        allowsAutoInProgress: fAllowsAutoInProgress,
        manualOnly: fManualOnly,
        defaultLineBase: fDefaultLineBase,
        uom: fUom,
        personSkillIds: fPersonSkillIds,
        startMin: fStartMin,
        endMin: fEndMin,
        description: fDescription,
        isDefault: fIsDefault,
        profileId: fProfileId,
        scoreCategory: fScoreCategory,
        scoreScope: fScoreScope,
        scoreValue: fScoreValue,
        scoreUnit: fScoreUnit,
        hangarId: fHangarId,
        layoutId: fLayoutId,
        standId: fTypeId,
        priorityScore: fPriorityScore,
        priorityEventTypeIds: fPriorityEventTypeIds,
        priorityAircraftTypeIds: fPriorityAircraftTypeIds,
        sourceEventName: fSourceEventName,
        sourceAircraftTypeText: fSourceAircraftTypeText,
        conditionText: fConditionText,
        comment: fComment,
        source: fSource
      }}
      canEdit={canMutate}
      saving={createM.isPending || updateM.isPending}
      deleting={deleteM.isPending}
      error={cardMutationError(createM.error, updateM.error, deleteM.error)}
      record={mode === "edit" ? ((listQ.data ?? []).find((row: { id?: string }) => row.id === editId) ?? null) : null}
      showTech={isAdmin && mode === "edit"}
      skills={(skillsQ.data ?? []).map((item) => ({ id: item.id, label: `${item.code} • ${item.name}` }))}
      eventTypes={eventTypeOptions}
      aircraftTypes={aircraftTypeOptions}
      hangars={(hangarsQ.data ?? []).map((item) => ({ id: item.id, label: item.name }))}
      layouts={(layoutsForStandsQ.data ?? []).map((item) => ({ id: item.id, label: item.name, hangarId: item.hangarId }))}
      stands={(standsForPriorityQ.data ?? []).map((item) => ({ id: item.id, label: item.code ? `${item.code} · ${item.name ?? ""}`.trim() : item.name }))}
      profiles={(optimizationProfilesQ.data ?? []).map((item) => ({ id: item.id, label: item.isDefault ? `${item.name} · по умолчанию` : item.name }))}
      onChange={(patch: Partial<RemainingRefValues>) => {
        if (patch.code != null) setFCode(patch.code);
        if (patch.name != null) setFName(patch.name);
        if (patch.isActive != null) setFIsActive(patch.isActive);
        if (patch.color != null) setFColor(patch.color);
        if (patch.sortOrder != null) setFSortOrder(patch.sortOrder);
        if (patch.allowsAutoInProgress != null) setFAllowsAutoInProgress(patch.allowsAutoInProgress);
        if (patch.manualOnly != null) setFManualOnly(patch.manualOnly);
        if (patch.defaultLineBase != null) setFDefaultLineBase(patch.defaultLineBase);
        if (patch.uom != null) setFUom(patch.uom);
        if (patch.personSkillIds != null) setFPersonSkillIds(patch.personSkillIds);
        if (patch.startMin != null) setFStartMin(patch.startMin);
        if (patch.endMin != null) setFEndMin(patch.endMin);
        if (patch.description != null) setFDescription(patch.description);
        if (patch.isDefault != null) setFIsDefault(patch.isDefault);
        if (patch.profileId != null) setFProfileId(patch.profileId);
        if (patch.scoreCategory != null) setFScoreCategory(patch.scoreCategory);
        if (patch.scoreScope != null) setFScoreScope(patch.scoreScope);
        if (patch.scoreValue != null) setFScoreValue(patch.scoreValue);
        if (patch.scoreUnit != null) setFScoreUnit(patch.scoreUnit);
        if (patch.hangarId != null) setFHangarId(patch.hangarId);
        if (patch.layoutId != null) setFLayoutId(patch.layoutId);
        if (patch.standId != null) setFTypeId(patch.standId);
        if (patch.priorityScore != null) setFPriorityScore(patch.priorityScore);
        if (patch.priorityEventTypeIds != null) setFPriorityEventTypeIds(patch.priorityEventTypeIds);
        if (patch.priorityAircraftTypeIds != null) setFPriorityAircraftTypeIds(patch.priorityAircraftTypeIds);
        if (patch.sourceEventName != null) setFSourceEventName(patch.sourceEventName);
        if (patch.sourceAircraftTypeText != null) setFSourceAircraftTypeText(patch.sourceAircraftTypeText);
        if (patch.conditionText != null) setFConditionText(patch.conditionText);
        if (patch.comment != null) setFComment(patch.comment);
        if (patch.source != null) setFSource(patch.source);
      }}
      onClose={closeDetail}
      onSave={() => {
        const payload = buildPayload();
        const finish = async (id: string) => {
          try {
            if (kind === "persons" && id) {
              await apiPut(`/api/ref/persons/${id}/skills`, {
                skills: fPersonSkillIds.map((skillId) => ({ skillId }))
              });
              await qc.invalidateQueries({ queryKey: ["ref", "persons"] });
            }
            closeDetail();
          } catch (err) {
            showFeedback("error", `Не удалось сохранить квалификации: ${String((err as { message?: string })?.message ?? err)}`);
          }
        };
        if (mode === "create") createM.mutate(payload, { onSuccess: (created) => void finish(String(created?.id ?? "")) });
        else updateM.mutate({ id: editId, payload }, { onSuccess: (updated) => void finish(String(updated?.id ?? editId)) });
      }}
      onDelete={() => {
        if (!editId || !confirm("Удалить запись?")) return;
        deleteM.mutate(editId, { onSuccess: closeDetail });
      }}
    />
  );

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
                        if (splitRef && it.kind !== kind && !confirmLeaveDetail()) return;
                        setKind(it.kind);
                        setSearch("");
                        setFilterAircraftTypeId("");
                        setFilterProfileId("");
                        closeDetail();
                        setFeedback(null);
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
            {kind === "placement-priorities" ? (
              <>
                <label className="refHeaderFilter">
                  <span className="muted">Ангар</span>
                  <select
                    value={filterHangarId}
                    onChange={(e) => {
                      setFilterHangarId(e.target.value);
                      setFilterLayoutId("");
                    }}
                  >
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
            {kind === "optimization-score-rules" ? (
              <label className="refHeaderFilter">
                <span className="muted">Профиль</span>
                <select value={filterProfileId} onChange={(e) => setFilterProfileId(e.target.value)}>
                  <option value="">все</option>
                  {(optimizationProfilesQ.data ?? []).map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {isRefCardKind(kind) && kind !== "tow-norms" ? (
              <RefExcelButton
                disabled={!listQ.data?.length}
                onClick={() => {
                  if (kind === "operators") downloadOperatorsXlsx(listQ.data ?? []);
                  else if (kind === "aircraft-types") downloadAircraftTypesXlsx(listQ.data ?? []);
                  else if (kind === "aircraft") downloadAircraftXlsx(listQ.data ?? []);
                  else if (kind === "aircraft-type-palette") downloadPaletteXlsx(listQ.data ?? []);
                  else if (kind === "hangars") downloadHangarsXlsx(listQ.data ?? []);
                  else if (kind === "layouts") downloadLayoutsXlsx(listQ.data ?? []);
                  else if (kind === "stands") downloadStandsXlsx(listQ.data ?? []);
                  else if (isRemainingRefKind(kind)) downloadRemainingRefXlsx(kind, listQ.data ?? []);
                }}
              />
            ) : null}
            {canCreate && !splitRef && kind !== "tow-norms" ? (
              <button className="btn btnPrimary" onClick={openCreate}>
                + Добавить
              </button>
            ) : null}
            {catalogKind && (changeReasonCatalog ? isAdmin : canWrite) ? (
              <button className="btn btnPrimary" type="button" onClick={() => catalogCreateRef.current?.()}>
                + Добавить
              </button>
            ) : null}
          </div>
        </div>

        {feedback ? (
          <div className={`refFeedback refFeedback_${feedback.type}`} role={feedback.type === "error" ? "alert" : "status"}>
            <span>{feedback.message}</span>
            <button type="button" onClick={() => setFeedback(null)} aria-label="Закрыть уведомление">
              ×
            </button>
          </div>
        ) : null}
      {(kind === "layouts" || kind === "stands") && effectivePreviewLayoutId ? (
        <div id="ref-scheme-preview" className="card refSection">
          <div className="refSectionHeader">
            <div>
              <strong>Визуальная схема</strong>
              <div className="muted refSectionHint">Предпросмотр выбранного варианта расстановки и его мест стоянки.</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted small">layout: {previewQ.data?.code ?? "…"}</span>
              <button className="btn btnGhost" type="button" onClick={() => {
                setPreviewLayoutId("");
                setPreviewStandId("");
              }}>
                Скрыть
              </button>
            </div>
          </div>
          <LayoutSchemePreview detail={previewQ.data ?? null} selectedStandId={previewStandId} />
        </div>
      ) : null}

      {showInlineRefEditor(mode, kind) ? (
        <div id="ref-editor-panel" className="card refSection refEditorPanel">
          <div className="refSectionHeader">
            <div>
              <strong>{mode === "create" ? "Создание" : "Редактирование"}</strong>
              <div className="muted refSectionHint">
                {REF_SINGULAR[kind]}
                {mode === "edit" ? " · выбранная строка подсвечена в списке" : ""}
                {kind === "event-statuses"
                  ? mode === "create"
                    ? " · латинский код, название и цвет полоски на Гантте"
                    : " · системный код менять нельзя"
                  : ""}
              </div>
            </div>
            <button className="btn" onClick={() => setMode(null)}>
              Закрыть
            </button>
          </div>

          <div className={`refForm refForm_${kind}`}>
            {kind === "operators" ||
            kind === "event-types" ||
            kind === "workshops" ||
            kind === "hangars" ||
            kind === "layouts" ||
            kind === "stands" ||
            kind === "skills" ||
            kind === "persons" ||
            kind === "shifts" ||
            kind === "materials" ||
            kind === "warehouses" ||
            kind === "optimization-profiles" ||
            kind === "optimization-score-rules" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Код</span>
                <TextInput value={fCode} onChange={setFCode} style={{ width: 220 }} />
              </label>
            ) : null}

            {kind === "event-statuses" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Код</span>
                <input
                  value={fCode}
                  readOnly={mode !== "create"}
                  onChange={(e) => setFCode(e.target.value.toUpperCase())}
                  style={{ width: 280, opacity: mode === "create" ? 1 : 0.72 }}
                />
              </label>
            ) : null}

            {kind === "aircraft-types" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">ICAO</span>
                <TextInput value={fIcaoType} onChange={setFIcaoType} maxLength={25} style={{ width: 220 }} />
              </label>
            ) : null}

            {kind === "aircraft" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Бортовой номер</span>
                <TextInput value={fTailNumber} onChange={setFTailNumber} style={{ width: 220 }} />
              </label>
            ) : null}

            {kind !== "aircraft" && kind !== "persons" && kind !== "aircraft-type-palette" && kind !== "placement-priorities" ? (
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
                  <>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span className="muted">Зав. №</span>
                      <TextInput value={fSerialNumber} onChange={setFSerialNumber} style={{ width: 220 }} />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span className="muted">Дата производства ВС</span>
                      <input
                        type="date"
                        value={fManufactureDate}
                        onChange={(e) => setFManufactureDate(e.target.value)}
                        style={{ width: 220 }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span className="muted">Возраст ВС</span>
                      <div style={{ width: 220, padding: "8px 0" }}>
                        {formatAircraftAge(fManufactureDate) ?? <span className="muted">— укажите дату производства</span>}
                      </div>
                    </label>
                  </>
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

            {kind === "event-statuses" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Цвет полоски на Гантте</span>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/i.test(fColor) ? fColor : "#cccccc"}
                      onChange={(e) => setFColor(e.target.value)}
                    />
                    <TextInput value={fColor} onChange={setFColor} placeholder="#RRGGBB или пусто" style={{ width: 160 }} />
                    {fColor ? (
                      <button type="button" className="btn btnGhost" onClick={() => setFColor("")}>
                        Без полоски
                      </button>
                    ) : null}
                  </div>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Порядок</span>
                  <NumberInput value={fSortOrder} onChange={setFSortOrder} step={10} style={{ width: 140 }} />
                </label>
                <SwitchToggle
                  checked={fAllowsAutoInProgress}
                  onChange={setFAllowsAutoInProgress}
                  disabled={editId === "DELETED" || editId === "CANCELLED"}
                  label="Автоперевод в «В работе»"
                  hint="После наступления оперативного начала событие само перейдёт во «В работе». Для статусов «На согласовании» по умолчанию выключено."
                />
                <SwitchToggle
                  checked={fManualOnly}
                  onChange={setFManualOnly}
                  disabled={editId === "DELETED"}
                  label="Только вручную"
                  hint="Не слать уведомление о просрочке без факта. Автоперевод в «В работе» для такого статуса всё равно задаётся переключателем выше."
                />
              </>
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
                      <option key={l.id} value={l.id} title={l.standsSummary || undefined}>
                        {l.name}
                        {l.standsSummary ? ` (${l.standsSummary})` : l.capacitySummary ? ` (${l.capacitySummary})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Типы ВС</span>
                  <MultiSelectDropdown
                    options={aircraftTypeOptions}
                    value={fStandAircraftTypeIds}
                    onChange={setFStandAircraftTypeIds}
                    placeholder="любой ВС"
                    width={320}
                    maxHeight={340}
                    searchable
                    selectedLabelMode="labels"
                  />
                  <span className="muted" style={{ fontSize: 11 }}>
                    Если типы не выбраны, место доступно для любого ВС.
                  </span>
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

            {kind === "placement-priorities" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Ангар</span>
                  <select
                    value={fHangarId}
                    onChange={(e) => {
                      setFHangarId(e.target.value);
                      setFLayoutId("");
                      setFTypeId("");
                    }}
                    style={{ width: 240 }}
                  >
                    {(hangarsQ.data ?? []).map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Вариант</span>
                  <select
                    value={fLayoutId}
                    onChange={(e) => {
                      setFLayoutId(e.target.value);
                      setFTypeId("");
                    }}
                    style={{ width: 280 }}
                  >
                    <option value="">— выберите —</option>
                    {(layoutsForStandsQ.data ?? [])
                      .filter((l) => !fHangarId || l.hangarId === fHangarId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Место</span>
                  <select value={fTypeId} onChange={(e) => setFTypeId(e.target.value)} style={{ width: 220 }}>
                    <option value="">— выберите —</option>
                    {(standsForPriorityQ.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Балл приоритета</span>
                  <NumberInput value={fPriorityScore} onChange={setFPriorityScore} step={50} style={{ width: 140 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Типы событий (ИЛИ)</span>
                  <MultiSelectDropdown
                    options={eventTypeOptions}
                    value={fPriorityEventTypeIds}
                    onChange={setFPriorityEventTypeIds}
                    placeholder="любой тип события"
                    width={320}
                    searchable
                    selectedLabelMode="labels"
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Типы ВС (ИЛИ)</span>
                  <MultiSelectDropdown
                    options={aircraftTypeOptions}
                    value={fPriorityAircraftTypeIds}
                    onChange={setFPriorityAircraftTypeIds}
                    placeholder="любой ВС"
                    width={320}
                    searchable
                    selectedLabelMode="labels"
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Исходное событие</span>
                  <TextInput value={fSourceEventName} onChange={setFSourceEventName} style={{ width: 220 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Исходный тип ВС</span>
                  <TextInput value={fSourceAircraftTypeText} onChange={setFSourceAircraftTypeText} style={{ width: 220 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Условие</span>
                  <TextInput value={fConditionText} onChange={setFConditionText} style={{ width: 360 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Комментарий</span>
                  <TextInput value={fComment} onChange={setFComment} style={{ width: 360 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Источник</span>
                  <TextInput value={fSource} onChange={setFSource} style={{ width: 220 }} />
                </label>
              </>
            ) : null}

            {kind === "optimization-profiles" ? (
              <>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Описание</span>
                  <TextInput value={fDescription} onChange={setFDescription} style={{ width: 360 }} />
                </label>
                <SwitchToggle
                  compact
                  checked={fIsDefault}
                  onChange={setFIsDefault}
                  label="профиль по умолчанию"
                />
              </>
            ) : null}

            {kind === "optimization-score-rules" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Профиль</span>
                  <select value={fProfileId} onChange={(e) => setFProfileId(e.target.value)} style={{ width: 260 }}>
                    {(optimizationProfilesQ.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.isDefault ? " · по умолчанию" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Категория</span>
                  <select value={fScoreCategory} onChange={(e) => setFScoreCategory(e.target.value)} style={{ width: 180 }}>
                    <option value="REWARD">Поощрение</option>
                    <option value="PENALTY">Штраф</option>
                    <option value="LIMIT">Ограничение</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Область</span>
                  <select value={fScoreScope} onChange={(e) => setFScoreScope(e.target.value)} style={{ width: 220 }}>
                    <option value="NEW_EVENT">Новое событие</option>
                    <option value="EXISTING_EVENT">Существующее событие</option>
                    <option value="PLACEMENT">Размещение</option>
                    <option value="LAYOUT">Вариант</option>
                    <option value="STAND">Место</option>
                    <option value="TOW">Буксировка</option>
                    <option value="PRIORITY">Приоритет</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Значение</span>
                  <NumberInput value={fScoreValue} onChange={setFScoreValue} step={10} style={{ width: 140 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Единица</span>
                  <select value={fScoreUnit} onChange={(e) => setFScoreUnit(e.target.value)} style={{ width: 180 }}>
                    <option value="POINTS">Баллы</option>
                    <option value="POINTS_PER_HOUR">Баллы/час</option>
                    <option value="HOURS">Часы</option>
                    <option value="BOOLEAN">Да/нет</option>
                    <option value="MULTIPLIER">Множитель</option>
                  </select>
                </label>
              </>
            ) : null}

            {kind === "workshops" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Контур L/B по умолчанию</span>
                <select
                  value={fDefaultLineBase}
                  onChange={(e) => setFDefaultLineBase(e.target.value === "LINE" || e.target.value === "BASE" ? e.target.value : "")}
                  style={{ width: 220 }}
                >
                  <option value="">— не задан —</option>
                  <option value="LINE">L (Line)</option>
                  <option value="BASE">B (Base)</option>
                </select>
              </label>
            ) : null}

            {kind === "hangars" ? (
              <>
                <label className="tgField">
                  <span className="tgFieldLabel">Станция</span>
                  <TextInput
                    value={fStation}
                    onChange={setFStation}
                    placeholder="SVO / REN"
                    style={{ width: 220 }}
                  />
                </label>
                <SwitchToggle
                  checked={fIsPhysical}
                  onChange={setFIsPhysical}
                  label="Физический ангар площадки"
                  hint="Выключите для внешнего MRO / стороннего контура (удобно для потребности на Гантте)."
                />
              </>
            ) : null}

            <BoolToggle
              value={fIsActive}
              onChange={setFIsActive}
              label={kind === "event-statuses" ? "показывать в форме" : undefined}
              disabled={kind === "event-statuses" && editId === "DELETED"}
            />

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
        {changeReasonCatalog ? (
          <ChangeReasonsPanel search={search} canWrite={isAdmin} createActionRef={catalogCreateRef} />
        ) : isPersonnelCatalogKind(kind) ? (
          <PersonnelCatalogPanel kind={kind} search={search} canWrite={canWrite} createActionRef={catalogCreateRef} />
        ) : listQ.error ? (
          <div className="error" style={{ marginBottom: 8 }}>
            {String(listQ.error.message || listQ.error)}
          </div>
        ) : null}
        {!catalogKind && !splitRef && (listQ.data ?? []).length === 0 && !listQ.isFetching ? (
          <div className="refEmpty">
            <div className="refEmptyTitle">
              {search ? "Ничего не найдено" : "Записей пока нет"}
            </div>
            <div className="muted">
              {search
                ? "Попробуйте изменить запрос или очистить поиск."
                : kind === "event-statuses"
                  ? "Нажмите «Добавить», чтобы создать пользовательский статус. Системные коды задают логику планирования."
                  : canMutate
                    ? "Нажмите «Добавить», чтобы создать первую запись."
                    : "Обратитесь к администратору для наполнения справочника."}
            </div>
          </div>
        ) : kind === "tow-norms" ? (
          <TowNormsTable rows={filteredRows as TowNormRow[]} editingId={mode === "edit" ? editId : ""} onOpen={openEdit} />
        ) : kind === "operators" ? (
          <OperatorsTable rows={filteredRows} editingId={mode === "edit" ? editId : ""} onOpen={openEdit} />
        ) : kind === "aircraft-types" ? (
          <AircraftTypesTable rows={filteredRows} editingId={mode === "edit" ? editId : ""} onOpen={openEdit} />
        ) : kind === "aircraft" ? (
          <AircraftLibrary
            types={aircraftTypesQ.data ?? []}
            rows={filteredRows}
            typeId={filterAircraftTypeId}
            selectedId={mode === "edit" ? editId : ""}
            canAdd={canMutate}
            onSelectType={setFilterAircraftTypeId}
            onOpen={(row) => {
              if ((mode !== "edit" || editId !== row.id) && !confirmLeaveDetail()) return;
              openEdit(row);
            }}
            onAdd={openCreate}
            detail={
              mode ? (
                <AircraftCardModal
                  key={`${mode}:${editId}`}
                  docked
                  mode={mode}
                  tailNumber={fTailNumber}
                  operatorId={fOperatorId}
                  typeId={fTypeId}
                  serialNumber={fSerialNumber}
                  manufactureDate={fManufactureDate}
                  isActive={fIsActive}
                  operators={(operatorsQ.data ?? []).map((item) => ({ id: item.id, label: item.name }))}
                  types={(aircraftTypesQ.data ?? []).map((item) => ({ id: item.id, label: item.name }))}
                  canEdit={canMutate}
                  saving={createM.isPending || updateM.isPending}
                  deleting={deleteM.isPending}
                  error={cardMutationError(createM.error, updateM.error, deleteM.error)}
                  record={mode === "edit" ? ((listQ.data ?? []).find((row: { id?: string }) => row.id === editId) ?? null) : null}
                  showTech={isAdmin && mode === "edit"}
                  onDirtyChange={(dirty) => {
                    detailDirtyRef.current = dirty;
                  }}
                  onChange={(patch) => {
                    if (patch.tailNumber != null) setFTailNumber(patch.tailNumber);
                    if (patch.operatorId != null) setFOperatorId(patch.operatorId);
                    if (patch.typeId != null) setFTypeId(patch.typeId);
                    if (patch.serialNumber != null) setFSerialNumber(patch.serialNumber);
                    if (patch.manufactureDate != null) setFManufactureDate(patch.manufactureDate);
                    if (patch.isActive != null) setFIsActive(patch.isActive);
                  }}
                  onClose={closeDetail}
                  onSave={() => {
                    const payload = buildPayload();
                    if (mode === "create") createM.mutate(payload, { onSuccess: closeDetail });
                    else updateM.mutate({ id: editId, payload }, { onSuccess: closeDetail });
                  }}
                  onDelete={() => {
                    if (!editId || !confirm("Удалить борт?")) return;
                    deleteM.mutate(editId, { onSuccess: closeDetail });
                  }}
                />
              ) : (
                <div className="refDetailEmpty">Выберите борт слева или добавьте новый.</div>
              )
            }
          />
        ) : kind === "aircraft-type-palette" ? (
          <PaletteTable rows={filteredRows} editingId={mode === "edit" ? editId : ""} onOpen={openEdit} />
        ) : kind === "hangars" ? (
          <HangarsTable rows={filteredRows} editingId={mode === "edit" ? editId : ""} onOpen={openEdit} />
        ) : kind === "layouts" ? (
          <LayoutsLibrary
            hangars={hangarsQ.data ?? []}
            rows={filteredRows}
            hangarId={filterHangarId}
            selectedId={mode === "edit" ? editId : ""}
            canAdd={canMutate}
            onSelectHangar={setFilterHangarId}
            onOpen={(row) => {
              if ((mode !== "edit" || editId !== row.id) && !confirmLeaveDetail()) return;
              openEdit(row);
            }}
            onAdd={openCreate}
            detail={
              mode ? (
                <LayoutCardModal
                  key={`${mode}:${editId}`}
                  docked
                  mode={mode}
                  hangarId={fHangarId}
                  code={fCode}
                  name={fName}
                  description={fDescription}
                  width={fWidth}
                  height={fHeight}
                  isActive={fIsActive}
                  hangars={(hangarsQ.data ?? []).map((item) => ({ id: item.id, label: item.name }))}
                  canEdit={canMutate}
                  saving={createM.isPending || updateM.isPending}
                  deleting={deleteM.isPending}
                  error={cardMutationError(createM.error, updateM.error, deleteM.error)}
                  record={mode === "edit" ? ((listQ.data ?? []).find((row: { id?: string }) => row.id === editId) ?? null) : null}
                  showTech={isAdmin && mode === "edit"}
                  onDirtyChange={(dirty) => {
                    detailDirtyRef.current = dirty;
                  }}
                  onChange={(patch) => {
                    if (patch.hangarId != null) setFHangarId(patch.hangarId);
                    if (patch.code != null) setFCode(patch.code);
                    if (patch.name != null) setFName(patch.name);
                    if (patch.description != null) setFDescription(patch.description);
                    if (patch.width != null) setFWidth(patch.width);
                    if (patch.height != null) setFHeight(patch.height);
                    if (patch.isActive != null) setFIsActive(patch.isActive);
                  }}
                  onClose={closeDetail}
                  onSave={() => {
                    const payload = buildPayload();
                    if (mode === "create") createM.mutate(payload, { onSuccess: closeDetail });
                    else updateM.mutate({ id: editId, payload }, { onSuccess: closeDetail });
                  }}
                  onDelete={() => {
                    if (!editId || !confirm("Удалить вариант расстановки?")) return;
                    deleteM.mutate(editId, { onSuccess: closeDetail });
                  }}
                  onShowScheme={() => {
                    closeDetail();
                    setPreviewLayoutId(editId);
                    setPreviewStandId("");
                    window.setTimeout(() => document.getElementById("ref-scheme-preview")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
                  }}
                />
              ) : (
                <div className="refDetailEmpty">Выберите вариант слева или добавьте новый.</div>
              )
            }
          />
        ) : kind === "stands" ? (
          <StandsLibrary
            hangars={hangarsQ.data ?? []}
            layouts={layoutsForStandsQ.data ?? []}
            rows={filteredRows}
            hangarId={filterHangarId}
            layoutId={filterLayoutId}
            selectedId={mode === "edit" ? editId : ""}
            canAdd={canMutate}
            onSelectHangar={(id) => {
              setFilterHangarId(id);
              setFilterLayoutId("");
            }}
            onSelectLayout={setFilterLayoutId}
            onOpen={(row) => {
              if ((mode !== "edit" || editId !== row.id) && !confirmLeaveDetail()) return;
              openEdit(row);
            }}
            onAdd={openCreate}
            detail={
              mode ? (
                <StandCardModal
                  key={`${mode}:${editId}`}
                  docked
                  mode={mode}
                  layoutId={fLayoutId}
                  code={fCode}
                  name={fName}
                  aircraftTypeIds={fStandAircraftTypeIds}
                  x={fX}
                  y={fY}
                  w={fW}
                  h={fH}
                  rotate={fRotate}
                  isActive={fIsActive}
                  layouts={(layoutsForStandsQ.data ?? []).map((item) => ({
                    id: item.id,
                    label: item.hangar?.name ? `${item.hangar.name} · ${item.name}` : item.name
                  }))}
                  aircraftTypes={aircraftTypeOptions}
                  canEdit={canMutate}
                  saving={createM.isPending || updateM.isPending}
                  deleting={deleteM.isPending}
                  error={cardMutationError(createM.error, updateM.error, deleteM.error)}
                  record={mode === "edit" ? ((listQ.data ?? []).find((row: { id?: string }) => row.id === editId) ?? null) : null}
                  showTech={isAdmin && mode === "edit"}
                  onDirtyChange={(dirty) => {
                    detailDirtyRef.current = dirty;
                  }}
                  onChange={(patch) => {
                    if (patch.layoutId != null) setFLayoutId(patch.layoutId);
                    if (patch.code != null) setFCode(patch.code);
                    if (patch.name != null) setFName(patch.name);
                    if (patch.aircraftTypeIds != null) setFStandAircraftTypeIds(patch.aircraftTypeIds);
                    if (patch.x != null) setFX(patch.x);
                    if (patch.y != null) setFY(patch.y);
                    if (patch.w != null) setFW(patch.w);
                    if (patch.h != null) setFH(patch.h);
                    if (patch.rotate != null) setFRotate(patch.rotate);
                    if (patch.isActive != null) setFIsActive(patch.isActive);
                  }}
                  onClose={closeDetail}
                  onSave={() => {
                    const payload = buildPayload();
                    if (mode === "create") createM.mutate(payload, { onSuccess: closeDetail });
                    else updateM.mutate({ id: editId, payload }, { onSuccess: closeDetail });
                  }}
                  onDelete={() => {
                    if (!editId || !confirm("Удалить место стоянки?")) return;
                    deleteM.mutate(editId, { onSuccess: closeDetail });
                  }}
                  onShowScheme={() => {
                    closeDetail();
                    setPreviewLayoutId(fLayoutId);
                    setPreviewStandId(editId);
                    window.setTimeout(() => document.getElementById("ref-scheme-preview")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
                  }}
                />
              ) : (
                <div className="refDetailEmpty">Выберите место слева или добавьте новое.</div>
              )
            }
          />
        ) : isRemainingRefKind(kind) ? (
          <RemainingRefTable kind={kind} rows={filteredRows} editingId={mode === "edit" ? editId : ""} onOpen={openEdit} />
        ) : null}
      </div>
      {kind === "operators" && mode ? (
        <OperatorCardModal
          key={`${mode}:${editId}`}
          mode={mode}
          code={fCode}
          name={fName}
          isActive={fIsActive}
          canEdit={canMutate}
          saving={createM.isPending || updateM.isPending}
          deleting={deleteM.isPending}
          error={
            createM.error || updateM.error || deleteM.error
              ? String(
                  (createM.error ?? updateM.error ?? deleteM.error)?.message ??
                    createM.error ??
                    updateM.error ??
                    deleteM.error
                )
              : null
          }
          record={
            mode === "edit"
              ? ((listQ.data ?? []).find((row: { id?: string }) => row.id === editId) ?? null)
              : null
          }
          showTech={isAdmin && mode === "edit"}
          onChange={(patch) => {
            if (patch.code != null) setFCode(patch.code);
            if (patch.name != null) setFName(patch.name);
            if (patch.isActive != null) setFIsActive(patch.isActive);
          }}
          onClose={() => setMode(null)}
          onSave={() => {
            const payload = { code: fCode.trim(), name: fName.trim(), isActive: fIsActive };
            if (mode === "create") createM.mutate(payload, { onSuccess: () => setMode(null) });
            else updateM.mutate({ id: editId, payload }, { onSuccess: () => setMode(null) });
          }}
          onDelete={() => {
            if (!editId || !confirm("Удалить оператора?")) return;
            deleteM.mutate(editId, { onSuccess: () => setMode(null) });
          }}
        />
      ) : null}
      {kind === "aircraft-types" && mode ? (
        <AircraftTypeCardModal
          key={`${mode}:${editId}`}
          mode={mode}
          icaoType={fIcaoType}
          name={fName}
          manufacturer={fManufacturer}
          bodyType={fBodyType}
          isActive={fIsActive}
          canEdit={canMutate}
          saving={createM.isPending || updateM.isPending}
          deleting={deleteM.isPending}
          error={cardMutationError(createM.error, updateM.error, deleteM.error)}
          record={mode === "edit" ? ((listQ.data ?? []).find((row: { id?: string }) => row.id === editId) ?? null) : null}
          showTech={isAdmin && mode === "edit"}
          onChange={(patch) => {
            if (patch.icaoType != null) setFIcaoType(patch.icaoType);
            if (patch.name != null) setFName(patch.name);
            if (patch.manufacturer != null) setFManufacturer(patch.manufacturer);
            if (patch.bodyType != null) setFBodyType(patch.bodyType);
            if (patch.isActive != null) setFIsActive(patch.isActive);
          }}
          onClose={() => setMode(null)}
          onSave={() => {
            const payload = buildPayload();
            if (mode === "create") createM.mutate(payload, { onSuccess: () => setMode(null) });
            else updateM.mutate({ id: editId, payload }, { onSuccess: () => setMode(null) });
          }}
          onDelete={() => {
            if (!editId || !confirm("Удалить тип ВС?")) return;
            deleteM.mutate(editId, { onSuccess: () => setMode(null) });
          }}
        />
      ) : null}
      {kind === "aircraft-type-palette" && mode ? (
        <PaletteCardModal
          key={`${mode}:${editId}`}
          mode={mode}
          operatorId={fOperatorId}
          typeId={fTypeId}
          color={fColor}
          isActive={fIsActive}
          operators={(operatorsQ.data ?? []).map((item) => ({ id: item.id, label: item.name }))}
          types={(aircraftTypesQ.data ?? []).map((item) => ({ id: item.id, label: item.name }))}
          canEdit={canMutate}
          saving={createM.isPending || updateM.isPending}
          deleting={deleteM.isPending}
          error={cardMutationError(createM.error, updateM.error, deleteM.error)}
          record={mode === "edit" ? ((listQ.data ?? []).find((row: { id?: string }) => row.id === editId) ?? null) : null}
          showTech={isAdmin && mode === "edit"}
          onChange={(patch) => {
            if (patch.operatorId != null) setFOperatorId(patch.operatorId);
            if (patch.typeId != null) setFTypeId(patch.typeId);
            if (patch.color != null) setFColor(patch.color);
            if (patch.isActive != null) setFIsActive(patch.isActive);
          }}
          onClose={() => setMode(null)}
          onSave={() => {
            const payload = buildPayload();
            if (mode === "create") createM.mutate(payload, { onSuccess: () => setMode(null) });
            else updateM.mutate({ id: editId, payload }, { onSuccess: () => setMode(null) });
          }}
          onDelete={() => {
            if (!editId || !confirm("Удалить правило палитры?")) return;
            deleteM.mutate(editId, { onSuccess: () => setMode(null) });
          }}
        />
      ) : null}
      {kind === "tow-norms" && mode === "edit" ? (
        <TowNormCardModal
          key={editId}
          code={fCode}
          name={fName}
          minutes={fMinutes}
          isActive={fIsActive}
          canEdit={canMutate}
          saving={updateM.isPending}
          error={cardMutationError(updateM.error)}
          record={(() => {
            const row = (listQ.data ?? []).find((item: { code?: string }) => item.code === editId);
            return row ? { ...row, id: row.code } : null;
          })()}
          showTech={isAdmin}
          onChange={(patch) => {
            if (patch.name != null) setFName(patch.name);
            if (patch.minutes != null) setFMinutes(patch.minutes);
            if (patch.isActive != null) setFIsActive(patch.isActive);
          }}
          onClose={() => setMode(null)}
          onSave={() => {
            updateM.mutate({ id: editId, payload: { name: fName.trim(), minutes: fMinutes, isActive: fIsActive } }, { onSuccess: () => setMode(null) });
          }}
        />
      ) : null}
      {kind === "hangars" && mode ? (
        <HangarCardModal
          key={`${mode}:${editId}`}
          mode={mode}
          code={fCode}
          name={fName}
          station={fStation}
          isPhysical={fIsPhysical}
          isActive={fIsActive}
          canEdit={canMutate}
          saving={createM.isPending || updateM.isPending}
          deleting={deleteM.isPending}
          error={cardMutationError(createM.error, updateM.error, deleteM.error)}
          record={mode === "edit" ? ((listQ.data ?? []).find((row: { id?: string }) => row.id === editId) ?? null) : null}
          showTech={isAdmin && mode === "edit"}
          onChange={(patch) => {
            if (patch.code != null) setFCode(patch.code);
            if (patch.name != null) setFName(patch.name);
            if (patch.station != null) setFStation(patch.station);
            if (patch.isPhysical != null) setFIsPhysical(patch.isPhysical);
            if (patch.isActive != null) setFIsActive(patch.isActive);
          }}
          onClose={() => setMode(null)}
          onSave={() => {
            const payload = buildPayload();
            if (mode === "create") createM.mutate(payload, { onSuccess: () => setMode(null) });
            else updateM.mutate({ id: editId, payload }, { onSuccess: () => setMode(null) });
          }}
          onDelete={() => {
            if (!editId || !confirm("Удалить ангар?")) return;
            deleteM.mutate(editId, { onSuccess: () => setMode(null) });
          }}
        />
      ) : null}
      {isRemainingRefKind(kind) && !splitRef && mode ? renderRemainingCard(false) : null}
      </div>
    </div>
  );
}

