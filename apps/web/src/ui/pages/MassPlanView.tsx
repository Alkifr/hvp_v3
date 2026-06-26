import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import * as XLSX from "xlsx";

import { apiGet, apiPost } from "../../lib/api";
import { useActiveSandbox } from "../components/SandboxSwitcher";

type Hangar = { id: string; name: string; code: string };
type Operator = { id: string; name: string; code: string };
type AircraftType = { id: string; name: string; icaoType?: string | null; bodyType?: string | null };
type EventType = { id: string; name: string; code: string };

type MassPreview = {
  ok: boolean;
  dryRun: true;
  placements: Array<{
    index: number;
    title: string;
    label: string;
    startAt: string;
    endAt: string;
    hangarId: string;
    layoutId: string;
    standId: string;
    scheduledBy: "compact" | "sequential" | "fixedCadence";
    warnings: string[];
    budgetStartAt?: string | null;
    budgetEndAt?: string | null;
    actualStartAt?: string | null;
    actualEndAt?: string | null;
    towBeforeStartAt?: string;
    towBeforeEndAt?: string;
    towAfterStartAt?: string;
    towAfterEndAt?: string;
    rowIndex?: number;
    itemIndex?: number;
    score?: number;
    scoreDetails?: string[];
  }>;
  unplaced: Array<{ index: number; title: string; label: string; intendedStartAt?: string; warnings?: string[] }>;
  summary: {
    total: number;
    placed: number;
    unplaced: number;
    createdTowsBefore?: number;
    createdTowsAfter?: number;
    draftOnConflict?: boolean;
  };
};

type MassResult = {
  ok: boolean;
  dryRun: false;
  created: number;
  placed: number;
  unplaced: number;
  events: Array<{
    eventId: string;
    label: string;
    title: string;
    startAt: string;
    endAt: string;
    hangarId: string | null;
    layoutId: string | null;
    standId: string | null;
    status: string;
    budgetStartAt?: string | null;
    budgetEndAt?: string | null;
    actualStartAt?: string | null;
    actualEndAt?: string | null;
    towBeforeStartAt?: string;
    towBeforeEndAt?: string;
    towAfterStartAt?: string;
    towAfterEndAt?: string;
  }>;
  createdTowsBefore?: number;
  createdTowsAfter?: number;
};

type BatchRow = {
  id: string;
  tatHours: number;
  operatorId: string;
  aircraftTypeId: string;
  eventTypeId: string;
  count: number;
  startFrom: string;
  endTo: string;
  titleTemplate: string;
  scheduleMode: "compact" | "sequential" | "fixedCadence";
  spacingHours: number;
  cadenceHours: number;
};

function fromInputLocalOptional(value: string): string | null {
  if (!value) return null;
  const d = dayjs(value).second(0).millisecond(0);
  return d.isValid() ? d.toISOString() : null;
}

function makeClientId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeImportToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/ё/g, "е")
    .replace(/[‐‑‒–—−_]+/g, "")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

function parseImportDate(value: unknown, fallback: string): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return dayjs(value).format("YYYY-MM-DD");
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const ru = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (ru) {
    const year = ru[3]!.length === 2 ? `20${ru[3]}` : ru[3]!;
    return `${year}-${ru[2]!.padStart(2, "0")}-${ru[1]!.padStart(2, "0")}`;
  }
  const dashed = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashed) {
    const [, a, b, c] = dashed;
    const year = c!.length === 2 ? `20${c}` : c!;
    const first = Number(a);
    const second = Number(b);
    if (first > 12 || second <= 12) return `${year}-${b!.padStart(2, "0")}-${a!.padStart(2, "0")}`;
    return `${year}-${a!.padStart(2, "0")}-${b!.padStart(2, "0")}`;
  }
  const parsed = dayjs(raw);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : fallback;
}

