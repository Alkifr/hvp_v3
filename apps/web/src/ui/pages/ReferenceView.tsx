import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";

type RefKind =
  | "operators"
  | "aircraft-types"
  | "aircraft"
  | "event-types"
  | "hangars"
  | "layouts"
  | "stands"
  | "skills"
  | "persons"
  | "shifts"
  | "materials"
  | "warehouses";

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
  isActive: boolean;
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

export function ReferenceView() {
  const [kind, setKind] = useState<RefKind>("operators");
  const qc = useQueryClient();

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
    setFTailNumber(String(row.tailNumber ?? ""));
    setFSerialNumber(String(row.serialNumber ?? ""));
    setFOperatorId(String(row.operatorId ?? ""));
    setFTypeId(String(row.typeId ?? ""));
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
        x: fX,
        y: fY,
        w: fW,
        h: fH,
        rotate: fRotate,
        isActive: fIsActive
      };
    return {};
  };

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div className="row">
        <strong>Справочник</strong>
        <select value={kind} onChange={(e) => setKind(e.target.value as RefKind)}>
          <option value="operators">Операторы</option>
          <option value="aircraft-types">Типы ВС</option>
          <option value="aircraft">Бортовые номера</option>
          <option value="event-types">События</option>
          <option value="hangars">Ангары</option>
          <option value="layouts">Варианты расстановки</option>
          <option value="stands">Места (стоянки)</option>
          <option value="skills">Квалификации</option>
          <option value="persons">Персонал</option>
          <option value="shifts">Смены</option>
          <option value="materials">Материалы</option>
          <option value="warehouses">Склады</option>
        </select>
        <span style={{ flex: "1 1 auto" }} />
        {kind === "layouts" ? (
          <label className="row">
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
            <label className="row">
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
            <label className="row">
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

        <button className="btn btnPrimary" onClick={openCreate}>
          Добавить
        </button>
      </div>

      {kind === "aircraft" ? (
        <div style={{ display: "grid", gap: 10, borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 12 }}>
          <div className="row">
            <strong>Импорт бортовых номеров из CSV</strong>
            <span className="muted">Берём 1-й столбец; разделитель: запятая/точка с запятой/таб.</span>
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
            <div style={{ border: "1px solid rgba(148,163,184,0.35)", borderRadius: 12, padding: 10 }}>
              <div className="row">
                <strong>Результат</strong>
                <span className="muted">создано: {aircraftImportResult.created ?? 0}</span>
                <span className="muted">пропущено (дубли/уже есть): {aircraftImportResult.duplicatesOrExisting ?? 0}</span>
                <span className="muted">невалидных: {(aircraftImportResult.invalid ?? []).length}</span>
              </div>
              {(aircraftImportResult.invalid ?? []).length ? (
                <div className="muted" style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  invalid: {JSON.stringify(aircraftImportResult.invalid)}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {mode ? (
        <div style={{ display: "grid", gap: 10, borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 12 }}>
          <div className="row">
            <strong>{mode === "create" ? "Создание" : "Редактирование"}</strong>
            <span className="muted">
              {kind === "operators"
                ? "Оператор"
                : kind === "aircraft-types"
                  ? "Тип ВС"
                  : kind === "aircraft"
                    ? "Борт"
                    : kind === "skills"
                      ? "Квалификация"
                      : kind === "persons"
                        ? "Сотрудник"
                        : kind === "shifts"
                          ? "Смена"
                          : kind === "materials"
                            ? "Материал"
                            : kind === "warehouses"
                              ? "Склад"
                    : kind === "event-types"
                      ? "Тип события"
                      : kind === "hangars"
                        ? "Ангар"
                        : kind === "layouts"
                          ? "Вариант"
                          : "Место"}
            </span>
            <span style={{ flex: "1 1 auto" }} />
            <button className="btn" onClick={() => setMode(null)}>
              Закрыть
            </button>
          </div>

          <div className="row" style={{ alignItems: "flex-end" }}>
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

            {kind !== "aircraft" && kind !== "persons" ? (
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

            {kind === "aircraft" ? (
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
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Зав. №</span>
                  <TextInput value={fSerialNumber} onChange={setFSerialNumber} style={{ width: 220 }} />
                </label>
              </>
            ) : null}

            {kind === "aircraft-types" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Производитель</span>
                <TextInput value={fManufacturer} onChange={setFManufacturer} style={{ width: 240 }} />
              </label>
            ) : null}

            {kind === "event-types" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Цвет</span>
                <input type="color" value={fColor} onChange={(e) => setFColor(e.target.value)} />
              </label>
            ) : null}

            {kind === "shifts" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">startMin</span>
                  <NumberInput value={fStartMin} onChange={setFStartMin} step={15} style={{ width: 140 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">endMin</span>
                  <NumberInput value={fEndMin} onChange={setFEndMin} step={15} style={{ width: 140 }} />
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
                  <select value={fLayoutId} onChange={(e) => setFLayoutId(e.target.value)} style={{ width: 240 }}>
                    {(layoutsForStandsQ.data ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Название</span>
                  <TextInput value={fName} onChange={setFName} style={{ width: 240 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">x</span>
                  <NumberInput value={fX} onChange={setFX} step={0.5} style={{ width: 90 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">y</span>
                  <NumberInput value={fY} onChange={setFY} step={0.5} style={{ width: 90 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">w</span>
                  <NumberInput value={fW} onChange={setFW} step={0.5} style={{ width: 90 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">h</span>
                  <NumberInput value={fH} onChange={setFH} step={0.5} style={{ width: 90 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">rot</span>
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

      <div style={{ display: "grid", gap: 8 }}>
        <div className="row">
          <strong>Список</strong>
          {listQ.isFetching ? <span className="muted">обновление…</span> : null}
        </div>
        {listQ.error ? <div className="error">{String(listQ.error.message || listQ.error)}</div> : null}
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 220 }}>id / code</th>
              <th>основные поля</th>
              <th style={{ width: 190 }}>действия</th>
              <th>прочее</th>
            </tr>
          </thead>
          <tbody>
            {(listQ.data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{row.id}</div>
                  {row.code ? <div className="muted">{row.code}</div> : null}
                  {row.icaoType ? <div className="muted">{row.icaoType}</div> : null}
                </td>
                <td>
                  <div>
                    <strong>{row.name ?? row.tailNumber ?? "—"}</strong>{" "}
                    {row.isActive === false ? <span className="muted">(неактивен)</span> : null}
                  </div>
                  {row.operator?.name ? <div className="muted">Оператор: {row.operator.name}</div> : null}
                  {row.type?.name ? <div className="muted">Тип ВС: {row.type.icaoType ? `${row.type.icaoType} • ` : ""}{row.type.name}</div> : null}
                  {row.hangarId ? <div className="muted">hangarId: {row.hangarId}</div> : null}
                  {row.layoutId ? <div className="muted">layoutId: {row.layoutId}</div> : null}
                </td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn" onClick={() => openEdit(row)}>
                      Изменить
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        if (confirm("Удалить запись?")) deleteM.mutate(row.id);
                      }}
                      disabled={deleteM.isPending}
                    >
                      Удалить
                    </button>
                  </div>
                  {deleteM.error ? <div className="error">{String(deleteM.error.message || deleteM.error)}</div> : null}
                </td>
                <td className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  {JSON.stringify(row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