export function MassPlanView() {
  const qc = useQueryClient();
  const { active: activeSandbox } = useActiveSandbox();
  const [tatHours, setTatHours] = useState(72);
  const [operatorId, setOperatorId] = useState("");
  const [aircraftTypeId, setAircraftTypeId] = useState("");
  const [eventTypeId, setEventTypeId] = useState("");
  const [count, setCount] = useState(5);
  const [startFrom, setStartFrom] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [endTo, setEndTo] = useState(() => dayjs().add(30, "day").format("YYYY-MM-DD"));
  const [hangarPriority, setHangarPriority] = useState<string[]>([]);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"compact" | "sequential" | "fixedCadence">("compact");
  const [spacingHours, setSpacingHours] = useState(0);
  const [cadenceHours, setCadenceHours] = useState(168);
  const [placementMode, setPlacementMode] = useState<"auto" | "preferredHangars" | "draftOnConflict">("auto");
  const [budgetStartAtLocal, setBudgetStartAtLocal] = useState("");
  const [budgetEndAtLocal, setBudgetEndAtLocal] = useState("");
  const [actualStartAtLocal, setActualStartAtLocal] = useState("");
  const [actualEndAtLocal, setActualEndAtLocal] = useState("");
  const [towBeforeMinutes, setTowBeforeMinutes] = useState(0);
  const [towAfterMinutes, setTowAfterMinutes] = useState(0);
  const [towBlocksStand, setTowBlocksStand] = useState(false);
  const [inputMode, setInputMode] = useState<"single" | "batch">("single");
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchImportError, setBatchImportError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MassPreview | null>(null);
  const [result, setResult] = useState<MassResult | null>(null);

  const hangarsQ = useQuery({
    queryKey: ["ref", "hangars"],
    queryFn: () => apiGet<Hangar[]>("/api/ref/hangars")
  });
  const operatorsQ = useQuery({
    queryKey: ["ref", "operators"],
    queryFn: () => apiGet<Operator[]>("/api/ref/operators")
  });
  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftType[]>("/api/ref/aircraft-types")
  });
  const eventTypesQ = useQuery({
    queryKey: ["ref", "event-types"],
    queryFn: () => apiGet<EventType[]>("/api/ref/event-types")
  });

  const buildBody = () => ({
    tatHours: Number(tatHours) || 72,
    operatorId,
    aircraftTypeId,
    eventTypeId,
    count: Math.max(1, Math.min(200, Number(count) || 1)),
    startFrom: dayjs(startFrom).startOf("day").toISOString(),
    endTo: dayjs(endTo).endOf("day").toISOString(),
    hangarIds: hangarPriority.length > 0 ? hangarPriority : undefined,
    titleTemplate: titleTemplate.trim() || undefined,
    scheduleMode,
    spacingHours: Math.max(0, Number(spacingHours) || 0),
    cadenceHours: scheduleMode === "fixedCadence" ? Math.max(1, Number(cadenceHours) || 1) : undefined,
    placementMode,
    budgetStartAt: fromInputLocalOptional(budgetStartAtLocal),
    budgetEndAt: fromInputLocalOptional(budgetEndAtLocal),
    actualStartAt: fromInputLocalOptional(actualStartAtLocal),
    actualEndAt: fromInputLocalOptional(actualEndAtLocal),
    towBeforeMinutes: Math.max(0, Math.min(24 * 60, Number(towBeforeMinutes) || 0)),
    towAfterMinutes: Math.max(0, Math.min(24 * 60, Number(towAfterMinutes) || 0)),
    towBlocksStand
  });

  const newBatchRow = (): BatchRow => ({
    id: makeClientId(),
    tatHours: Number(tatHours) || 72,
    operatorId,
    aircraftTypeId,
    eventTypeId,
    count: 1,
    startFrom,
    endTo,
    titleTemplate: titleTemplate.trim(),
    scheduleMode,
    spacingHours: Number(spacingHours) || 0,
    cadenceHours: Number(cadenceHours) || 168
  });

  const buildBatchBody = () => ({
    items: batchRows.map((row) => ({
      tatHours: Math.max(1, Number(row.tatHours) || 1),
      operatorId: row.operatorId,
      aircraftTypeId: row.aircraftTypeId,
      eventTypeId: row.eventTypeId,
      count: Math.max(1, Math.min(200, Number(row.count) || 1)),
      startFrom: dayjs(row.startFrom).startOf("day").toISOString(),
      endTo: dayjs(row.endTo).endOf("day").toISOString(),
      titleTemplate: row.titleTemplate.trim() || undefined,
      scheduleMode: row.scheduleMode,
      spacingHours: Math.max(0, Number(row.spacingHours) || 0),
      cadenceHours: row.scheduleMode === "fixedCadence" ? Math.max(1, Number(row.cadenceHours) || 1) : undefined
    })),
    hangarIds: hangarPriority.length > 0 ? hangarPriority : undefined,
    placementMode,
    budgetStartAt: fromInputLocalOptional(budgetStartAtLocal),
    budgetEndAt: fromInputLocalOptional(budgetEndAtLocal),
    actualStartAt: fromInputLocalOptional(actualStartAtLocal),
    actualEndAt: fromInputLocalOptional(actualEndAtLocal),
    towBeforeMinutes: Math.max(0, Math.min(24 * 60, Number(towBeforeMinutes) || 0)),
    towAfterMinutes: Math.max(0, Math.min(24 * 60, Number(towAfterMinutes) || 0)),
    towBlocksStand
  });

  const previewM = useMutation({
    mutationFn: (body: ReturnType<typeof buildBody> | ReturnType<typeof buildBatchBody>) =>
      apiPost<MassPreview>(inputMode === "batch" ? "/api/mass/batch" : "/api/mass", { ...body, dryRun: true }),
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
    }
  });

  const applyM = useMutation({
    mutationFn: (body: ReturnType<typeof buildBody> | ReturnType<typeof buildBatchBody>) =>
      apiPost<MassResult>(inputMode === "batch" ? "/api/mass/batch" : "/api/mass", { ...body, dryRun: false }),
    onSuccess: async (data) => {
      setResult(data);
      setPreview(null);
      await qc.invalidateQueries({ queryKey: ["events"] });
      await qc.invalidateQueries({ queryKey: ["reservations"] });
      await qc.invalidateQueries({ queryKey: ["sandboxes"] });
    }
  });

  const hangars = hangarsQ.data ?? [];
  const operators = operatorsQ.data ?? [];
  const aircraftTypes = aircraftTypesQ.data ?? [];
  const eventTypes = eventTypesQ.data ?? [];
  const hangarById = new Map(hangars.map((h) => [h.id, h]));
  const availableHangarIds = hangars.map((h) => h.id).filter((id) => !hangarPriority.includes(id));
  const isBatchReady = batchRows.length > 0 && batchRows.every((row) => row.operatorId && row.aircraftTypeId && row.eventTypeId && row.startFrom && row.endTo);

  const handlePreview = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMode === "batch") {
      if (!isBatchReady) return;
      previewM.mutate(buildBatchBody());
      return;
    }
    if (!operatorId || !aircraftTypeId || !eventTypeId) return;
    previewM.mutate(buildBody());
  };

  const handleApply = () => {
    if (inputMode === "batch") {
      if (!isBatchReady) return;
      applyM.mutate(buildBatchBody());
      return;
    }
    if (!operatorId || !aircraftTypeId || !eventTypeId) return;
    applyM.mutate(buildBody());
  };

  const moveHangar = (index: number, dir: -1 | 1) => {
    const next = [...hangarPriority];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    setHangarPriority(next);
  };

  const scheduleLabel = (mode: "compact" | "sequential" | "fixedCadence") =>
    mode === "compact" ? "Компактно" : mode === "sequential" ? "Последовательно" : "Фиксированный шаг";

  const formatRange = (from?: string, to?: string) =>
    from && to ? `${dayjs(from).format("DD.MM HH:mm")} → ${dayjs(to).format("DD.MM HH:mm")}` : "—";

  const formatPeriod = (from?: string | null, to?: string | null) => formatRange(from ?? undefined, to ?? undefined);

  const updateBatchRow = (id: string, patch: Partial<BatchRow>) => {
    setBatchRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setPreview(null);
    setResult(null);
  };

  const resolveOperator = (value: unknown) => {
    const q = normalizeImportToken(value);
    return operators.find((o) => normalizeImportToken(o.id) === q || normalizeImportToken(o.code) === q || normalizeImportToken(o.name) === q)?.id ?? "";
  };
  const resolveAircraftType = (value: unknown) => {
    const q = normalizeImportToken(value);
    return aircraftTypes.find((t) => normalizeImportToken(t.id) === q || normalizeImportToken(t.name) === q || normalizeImportToken(t.icaoType) === q)?.id ?? "";
  };
  const resolveEventType = (value: unknown) => {
    const q = normalizeImportToken(value);
    return eventTypes.find((t) => normalizeImportToken(t.id) === q || normalizeImportToken(t.code) === q || normalizeImportToken(t.name) === q)?.id ?? "";
  };

  const importBatchRows = async (file: File) => {
    setBatchImportError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]!];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
      const pick = (row: Record<string, unknown>, keys: string[]) => {
        const normalized = new Map(Object.entries(row).map(([k, v]) => [normalizeImportToken(k), v]));
        for (const key of keys) {
          const value = normalized.get(normalizeImportToken(key));
          if (value != null && String(value).trim() !== "") return value;
        }
        return "";
      };
      const imported = rows.map((row) => {
        const start = pick(row, ["startFrom", "начало периода", "дата начала", "start"]);
        const end = pick(row, ["endTo", "конец периода", "дата окончания", "end"]);
        return {
          id: makeClientId(),
          tatHours: Number(pick(row, ["tatHours", "tat", "тат", "TAT"])) || 72,
          operatorId: resolveOperator(pick(row, ["operator", "оператор"])),
          aircraftTypeId: resolveAircraftType(pick(row, ["aircraftType", "тип вс", "тип"])),
          eventTypeId: resolveEventType(pick(row, ["eventType", "тип события", "событие"])),
          count: Number(pick(row, ["count", "количество", "qty"])) || 1,
          startFrom: parseImportDate(start, startFrom),
          endTo: parseImportDate(end, endTo),
          titleTemplate: String(pick(row, ["titleTemplate", "название", "шаблон"]) || ""),
          scheduleMode: "compact" as const,
          spacingHours: Number(pick(row, ["spacingHours", "пауза"])) || 0,
          cadenceHours: Number(pick(row, ["cadenceHours", "шаг"])) || 168
        };
      });
      setBatchRows(imported);
      setPreview(null);
      setResult(null);
    } catch (err: any) {
      setBatchImportError(String(err?.message ?? err));
    }
  };

  return (
    <div className="massPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Планирование серий событий</div>
          <h1>Массовое планирование</h1>
          <p>
            Создавайте пачки виртуальных бортов, проверяйте размещение в предпросмотре и переносите результат в текущий контур.
            Непоместившиеся события будут сохранены черновиками без места.
          </p>
        </div>
        <div className="massHeroStats" aria-label="Текущие параметры">
          <span><b>{inputMode === "batch" ? batchRows.reduce((sum, row) => sum + row.count, 0) : count}</b> событий</span>
          <span><b>{inputMode === "batch" ? batchRows.length : tatHours}</b> {inputMode === "batch" ? "строк" : "ч TAT"}</span>
          <span><b>{scheduleLabel(scheduleMode)}</b></span>
        </div>
      </section>

      <div className="massCard">
        <div className={activeSandbox ? "contextNotice contextNoticeSandbox" : "contextNotice"}>
          {activeSandbox ? (
            <>
              <strong>Режим песочницы:</strong> массовое планирование создаст события только в песочнице
              {" "}
              <b>{activeSandbox.name}</b>. Рабочий контур не изменится, а занятость мест проверяется только внутри этой песочницы.
            </>
          ) : (
            <>
              <strong>Рабочий контур:</strong> массовое планирование создаст события в основном плане.
            </>
          )}
        </div>

        <form onSubmit={handlePreview} className="massForm">
          <section className="massSection">
            <div className="massSectionHead">
              <div>
                <h2>Основные параметры</h2>
                <p>{inputMode === "single" ? "Определяют тип события, период планирования и количество создаваемых строк." : "Каждая строка задаёт отдельный набор событий со своим TAT и периодом."}</p>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className={inputMode === "single" ? "btn btnPrimary" : "btn"} onClick={() => setInputMode("single")}>
                  Один шаблон
                </button>
                <button
                  type="button"
                  className={inputMode === "batch" ? "btn btnPrimary" : "btn"}
                  onClick={() => {
                    setInputMode("batch");
                    if (batchRows.length === 0) setBatchRows([newBatchRow()]);
                    setPreview(null);
                    setResult(null);
                  }}
                >
                  Список строк
                </button>
              </div>
            </div>

            {inputMode === "single" ? (
            <div className="massFormGrid">
            <label className="massField">
              <span className="muted">TAT одного события, ч</span>
              <input
                type="number"
                min={1}
                max={8760}
                value={tatHours}
                onChange={(e) => setTatHours(Number(e.target.value) || 72)}
              />
            </label>
            <label className="massField">
              <span className="muted">Оператор</span>
              <select
                value={operatorId}
                onChange={(e) => { setOperatorId(e.target.value); setPreview(null); setResult(null); }}
                required
              >
                <option value="">— выберите —</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <label className="massField">
              <span className="muted">Тип ВС</span>
              <select
                value={aircraftTypeId}
                onChange={(e) => setAircraftTypeId(e.target.value)}
                required
              >
                <option value="">— выберите —</option>
                {aircraftTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.icaoType ? ` (${t.icaoType})` : ""}</option>
                ))}
              </select>
            </label>
            <label className="massField">
              <span className="muted">Вид события</span>
              <select
                value={eventTypeId}
                onChange={(e) => setEventTypeId(e.target.value)}
                required
              >
                <option value="">— выберите —</option>
                {eventTypes.map((et) => (
                  <option key={et.id} value={et.id}>{et.name}</option>
                ))}
              </select>
            </label>
            <label className="massField">
              <span className="muted">Количество</span>
              <input
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 1)}
              />
            </label>
            <label className="massField">
              <span className="muted">Начало периода</span>
              <input
                type="date"
                value={startFrom}
                onChange={(e) => setStartFrom(e.target.value)}
              />
            </label>
            <label className="massField">
              <span className="muted">Конец периода</span>
              <input
                type="date"
                value={endTo}
                onChange={(e) => setEndTo(e.target.value)}
              />
            </label>
            <label className="massField massFieldWide">
              <span className="muted">Шаблон названия (опц., % = номер)</span>
              <input
                type="text"
                placeholder="Например: A-check %"
                value={titleTemplate}
                onChange={(e) => setTitleTemplate(e.target.value)}
              />
            </label>
          </div>
            ) : (
              <div className="massBatchBox">
                <div className="massBatchToolbar">
                  <div className="muted small">
                    Можно заполнить вручную или импортировать XLSX/CSV. Обязательные колонки: operator, aircraftType, eventType, tatHours, count, startFrom, endTo.
                  </div>
                  <div className="massBatchToolbarActions">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,text/csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void importBatchRows(file);
                      }}
                    />
                    <button type="button" className="btn" onClick={() => setBatchRows((rows) => [...rows, newBatchRow()])}>
                      + строка
                    </button>
                  </div>
                </div>
                {batchImportError ? <div className="error">{batchImportError}</div> : null}
                <div className="massBatchRows">
                  {batchRows.map((row, idx) => (
                    <div className="massBatchRowCard" key={row.id}>
                      <div className="massBatchRowGrid">
                        <div className="massBatchRowIndex">Строка {idx + 1}</div>
                        <label className="massField">
                          <span className="muted">Оператор</span>
                          <select value={row.operatorId} onChange={(e) => updateBatchRow(row.id, { operatorId: e.target.value })} required>
                            <option value="">— выберите —</option>
                            {operators.map((o) => (
                              <option key={o.id} value={o.id}>{o.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="massField">
                          <span className="muted">Тип ВС</span>
                          <select value={row.aircraftTypeId} onChange={(e) => updateBatchRow(row.id, { aircraftTypeId: e.target.value })} required>
                            <option value="">— выберите —</option>
                            {aircraftTypes.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}{t.icaoType ? ` (${t.icaoType})` : ""}</option>
                            ))}
                          </select>
                        </label>
                        <label className="massField">
                          <span className="muted">Вид события</span>
                          <select value={row.eventTypeId} onChange={(e) => updateBatchRow(row.id, { eventTypeId: e.target.value })} required>
                            <option value="">— выберите —</option>
                            {eventTypes.map((et) => (
                              <option key={et.id} value={et.id}>{et.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="massField massBatchNumberField">
                          <span className="muted">TAT, ч</span>
                          <input type="number" min={1} max={8760} value={row.tatHours} onChange={(e) => updateBatchRow(row.id, { tatHours: Number(e.target.value) || 1 })} />
                        </label>
                        <label className="massField massBatchNumberField">
                          <span className="muted">Кол-во</span>
                          <input type="number" min={1} max={200} value={row.count} onChange={(e) => updateBatchRow(row.id, { count: Number(e.target.value) || 1 })} />
                        </label>
                        <label className="massField">
                          <span className="muted">Начало периода</span>
                          <input type="date" value={row.startFrom} onChange={(e) => updateBatchRow(row.id, { startFrom: e.target.value })} />
                        </label>
                        <label className="massField">
                          <span className="muted">Конец периода</span>
                          <input type="date" value={row.endTo} onChange={(e) => updateBatchRow(row.id, { endTo: e.target.value })} />
                        </label>
                        <label className="massField massBatchTitleField">
                          <span className="muted">Шаблон названия</span>
                          <input value={row.titleTemplate} onChange={(e) => updateBatchRow(row.id, { titleTemplate: e.target.value })} placeholder="% = номер" />
                        </label>
                        <label className="massField">
                          <span className="muted">Режим расписания</span>
                          <select value={row.scheduleMode} onChange={(e) => updateBatchRow(row.id, { scheduleMode: e.target.value as BatchRow["scheduleMode"] })}>
                            <option value="compact">Компактно</option>
                            <option value="sequential">Последовательно</option>
                            <option value="fixedCadence">Фиксированный шаг</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className="btn btnGhost massBatchDeleteButton"
                          onClick={() => setBatchRows((rows) => rows.filter((x) => x.id !== row.id))}
                          title="Удалить строку"
                          aria-label="Удалить строку"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M5 7h14" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M8 7l1-3h6l1 3" />
                            <path d="M7 7l1 13h8l1-13" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {batchRows.length === 0 ? <div className="massEmptyHint">Добавьте хотя бы одну строку для планирования.</div> : null}
              </div>
            )}
          </section>

          <details className="massAdvanced massSection" open>
            <summary>Расширенные настройки</summary>
            <div className="massAdvancedGrid">
              <label className="massField">
                <span className="muted">Режим расписания</span>
                <select
                  value={scheduleMode}
                  onChange={(e) => {
                    setScheduleMode(e.target.value as "compact" | "sequential" | "fixedCadence");
                    setPreview(null);
                    setResult(null);
                  }}
                >
                  <option value="compact">Компактно: первый свободный слот</option>
                  <option value="sequential">Последовательно: событие за событием</option>
                  <option value="fixedCadence">Фиксированный шаг от начала периода</option>
                </select>
              </label>

              <label className="massField">
                <span className="muted">Пауза между событиями, ч</span>
                <input
                  type="number"
                  min={0}
                  max={8760}
                  value={spacingHours}
                  onChange={(e) => setSpacingHours(Number(e.target.value) || 0)}
                />
              </label>

              {scheduleMode === "fixedCadence" ? (
                <label className="massField">
                  <span className="muted">Фиксированный шаг, ч</span>
                  <input
                    type="number"
                    min={1}
                    max={8760}
                    value={cadenceHours}
                    onChange={(e) => setCadenceHours(Number(e.target.value) || 1)}
                  />
                </label>
              ) : null}

              <label className="massField">
                <span className="muted">Поведение при конфликте</span>
                <select
                  value={placementMode}
                  onChange={(e) => {
                    setPlacementMode(e.target.value as "auto" | "preferredHangars" | "draftOnConflict");
                    setPreview(null);
                    setResult(null);
                  }}
                >
                  <option value="auto">Искать ближайшее свободное место</option>
                  <option value="preferredHangars">Искать по приоритету ангаров</option>
                  <option value="draftOnConflict">Создавать черновик, если целевой слот занят</option>
                </select>
              </label>

              <label className="massField">
                <span className="muted">Бюджетное начало</span>
                <input
                  type="datetime-local"
                  value={budgetStartAtLocal}
                  onChange={(e) => setBudgetStartAtLocal(e.target.value)}
                />
              </label>

              <label className="massField">
                <span className="muted">Бюджетное окончание</span>
                <input
                  type="datetime-local"
                  value={budgetEndAtLocal}
                  onChange={(e) => setBudgetEndAtLocal(e.target.value)}
                />
              </label>

              <label className="massField">
                <span className="muted">Фактическое начало</span>
                <input
                  type="datetime-local"
                  value={actualStartAtLocal}
                  onChange={(e) => setActualStartAtLocal(e.target.value)}
                />
              </label>

              <label className="massField">
                <span className="muted">Фактическое окончание</span>
                <input
                  type="datetime-local"
                  value={actualEndAtLocal}
                  onChange={(e) => setActualEndAtLocal(e.target.value)}
                />
              </label>

              <label className="massField">
                <span className="muted">Буксировка до, мин</span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={towBeforeMinutes}
                  onChange={(e) => setTowBeforeMinutes(Number(e.target.value) || 0)}
                />
              </label>

              <label className="massField">
                <span className="muted">Буксировка после, мин</span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={towAfterMinutes}
                  onChange={(e) => setTowAfterMinutes(Number(e.target.value) || 0)}
                />
              </label>

              <label className="massCheckbox">
                <input
                  type="checkbox"
                  checked={towBlocksStand}
                  onChange={(e) => setTowBlocksStand(e.target.checked)}
                />
                <span>Учитывать буксировки как занятость места</span>
              </label>
            </div>
          </details>

          <section className="massSection">
            <div className="massSectionHead">
              <div>
                <h2>Приоритет ангаров</h2>
                <p>Если список не задан, система перебирает активные ангары по имени.</p>
              </div>
            </div>
            <div className="massHangarPriority">
              {hangarPriority.map((id, index) => (
                <span key={id} className="massHangarChip">
                  <span className="massHangarOrder">{index + 1}</span>
                  <span>{hangarById.get(id)?.name ?? id}</span>
                  <button type="button" onClick={() => moveHangar(index, -1)} disabled={index === 0} title="Выше">↑</button>
                  <button type="button" onClick={() => moveHangar(index, 1)} disabled={index === hangarPriority.length - 1} title="Ниже">↓</button>
                  <button type="button" onClick={() => setHangarPriority((p) => p.filter((x) => x !== id))} title="Убрать">✕</button>
                </span>
              ))}
              {availableHangarIds.length > 0 && (
                <select
                  className="massHangarSelect"
                  value=""
                  onChange={(e) => { const v = e.target.value; if (v) setHangarPriority((p) => [...p, v]); }}
                >
                  <option value="">+ ангар</option>
                  {availableHangarIds.map((id) => (
                    <option key={id} value={id}>{hangarById.get(id)?.name ?? id}</option>
                  ))}
                </select>
              )}
            </div>
            {hangarPriority.length === 0 && <div className="massEmptyHint">Приоритет не задан. Будет использован порядок по имени ангара.</div>}
          </section>

          <div className="massActions">
            <button
              type="submit"
              className="btn btnPrimary"
              disabled={previewM.isPending || (inputMode === "single" ? !operatorId || !aircraftTypeId || !eventTypeId : !isBatchReady)}
            >
              {previewM.isPending ? "Загрузка…" : "Предпросмотр"}
            </button>
            {(previewM.error || applyM.error) && (
              <span className="error">{String((previewM.error as Error)?.message ?? (applyM.error as Error)?.message)}</span>
            )}
          </div>
        </form>
      </div>

      {preview?.ok && preview.dryRun && (
        <section className="massCard">
          <div className="massResultHeader">
            <div>
              <h2>Предпросмотр</h2>
              <p>Проверьте размещение перед созданием событий.</p>
            </div>
            <div className="massSummaryChips">
              <span><b>{preview.summary.placed}</b> размещено</span>
              <span><b>{preview.summary.unplaced}</b> черновиков</span>
              <span><b>{(preview.summary.createdTowsBefore ?? 0) + (preview.summary.createdTowsAfter ?? 0)}</b> буксировок</span>
            </div>
          </div>
          {preview.placements.length > 0 && (
            <div className="massTableWrap">
              <table className="massTable">
                <thead>
                  <tr>
                    <th>Вирт. борт</th>
                    <th>Название</th>
                    <th>Начало</th>
                    <th>Окончание</th>
                    <th>Бюджетный период</th>
                    <th>Фактический период</th>
                    <th>Ангар</th>
                    <th>Режим</th>
                    <th>Score</th>
                    <th>Буксировка до</th>
                    <th>Буксировка после</th>
                    <th>Предупреждения</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.placements.map((p) => (
                    <tr key={p.index}>
                      <td>{p.label}</td>
                      <td>{p.title}</td>
                      <td>{dayjs(p.startAt).format("DD.MM.YYYY HH:mm")}</td>
                      <td>{dayjs(p.endAt).format("DD.MM.YYYY HH:mm")}</td>
                      <td>{formatPeriod(p.budgetStartAt, p.budgetEndAt)}</td>
                      <td>{formatPeriod(p.actualStartAt, p.actualEndAt)}</td>
                      <td>{hangarById.get(p.hangarId)?.name ?? p.hangarId}</td>
                      <td><span className="massModeBadge">{scheduleLabel(p.scheduledBy)}</span></td>
                      <td>{p.score ? `${p.score} (${p.scoreDetails?.join("; ") || "приоритет"})` : <span className="muted">—</span>}</td>
                      <td>{formatRange(p.towBeforeStartAt, p.towBeforeEndAt)}</td>
                      <td>{formatRange(p.towAfterStartAt, p.towAfterEndAt)}</td>
                      <td>
                        {p.warnings.length > 0 ? p.warnings.join("; ") : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.unplaced.length > 0 && (
            <div className="massDraftBox">
              <strong>Черновики без места</strong>
              <div>
                {preview.unplaced
                  .map((u) =>
                    `${u.label}${u.intendedStartAt ? ` (${dayjs(u.intendedStartAt).format("DD.MM HH:mm")})` : ""}${
                      u.warnings?.length ? ` — ${u.warnings.join("; ")}` : ""
                    }`
                  )
                  .join(", ")}
              </div>
            </div>
          )}
          <div className="massActions">
            <button
              type="button"
              className="btn btnPrimary"
              disabled={applyM.isPending || (inputMode === "single" ? !operatorId || !aircraftTypeId || !eventTypeId : !isBatchReady)}
              onClick={handleApply}
            >
              {applyM.isPending ? "Создание…" : activeSandbox ? "Создать в песочнице" : "Перенести в план"}
            </button>
          </div>
        </section>
      )}

      {result?.ok && !result.dryRun && result.events && result.events.length > 0 && (
        <section className="massCard">
          <div className="massResultHeader">
            <div>
              <h2>Результат создания</h2>
              <p>События созданы в текущем контуре.</p>
            </div>
            <div className="massSummaryChips">
              <span><b>{result.placed}</b> в плане</span>
              <span><b>{result.unplaced}</b> черновиков</span>
              <span><b>{(result.createdTowsBefore ?? 0) + (result.createdTowsAfter ?? 0)}</b> буксировок</span>
            </div>
          </div>
          <div className="massTableWrap">
            <table className="massTable">
              <thead>
                <tr>
                  <th>Борт</th>
                  <th>Название</th>
                  <th>Начало</th>
                  <th>Окончание</th>
                  <th>Бюджетный период</th>
                  <th>Фактический период</th>
                  <th>Ангар / статус</th>
                  <th>Буксировки</th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((ev) => (
                  <tr key={ev.eventId}>
                    <td>{ev.label}</td>
                    <td>{ev.title}</td>
                    <td>{dayjs(ev.startAt).format("DD.MM.YYYY HH:mm")}</td>
                    <td>{dayjs(ev.endAt).format("DD.MM.YYYY HH:mm")}</td>
                    <td>{formatPeriod(ev.budgetStartAt, ev.budgetEndAt)}</td>
                    <td>{formatPeriod(ev.actualStartAt, ev.actualEndAt)}</td>
                    <td>
                      {ev.hangarId ? (hangarById.get(ev.hangarId)?.name ?? ev.hangarId) : <span className="muted">Черновик (без места)</span>}
                    </td>
                    <td>
                      <div>{formatRange(ev.towBeforeStartAt, ev.towBeforeEndAt)}</div>
                      <div>{formatRange(ev.towAfterStartAt, ev.towAfterEndAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
