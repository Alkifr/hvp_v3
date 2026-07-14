import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions
} from "chart.js";
import { Chart } from "react-chartjs-2";
import dayjs from "dayjs";

import { apiGet } from "../../lib/api";
import { isValidDateInput } from "../../lib/dateInput";
import { exportCompareExcel, exportTatExcel, exportUtilizationExcel } from "../../lib/analyticsExcel";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { ToolbarPopover } from "../components/ToolbarPopover";
import { sandboxIsArchived, useActiveSandbox, type SandboxSummary } from "../components/SandboxSwitcher";
import { ReportBuilderPanel } from "./ReportBuilderPanel";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler
);

type TabId = "tat" | "util" | "compare" | "builder";
type EfficiencyGrain = "day" | "week" | "month" | "period";

const DETAIL_LEVEL_LABEL: Record<EfficiencyGrain, string> = {
  day: "Сутки",
  week: "Неделя",
  month: "Месяц",
  period: "Весь период"
};

type TatRow = {
  eventId: string;
  title: string;
  status: string;
  aircraft: string;
  aircraftId?: string | null;
  operatorId?: string | null;
  aircraftTypeId?: string | null;
  eventTypeId?: string | null;
  eventType: string;
  hangarId?: string | null;
  hangar: string | null;
  planTatH: number;
  actualTatH: number | null;
  tatVarianceH: number | null;
  startDelayH: number | null;
  endDelayH: number | null;
  deviationLabels: string[];
  reason: string | null;
  planStartAt: string;
  planEndAt: string;
  actualStartAt: string | null;
  actualEndAt: string | null;
};

type TatResponse = {
  ok: true;
  period: { from: string; to: string };
  summary: {
    events: number;
    withActual: number;
    missingActual: number;
    avgTatVarianceH: number | null;
    avgStartDelayH: number | null;
    onTime: number;
    lateStart: number;
    tatOverrun: number;
  };
  deviationBreakdown: Array<{ label: string; count: number }>;
  reasonBreakdown: Array<{ reason: string; count: number }>;
  rows: TatRow[];
};

type HangarEfficiencyMetrics = {
  timeUtilizationPct: number;
  capacityUtilizationPct: number;
  aircraftHours: number;
  capacityHours: number;
  conflictPct: number;
  conflictSegments?: number;
};

type UtilBucket = {
  key: string;
  label: string;
  from: string;
  to: string;
  capacityUtilizationPct: number;
  timeUtilizationPct: number;
  standUtilizationPct: number;
  aircraftHours: number;
  capacityHours: number;
  occupiedH?: number;
  capacityH?: number;
  idleH?: number;
  conflictPct: number;
  hangars: Array<{
    hangarId: string;
    hangarName: string;
    standUtilizationPct: number;
    occupiedH: number;
    capacityH: number;
    capacityUtilizationPct: number;
    timeUtilizationPct: number;
    aircraftHours: number;
    capacityHours: number;
    conflictPct: number;
  }>;
};

type UtilResponse = {
  ok: true;
  period: { from: string; to: string; hours: number };
  summary: {
    hangars: number;
    stands: number;
    occupiedH: number;
    idleH: number;
    capacityH: number;
    utilizationPct: number;
  };
  efficiency: {
    grain: EfficiencyGrain;
    note: string;
    period: HangarEfficiencyMetrics & { standUtilizationPct: number };
    buckets: UtilBucket[];
    timeline?: {
      grain: Exclude<EfficiencyGrain, "period">;
      points: UtilBucket[];
    };
  };
  hangars: Array<{
    hangarId: string;
    hangarName: string;
    hangarCode?: string;
    isPhysical?: boolean;
    standCount: number;
    layoutCount?: number;
    occupiedH: number;
    idleH: number;
    capacityH: number;
    utilizationPct: number;
    reservationCount: number;
    efficiency: HangarEfficiencyMetrics;
  }>;
  stands: Array<{
    standId: string;
    standCode: string;
    hangarId?: string;
    hangarName: string;
    layoutId?: string;
    layoutName: string;
    availableH?: number;
    occupiedH: number;
    idleH: number;
    utilizationPct: number;
    reservationCount: number;
    blockedByOtherLayout?: boolean;
  }>;
};

type CompareEvent = {
  eventId: string;
  title: string;
  status: string;
  aircraft: string;
  aircraftId: string | null;
  operatorId: string | null;
  aircraftTypeId: string | null;
  eventTypeId: string | null;
  eventType: string;
  hangarId: string;
  standCode: string | null;
  startAt: string;
  endAt: string;
  occupiedH: number;
};

type CompareResponse = {
  ok: true;
  period: { from: string; to: string; hours: number };
  a: SideMetrics;
  b: SideMetrics;
  delta: {
    events: number;
    placed: number;
    unplaced: number;
    aircraftHours: number;
    occupiedStandHours: number;
    idleH: number;
    utilizationPct: number;
    avgEventTatH: number;
  };
  hangarCompare: Array<{
    hangarId: string;
    hangarName: string;
    aOccupiedH: number;
    bOccupiedH: number;
    deltaH: number;
    aEvents: CompareEvent[];
    bEvents: CompareEvent[];
  }>;
};

type SideMetrics = {
  scope: string;
  sandboxId: string | null;
  name: string;
  events: number;
  placed: number;
  unplaced: number;
  aircraftHours: number;
  occupiedStandHours: number;
  idleH: number;
  capacityH: number;
  utilizationPct: number;
  avgEventTatH: number;
};

type AnalyticsFilters = {
  hangarIds: string[];
  operatorIds: string[];
  aircraftTypeIds: string[];
  aircraftIds: string[];
  eventTypeIds: string[];
};

type RefOption = { id: string; label: string };

type FilterRow = {
  hangarId?: string | null;
  operatorId?: string | null;
  aircraftTypeId?: string | null;
  aircraftId?: string | null;
  eventTypeId?: string | null;
};

const ANALYTICS_UI_LS_KEY = "hangarPlanning:analyticsUi:v1";

function safeReadAnalyticsUi(): any | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(ANALYTICS_UI_LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWriteAnalyticsUi(v: any) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ANALYTICS_UI_LS_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

function toInputDate(d: dayjs.Dayjs): string {
  return d.format("YYYY-MM-DD");
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function fmtSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = fmtNum(n);
  return n > 0 ? `+${s}` : s;
}

function scopeLabel(id: string, list: SandboxSummary[]): string {
  if (id === "prod") return "Рабочий контур";
  return list.find((s) => s.id === id)?.name ?? id;
}

function readStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

function matchFilters(row: FilterRow, filters: AnalyticsFilters, skip?: keyof AnalyticsFilters): boolean {
  if (skip !== "hangarIds" && filters.hangarIds.length > 0) {
    const id = row.hangarId ? String(row.hangarId) : "";
    if (id && !filters.hangarIds.includes(id)) return false;
  }
  if (skip !== "operatorIds" && filters.operatorIds.length > 0) {
    const id = row.operatorId ? String(row.operatorId) : "";
    if (!id || !filters.operatorIds.includes(id)) return false;
  }
  if (skip !== "aircraftTypeIds" && filters.aircraftTypeIds.length > 0) {
    const id = row.aircraftTypeId ? String(row.aircraftTypeId) : "";
    if (!id || !filters.aircraftTypeIds.includes(id)) return false;
  }
  if (skip !== "aircraftIds" && filters.aircraftIds.length > 0) {
    const id = row.aircraftId ? String(row.aircraftId) : "";
    if (!id || !filters.aircraftIds.includes(id)) return false;
  }
  if (skip !== "eventTypeIds" && filters.eventTypeIds.length > 0) {
    const id = row.eventTypeId ? String(row.eventTypeId) : "";
    if (!id || !filters.eventTypeIds.includes(id)) return false;
  }
  return true;
}

export function AnalyticsView() {
  const { active, list } = useActiveSandbox();
  const activeSandboxes = useMemo(() => list.filter((s) => !sandboxIsArchived(s)), [list]);
  const savedUi = useMemo(() => safeReadAnalyticsUi(), []);

  const [tab, setTab] = useState<TabId>("tat");
  const [fromInput, setFromInput] = useState(() =>
    isValidDateInput(String(savedUi?.fromDate ?? "")) ? String(savedUi.fromDate) : toInputDate(dayjs().subtract(30, "day"))
  );
  const [toInput, setToInput] = useState(() =>
    isValidDateInput(String(savedUi?.toDate ?? "")) ? String(savedUi.toDate) : toInputDate(dayjs().add(1, "day"))
  );
  const fromAppliedRef = useRef(fromInput);
  const toAppliedRef = useRef(toInput);
  if (isValidDateInput(fromInput)) fromAppliedRef.current = fromInput;
  if (isValidDateInput(toInput)) toAppliedRef.current = toInput;
  const from = isValidDateInput(fromInput) ? fromInput : fromAppliedRef.current;
  const to = isValidDateInput(toInput) ? toInput : toAppliedRef.current;
  const [compareA, setCompareA] = useState(() => String(savedUi?.compareA ?? "prod"));
  const [compareB, setCompareB] = useState(() => String(savedUi?.compareB ?? active?.id ?? ""));
  const [efficiencyGrain, setEfficiencyGrain] = useState<EfficiencyGrain>(() =>
    ["day", "week", "month", "period"].includes(String(savedUi?.efficiencyGrain))
      ? (savedUi.efficiencyGrain as EfficiencyGrain)
      : "week"
  );

  const [filterHangarIds, setFilterHangarIds] = useState<string[]>(() => readStringArray(savedUi?.filterHangarIds));
  const [filterOperatorIds, setFilterOperatorIds] = useState<string[]>(() => readStringArray(savedUi?.filterOperatorIds));
  const [filterAircraftTypeIds, setFilterAircraftTypeIds] = useState<string[]>(() => readStringArray(savedUi?.filterAircraftTypeIds));
  const [filterAircraftIds, setFilterAircraftIds] = useState<string[]>(() => readStringArray(savedUi?.filterAircraftIds));
  const [filterEventTypeIds, setFilterEventTypeIds] = useState<string[]>(() => readStringArray(savedUi?.filterEventTypeIds));

  const fromIso = dayjs(from).startOf("day").toISOString();
  const toIso = dayjs(to).endOf("day").toISOString();
  const tzOffset = dayjs(from).utcOffset();
  const periodOk = isValidDateInput(from) && isValidDateInput(to) && dayjs(to).isAfter(dayjs(from));
  const periodChipLabel = `${dayjs(from).format("DD.MM.YYYY")} – ${dayjs(to).format("DD.MM.YYYY")}`;

  const filters = useMemo<AnalyticsFilters>(
    () => ({
      hangarIds: filterHangarIds,
      operatorIds: filterOperatorIds,
      aircraftTypeIds: filterAircraftTypeIds,
      aircraftIds: filterAircraftIds,
      eventTypeIds: filterEventTypeIds
    }),
    [filterHangarIds, filterOperatorIds, filterAircraftTypeIds, filterAircraftIds, filterEventTypeIds]
  );
  const filtersActive =
    filterHangarIds.length > 0 ||
    filterOperatorIds.length > 0 ||
    filterAircraftTypeIds.length > 0 ||
    filterAircraftIds.length > 0 ||
    filterEventTypeIds.length > 0;

  useEffect(() => {
    safeWriteAnalyticsUi({
      fromDate: from,
      toDate: to,
      compareA,
      compareB,
      efficiencyGrain,
      filterHangarIds,
      filterOperatorIds,
      filterAircraftTypeIds,
      filterAircraftIds,
      filterEventTypeIds
    });
  }, [
    from,
    to,
    compareA,
    compareB,
    efficiencyGrain,
    filterHangarIds,
    filterOperatorIds,
    filterAircraftTypeIds,
    filterAircraftIds,
    filterEventTypeIds
  ]);

  const hangarsQ = useQuery({
    queryKey: ["ref", "hangars"],
    queryFn: () => apiGet<Array<{ id: string; name: string; isPhysical?: boolean }>>("/api/ref/hangars")
  });
  const operatorsQ = useQuery({
    queryKey: ["ref", "operators"],
    queryFn: () => apiGet<Array<{ id: string; code?: string | null; name: string }>>("/api/ref/operators")
  });
  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<Array<{ id: string; name: string; icaoType?: string | null }>>("/api/ref/aircraft-types")
  });
  const aircraftQ = useQuery({
    queryKey: ["ref", "aircraft"],
    queryFn: () => apiGet<Array<{ id: string; tailNumber: string }>>("/api/ref/aircraft")
  });
  const eventTypesQ = useQuery({
    queryKey: ["ref", "event-types"],
    queryFn: () => apiGet<Array<{ id: string; name: string }>>("/api/ref/event-types")
  });

  const tatQ = useQuery({
    queryKey: ["analytics", "tat-variance", fromIso, toIso, active?.id ?? "prod"],
    queryFn: () =>
      apiGet<TatResponse>(
        `/api/analytics/tat-variance?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
      ),
    enabled: tab === "tat" && periodOk
  });

  const utilQ = useQuery({
    queryKey: ["analytics", "utilization", fromIso, toIso, efficiencyGrain, tzOffset, active?.id ?? "prod"],
    queryFn: () =>
      apiGet<UtilResponse>(
        `/api/analytics/utilization?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&grain=${efficiencyGrain}&tzOffset=${tzOffset}`
      ),
    enabled: tab === "util" && periodOk,
    placeholderData: (prev) => prev
  });

  const compareReady = Boolean(compareA && compareB && compareA !== compareB);
  const compareQ = useQuery({
    queryKey: ["analytics", "sandbox-compare", fromIso, toIso, compareA, compareB],
    queryFn: () =>
      apiGet<CompareResponse>(
        `/api/analytics/sandbox-compare?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&a=${encodeURIComponent(compareA)}&b=${encodeURIComponent(compareB)}`
      ),
    enabled: tab === "compare" && periodOk && compareReady
  });

  const filterSeedRows = useMemo((): FilterRow[] => {
    if (tab === "tat") return tatQ.data?.rows ?? [];
    if (tab === "util") {
      return (utilQ.data?.hangars ?? []).map((h) => ({ hangarId: h.hangarId }));
    }
    if (tab === "compare") {
      const rows: FilterRow[] = [];
      for (const h of compareQ.data?.hangarCompare ?? []) {
        for (const e of [...(h.aEvents ?? []), ...(h.bEvents ?? [])]) rows.push(e);
      }
      return rows;
    }
    return [];
  }, [tab, tatQ.data, utilQ.data, compareQ.data]);

  const filterOptions = useMemo(() => {
    const hangarIdSet = new Set<string>();
    const operatorIdSet = new Set<string>();
    const aircraftTypeIdSet = new Set<string>();
    const aircraftIdSet = new Set<string>();
    const eventTypeIdSet = new Set<string>();

    for (const row of filterSeedRows) {
      if (matchFilters(row, filters, "hangarIds") && row.hangarId) hangarIdSet.add(String(row.hangarId));
      if (matchFilters(row, filters, "operatorIds") && row.operatorId) operatorIdSet.add(String(row.operatorId));
      if (matchFilters(row, filters, "aircraftTypeIds") && row.aircraftTypeId) {
        aircraftTypeIdSet.add(String(row.aircraftTypeId));
      }
      if (matchFilters(row, filters, "aircraftIds") && row.aircraftId) aircraftIdSet.add(String(row.aircraftId));
      if (matchFilters(row, filters, "eventTypeIds") && row.eventTypeId) eventTypeIdSet.add(String(row.eventTypeId));
    }

    const constrainBySeed = filterSeedRows.length > 0 && tab !== "util";

    const hangars: RefOption[] = (hangarsQ.data ?? [])
      .filter((h) => filterSeedRows.length === 0 || hangarIdSet.has(h.id) || filterHangarIds.includes(h.id))
      .map((h) => ({ id: h.id, label: h.isPhysical === false ? `${h.name} (MRO)` : h.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const operators: RefOption[] = (operatorsQ.data ?? [])
      .filter((o) => !constrainBySeed || operatorIdSet.has(o.id))
      .map((o) => ({ id: o.id, label: o.code ? `${o.code} • ${o.name}` : o.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const aircraftTypes: RefOption[] = (aircraftTypesQ.data ?? [])
      .filter((t) => !constrainBySeed || aircraftTypeIdSet.has(t.id))
      .map((t) => ({ id: t.id, label: t.icaoType ? `${t.icaoType} • ${t.name}` : t.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const aircraft: RefOption[] = (aircraftQ.data ?? [])
      .filter((a) => !constrainBySeed || aircraftIdSet.has(a.id))
      .map((a) => ({ id: a.id, label: a.tailNumber }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const eventTypes: RefOption[] = (eventTypesQ.data ?? [])
      .filter((t) => !constrainBySeed || eventTypeIdSet.has(t.id))
      .map((t) => ({ id: t.id, label: t.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    return { hangars, operators, aircraftTypes, aircraft, eventTypes };
  }, [
    tab,
    filterSeedRows,
    filters,
    filterHangarIds,
    hangarsQ.data,
    operatorsQ.data,
    aircraftTypesQ.data,
    aircraftQ.data,
    eventTypesQ.data
  ]);

  const applyPeriodPreset = (days: number, mode: "past" | "future") => {
    if (mode === "past") {
      setFromInput(toInputDate(dayjs().subtract(days, "day")));
      setToInput(toInputDate(dayjs()));
    } else {
      setFromInput(toInputDate(dayjs()));
      setToInput(toInputDate(dayjs().add(days, "day")));
    }
  };

  return (
    <div className="analyticsPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Аналитика после факта</div>
          <h1>Отчёты плана</h1>
          <p>
            TAT variance, загрузка и эффективность ангаров, сравнение сценариев. TAT и utilization считаются в текущем
            контуре{active ? ` («${active.name}»)` : " (рабочий контур)"}.
          </p>
        </div>
      </section>

      <div className="card hangarFilterPanel">
        <div className="ganttPanelHeader">
          <div className="ganttPanelTitle">
            <strong>Фильтры</strong>
            <span className="muted ganttPanelPeriod">
              {periodChipLabel}
              {filtersActive ? (
                <>
                  <span className="ganttPanelDot" aria-hidden="true">
                    ·
                  </span>
                  фильтры
                </>
              ) : null}
            </span>
          </div>
        </div>

        <div className="ganttToolbar">
          <div className="ganttToolbarGroup">
            <span className="tgLabel">Период</span>
            <ToolbarPopover label={periodChipLabel} title="Период отчёта" panelClassName="tbPopoverPeriod">
              <div className="tbPopoverPeriodBody">
                <div className="tgPresets" role="group" aria-label="Прошедший период">
                  {[
                    ["7 дн", 7],
                    ["30 дн", 30],
                    ["90 дн", 90]
                  ].map(([label, days]) => (
                    <button
                      key={String(label)}
                      className="btn btnGhost"
                      type="button"
                      onClick={() => applyPeriodPreset(Number(days), "past")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="tbPopoverPeriodDates">
                  <label className="tgField">
                    <span className="tgFieldLabel">с</span>
                    <input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} style={{ width: 150 }} />
                  </label>
                  <label className="tgField">
                    <span className="tgFieldLabel">по</span>
                    <input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} style={{ width: 150 }} />
                  </label>
                </div>
                {!periodOk ? <div className="error">Дата «по» должна быть позже «с»</div> : null}
              </div>
            </ToolbarPopover>
          </div>

          <div className="ganttToolbarGroup">
            <span className="tgLabel">Фильтры</span>
            {tab !== "builder" ? (
            <label className="tgField">
              <span className="tgFieldLabel">Ангар</span>
              <MultiSelectDropdown
                options={filterOptions.hangars}
                value={filterHangarIds}
                onChange={setFilterHangarIds}
                placeholder="все"
                width={150}
                maxHeight={320}
                searchable
                searchPlaceholder="Найти ангар"
                compact
              />
            </label>
            ) : (
              <span className="muted small">Отбор задаётся в схеме отчёта</span>
            )}
            {tab !== "util" && tab !== "builder" ? (
              <>
                <label className="tgField">
                  <span className="tgFieldLabel">Оператор</span>
                  <MultiSelectDropdown
                    options={filterOptions.operators}
                    value={filterOperatorIds}
                    onChange={setFilterOperatorIds}
                    placeholder="все"
                    width={160}
                    maxHeight={320}
                    searchable
                    searchPlaceholder="Найти оператора"
                    compact
                  />
                </label>
                <label className="tgField">
                  <span className="tgFieldLabel">Тип ВС</span>
                  <MultiSelectDropdown
                    options={filterOptions.aircraftTypes}
                    value={filterAircraftTypeIds}
                    onChange={setFilterAircraftTypeIds}
                    placeholder="все"
                    width={150}
                    maxHeight={320}
                    searchable
                    searchPlaceholder="Найти тип ВС"
                    compact
                  />
                </label>
                <label className="tgField">
                  <span className="tgFieldLabel">Борт</span>
                  <MultiSelectDropdown
                    options={filterOptions.aircraft}
                    value={filterAircraftIds}
                    onChange={setFilterAircraftIds}
                    placeholder="все"
                    width={140}
                    maxHeight={320}
                    searchable
                    searchPlaceholder="Найти борт"
                    compact
                  />
                </label>
                <label className="tgField">
                  <span className="tgFieldLabel">Тип события</span>
                  <MultiSelectDropdown
                    options={filterOptions.eventTypes}
                    value={filterEventTypeIds}
                    onChange={setFilterEventTypeIds}
                    placeholder="все"
                    width={160}
                    maxHeight={320}
                    searchable
                    searchPlaceholder="Найти тип события"
                    compact
                  />
                </label>
              </>
            ) : null}
            {tab === "util" ? (
              <label className="tgField">
                <span className="tgFieldLabel">Детализация</span>
                <select
                  value={efficiencyGrain}
                  onChange={(e) => setEfficiencyGrain(e.target.value as EfficiencyGrain)}
                  style={{ width: 140 }}
                  title="Уровень детализации интервалов"
                >
                  {(Object.keys(DETAIL_LEVEL_LABEL) as EfficiencyGrain[]).map((g) => (
                    <option key={g} value={g}>
                      {DETAIL_LEVEL_LABEL[g]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>

        <div className="hangarToolbarActions">
          <button
            type="button"
            className="btn ganttIconBtn"
            disabled={!filtersActive}
            title="Сбросить фильтры"
            aria-label="Сбросить фильтры"
            onClick={() => {
              setFilterHangarIds([]);
              setFilterOperatorIds([]);
              setFilterAircraftTypeIds([]);
              setFilterAircraftIds([]);
              setFilterEventTypeIds([]);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 10a6 6 0 0 1 10.2-4.3" />
              <path d="M14 2v4h-4" />
              <path d="M16 10a6 6 0 0 1-10.2 4.3" />
              <path d="M6 18v-4h4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="sandboxesTabs">
        <button type="button" className={tab === "tat" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setTab("tat")}>
          TAT variance
        </button>
        <button type="button" className={tab === "util" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setTab("util")}>
          Utilization
        </button>
        <button type="button" className={tab === "compare" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setTab("compare")}>
          Сценарии A vs B
        </button>
        <button type="button" className={tab === "builder" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setTab("builder")}>
          Конструктор отчётов
        </button>
      </div>

      {tab === "tat" ? <TatPanel q={tatQ} filters={filters} periodLabel={periodChipLabel} /> : null}
      {tab === "util" ? (
        <UtilPanel
          q={utilQ}
          filters={filters}
          grain={efficiencyGrain}
          periodLabel={periodChipLabel}
          detailLabel={DETAIL_LEVEL_LABEL[efficiencyGrain]}
        />
      ) : null}
      {tab === "compare" ? (
        <ComparePanel
          q={compareQ}
          list={activeSandboxes}
          compareA={compareA}
          compareB={compareB}
          setCompareA={setCompareA}
          setCompareB={setCompareB}
          compareReady={compareReady}
          filters={filters}
          periodLabel={periodChipLabel}
        />
      ) : null}
      {tab === "builder" ? (
        <ReportBuilderPanel
          fromIso={fromIso}
          toIso={toIso}
          periodLabel={periodChipLabel}
          tzOffset={tzOffset}
          sandboxes={activeSandboxes.map((s) => ({ id: s.id, name: s.name }))}
        />
      ) : null}
    </div>
  );
}

function ExcelExportButton(props: { onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <button
      type="button"
      className="btn ganttIconBtn"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      aria-label={props.title}
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

function StatCards(props: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <div className="analyticsStats">
      {props.items.map((it) => (
        <div key={it.label} className="analyticsStat card">
          <div className="analyticsStatLabel">{it.label}</div>
          <div className="analyticsStatValue">{it.value}</div>
          {it.hint ? <div className="muted analyticsStatHint">{it.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

function TatBreakdownCharts(props: {
  deviations: Array<{ label: string; count: number }>;
  reasons: Array<{ reason: string; count: number }>;
  totalEvents: number;
}) {
  const { deviations, reasons } = props;

  const deviationData = useMemo<ChartData<"bar">>(
    () => ({
      labels: deviations.map((d) => d.label),
      datasets: [
        {
          label: "Событий",
          data: deviations.map((d) => d.count),
          backgroundColor: "rgba(13, 148, 136, 0.55)",
          borderRadius: 4
        }
      ]
    }),
    [deviations]
  );

  const reasonData = useMemo<ChartData<"bar">>(
    () => ({
      labels: reasons.map((d) => (d.reason.length > 36 ? `${d.reason.slice(0, 36)}…` : d.reason)),
      datasets: [
        {
          label: "Событий",
          data: reasons.map((d) => d.count),
          backgroundColor: "rgba(180, 83, 9, 0.5)",
          borderRadius: 4
        }
      ]
    }),
    [reasons]
  );

  const barOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: "rgba(148, 163, 184, 0.25)" }, ticks: { color: "#64748b" } },
        y: { grid: { display: false }, ticks: { color: "#334155", autoSkip: false, font: { size: 11 } } }
      }
    }),
    []
  );

  return (
    <div className="analyticsSplit">
      <section className="card analyticsCard">
        <h3>Типы отклонений</h3>
        {deviations.length === 0 ? (
          <div className="muted">Нет данных</div>
        ) : (
          <div className="analyticsTatChartWrap">
            <Chart type="bar" data={deviationData} options={barOptions} />
          </div>
        )}
      </section>
      <section className="card analyticsCard">
        <h3>Причины (из истории / примечаний)</h3>
        {reasons.length === 0 ? (
          <div className="muted">Нет данных</div>
        ) : (
          <div className="analyticsTatChartWrap">
            <Chart type="bar" data={reasonData} options={barOptions} />
          </div>
        )}
      </section>
    </div>
  );
}

function TatPanel(props: {
  q: { isLoading: boolean; error: Error | null; data?: TatResponse };
  filters: AnalyticsFilters;
  periodLabel: string;
}) {
  const { q, filters, periodLabel } = props;
  const [exporting, setExporting] = useState(false);

  const data = q.data;
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => matchFilters(r, filters)), [data?.rows, filters]);

  const summary = useMemo(() => {
    const withActual = rows.filter((r) => r.actualTatH != null);
    return {
      events: rows.length,
      withActual: withActual.length,
      missingActual: rows.length - withActual.length,
      avgTatVarianceH:
        withActual.length > 0
          ? withActual.reduce((s, r) => s + (r.tatVarianceH ?? 0), 0) / withActual.length
          : null,
      avgStartDelayH:
        withActual.length > 0 ? withActual.reduce((s, r) => s + (r.startDelayH ?? 0), 0) / withActual.length : null,
      onTime: rows.filter((r) => r.deviationLabels.includes("В срок")).length,
      lateStart: rows.filter((r) => r.deviationLabels.includes("Поздний старт")).length,
      tatOverrun: rows.filter((r) => r.deviationLabels.includes("TAT больше плана")).length
    };
  }, [rows]);

  const deviationBreakdown = useMemo(
    () =>
      Array.from(
        rows.reduce((m, r) => {
          for (const label of r.deviationLabels) m.set(label, (m.get(label) ?? 0) + 1);
          return m;
        }, new Map<string, number>())
      )
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
    [rows]
  );

  const reasonBreakdown = useMemo(
    () =>
      Array.from(
        rows.reduce((m, r) => {
          const reason = (r.reason ?? "").trim() || "Без причины";
          m.set(reason, (m.get(reason) ?? 0) + 1);
          return m;
        }, new Map<string, number>())
      )
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
    [rows]
  );

  const kpis = [
    { label: "Событий", value: String(summary.events) },
    { label: "С фактом", value: String(summary.withActual), hint: `без факта: ${summary.missingActual}` },
    { label: "Ср. Δ TAT, ч", value: fmtSigned(summary.avgTatVarianceH), hint: "факт − план" },
    { label: "Ср. задержка старта, ч", value: fmtSigned(summary.avgStartDelayH) },
    { label: "В срок", value: String(summary.onTime) },
    { label: "Поздний старт / overrun", value: `${summary.lateStart} / ${summary.tatOverrun}` }
  ];

  const onExport = async () => {
    setExporting(true);
    try {
      await exportTatExcel({
        periodLabel,
        kpis,
        deviations: deviationBreakdown,
        reasons: reasonBreakdown,
        events: rows.map((r) => ({
          Борт: r.aircraft,
          Событие: r.title,
          "Тип события": r.eventType,
          Ангар: r.hangar ?? "",
          Статус: r.status,
          "План TAT, ч": r.planTatH,
          "Факт TAT, ч": r.actualTatH,
          "Δ TAT, ч": r.tatVarianceH,
          "Δ старт, ч": r.startDelayH,
          "Δ окончание, ч": r.endDelayH,
          Отклонения: r.deviationLabels.join("; "),
          Причина: r.reason ?? "",
          "План старт": r.planStartAt,
          "План окончание": r.planEndAt,
          "Факт старт": r.actualStartAt,
          "Факт окончание": r.actualEndAt
        }))
      });
    } finally {
      setExporting(false);
    }
  };

  if (q.isLoading && !data) return <div className="muted">Загрузка…</div>;
  if (q.error && !data) return <div className="error">{String((q.error as any).message ?? q.error)}</div>;
  if (!data) return null;

  return (
    <div className="analyticsStack">
      <div className="analyticsModuleHead">
        <div>
          <strong>TAT variance</strong>
          <span className="muted"> · {periodLabel}</span>
        </div>
        <ExcelExportButton
          onClick={() => void onExport()}
          disabled={exporting || rows.length === 0}
          title="Выгрузить TAT variance в Excel (таблица + графики)"
        />
      </div>

      <StatCards items={kpis} />

      <TatBreakdownCharts deviations={deviationBreakdown} reasons={reasonBreakdown} totalEvents={summary.events} />

      <section className="card analyticsCard">
        <h3>События</h3>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>Борт</th>
                <th>Событие</th>
                <th>План TAT</th>
                <th>Факт TAT</th>
                <th>Δ TAT</th>
                <th>Δ старт</th>
                <th>Отклонения</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.eventId}>
                  <td>{r.aircraft}</td>
                  <td>
                    <div className="analyticsEventTitle">{r.title}</div>
                    <div className="muted">
                      {r.eventType}
                      {r.hangar ? ` · ${r.hangar}` : ""}
                    </div>
                  </td>
                  <td>{fmtNum(r.planTatH)}</td>
                  <td>{fmtNum(r.actualTatH)}</td>
                  <td className={r.tatVarianceH != null && r.tatVarianceH > 2 ? "analyticsBad" : undefined}>
                    {fmtSigned(r.tatVarianceH)}
                  </td>
                  <td className={r.startDelayH != null && r.startDelayH > 2 ? "analyticsBad" : undefined}>
                    {fmtSigned(r.startDelayH)}
                  </td>
                  <td>
                    <div className="analyticsTags">
                      {r.deviationLabels.map((l) => (
                        <span key={l} className="analyticsTag">
                          {l}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td title={r.reason ?? undefined}>{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type TimelinePoint = {
  key: string;
  label: string;
  from: string;
  to: string;
  standUtilizationPct: number;
  capacityUtilizationPct: number;
  timeUtilizationPct: number;
  aircraftHours: number;
  capacityHours: number;
  occupiedH: number;
  capacityH: number;
  idleH: number;
  conflictPct: number;
};

function UtilizationTimelineChart(props: { points: TimelinePoint[] }) {
  const { points } = props;

  const chartData = useMemo<ChartData<"bar" | "line">>(() => {
    const labels = points.map((p) => dayjs(p.from).format("DD.MM"));
    return {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Спрос (ВС·ч)",
          data: points.map((p) => Number(p.aircraftHours.toFixed(2))),
          yAxisID: "yHours",
          backgroundColor: "rgba(14, 116, 144, 0.35)",
          hoverBackgroundColor: "rgba(14, 116, 144, 0.55)",
          borderRadius: 3,
          order: 3
        },
        {
          type: "line",
          label: "Stand util, %",
          data: points.map((p) => Number(p.standUtilizationPct.toFixed(1))),
          yAxisID: "yPct",
          borderColor: "#0d9488",
          backgroundColor: "rgba(13, 148, 136, 0.18)",
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2,
          order: 1
        },
        {
          type: "line",
          label: "Эффективность, %",
          data: points.map((p) => Number(p.capacityUtilizationPct.toFixed(1))),
          yAxisID: "yPct",
          borderColor: "#b45309",
          backgroundColor: "#b45309",
          fill: false,
          tension: 0.25,
          pointRadius: 2,
          pointHoverRadius: 4,
          borderWidth: 2,
          borderDash: [5, 4],
          order: 2
        }
      ]
    };
  }, [points]);

  const options = useMemo<ChartOptions<"bar" | "line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "start",
          labels: { boxWidth: 12, boxHeight: 12, color: "#475569", font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0]?.dataIndex ?? 0;
              return points[idx]?.label ?? "";
            },
            afterBody: (items) => {
              const idx = items[0]?.dataIndex ?? 0;
              const p = points[idx];
              if (!p) return [];
              return [
                `Занято мест·ч: ${fmtNum(p.occupiedH)}`,
                `Ёмкость мест·ч: ${fmtNum(p.capacityH)}`,
                `Простой: ${fmtNum(p.idleH)} ч`,
                `Time util: ${fmtNum(p.timeUtilizationPct)}%`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(148, 163, 184, 0.2)" },
          ticks: {
            color: "#64748b",
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10
          }
        },
        yPct: {
          type: "linear",
          position: "left",
          min: 0,
          suggestedMax: 100,
          title: { display: true, text: "%", color: "#64748b" },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
          ticks: { color: "#64748b", callback: (v) => `${v}%` }
        },
        yHours: {
          type: "linear",
          position: "right",
          min: 0,
          title: { display: true, text: "ВС·ч", color: "#0e7490" },
          grid: { drawOnChartArea: false },
          ticks: { color: "#0e7490" }
        }
      }
    }),
    [points]
  );

  if (points.length === 0) {
    return <div className="muted">Нет точек для таймлайна за выбранный период/фильтр.</div>;
  }

  const peak = points.reduce((best, p) => (p.aircraftHours > best.aircraftHours ? p : best), points[0]!);
  const dip = points.reduce((best, p) => (p.aircraftHours < best.aircraftHours ? p : best), points[0]!);

  return (
    <div className="analyticsTimeline">
      <div className="analyticsTimelineChartWrap">
        <Chart type="bar" data={chartData} options={options} />
      </div>
      <div className="analyticsTimelineTooltip muted">
        Пик спроса: {peak.label} ({fmtNum(peak.aircraftHours)} ВС·ч) · просадка: {dip.label} (
        {fmtNum(dip.aircraftHours)} ВС·ч)
      </div>
    </div>
  );
}

function UtilPanel(props: {
  q: {
    isLoading: boolean;
    isFetching?: boolean;
    error: Error | null;
    data?: UtilResponse;
  };
  filters: AnalyticsFilters;
  grain: EfficiencyGrain;
  periodLabel: string;
  detailLabel: string;
}) {
  const { q, filters, grain, periodLabel, detailLabel } = props;
  const data = q.data;
  const [exporting, setExporting] = useState(false);

  const hangars = useMemo(
    () => (data?.hangars ?? []).filter((h) => filters.hangarIds.length === 0 || filters.hangarIds.includes(h.hangarId)),
    [data?.hangars, filters.hangarIds]
  );
  const hangarIdSet = useMemo(() => new Set(hangars.map((h) => h.hangarId)), [hangars]);
  const stands = useMemo(
    () =>
      (data?.stands ?? []).filter((s) => {
        if (filters.hangarIds.length === 0) return true;
        return Boolean(s.hangarId && hangarIdSet.has(s.hangarId));
      }),
    [data?.stands, filters.hangarIds, hangarIdSet]
  );
  const buckets = useMemo(
    () =>
      (data?.efficiency?.buckets ?? []).map((b) => ({
        ...b,
        hangars: b.hangars.filter((h) => filters.hangarIds.length === 0 || filters.hangarIds.includes(h.hangarId))
      })),
    [data?.efficiency?.buckets, filters.hangarIds]
  );

  const timelinePoints = useMemo(() => {
    const raw = data?.efficiency?.timeline?.points ?? data?.efficiency?.buckets ?? [];
    return raw
      .map((b) => {
        const hs = b.hangars.filter((h) => filters.hangarIds.length === 0 || filters.hangarIds.includes(h.hangarId));
        if (filters.hangarIds.length > 0 && hs.length === 0) return null;
        const aircraftHours = hs.reduce((s, h) => s + h.aircraftHours, 0);
        const capacityHours = hs.reduce((s, h) => s + h.capacityHours, 0);
        const occupiedH = hs.reduce((s, h) => s + h.occupiedH, 0);
        const capacityH = hs.reduce((s, h) => s + h.capacityH, 0);
        return {
          key: b.key,
          label: b.label,
          from: b.from,
          to: b.to,
          standUtilizationPct: capacityH > 0 ? (occupiedH / capacityH) * 100 : 0,
          capacityUtilizationPct: capacityHours > 0 ? (aircraftHours / capacityHours) * 100 : 0,
          timeUtilizationPct: hs.length > 0 ? hs.reduce((s, h) => s + h.timeUtilizationPct, 0) / hs.length : 0,
          aircraftHours,
          capacityHours,
          occupiedH,
          capacityH,
          idleH: Math.max(0, capacityH - occupiedH),
          conflictPct: hs.length > 0 ? hs.reduce((s, h) => s + h.conflictPct, 0) / hs.length : 0
        };
      })
      .filter(Boolean) as TimelinePoint[];
  }, [data?.efficiency, filters.hangarIds]);

  const filteredKpis = useMemo(() => {
    const occupiedH = hangars.reduce((s, h) => s + h.occupiedH, 0);
    const capacityH = hangars.reduce((s, h) => s + h.capacityH, 0);
    const aircraftHours = hangars.reduce((s, h) => s + h.efficiency.aircraftHours, 0);
    const capacityHours = hangars.reduce((s, h) => s + h.efficiency.capacityHours, 0);
    return {
      standUtilizationPct: capacityH > 0 ? (occupiedH / capacityH) * 100 : 0,
      capacityUtilizationPct: capacityHours > 0 ? (aircraftHours / capacityHours) * 100 : 0,
      timeUtilizationPct:
        hangars.length > 0 ? hangars.reduce((s, h) => s + h.efficiency.timeUtilizationPct, 0) / hangars.length : 0,
      conflictPct:
        hangars.length > 0 ? hangars.reduce((s, h) => s + h.efficiency.conflictPct, 0) / hangars.length : 0,
      aircraftHours,
      capacityHours,
      occupiedH,
      capacityH
    };
  }, [hangars]);

  if (q.isLoading && !data) return <div className="muted">Загрузка…</div>;
  if (q.error && !data) return <div className="error">{String((q.error as any).message ?? q.error)}</div>;
  if (!data) return null;

  const timelineGrainLabel =
    data.efficiency?.timeline?.grain === "day"
      ? "сутки"
      : data.efficiency?.timeline?.grain === "week"
        ? "недели"
        : data.efficiency?.timeline?.grain === "month"
          ? "месяцы"
          : DETAIL_LEVEL_LABEL[grain].toLowerCase();
  const refreshing = Boolean(q.isFetching && !q.isLoading);

  const onExport = async () => {
    setExporting(true);
    try {
      const standRows = stands.filter(
        (s) => !s.blockedByOtherLayout || s.reservationCount > 0 || (s.availableH ?? 0) > 0
      );
      await exportUtilizationExcel({
        periodLabel,
        detailLabel,
        kpis: [
          { label: "Stand util", value: `${fmtNum(filteredKpis.standUtilizationPct)}%` },
          { label: "Эффективность", value: `${fmtNum(filteredKpis.capacityUtilizationPct)}%` },
          { label: "Time util", value: `${fmtNum(filteredKpis.timeUtilizationPct)}%` },
          { label: "Конфликты схем", value: `${fmtNum(filteredKpis.conflictPct)}%` },
          { label: "ВС·часы", value: fmtNum(filteredKpis.aircraftHours) },
          { label: "Место·часы", value: fmtNum(filteredKpis.capacityHours) }
        ],
        timeline: timelinePoints.map((p) => ({
          Интервал: p.label,
          С: dayjs(p.from).format("YYYY-MM-DD HH:mm"),
          По: dayjs(p.to).format("YYYY-MM-DD HH:mm"),
          "Спрос ВС·ч": Number(p.aircraftHours.toFixed(2)),
          "Занято мест·ч": Number(p.occupiedH.toFixed(2)),
          "Ёмкость мест·ч": Number(p.capacityH.toFixed(2)),
          "Простой, ч": Number(p.idleH.toFixed(2)),
          "Stand util, %": Number(p.standUtilizationPct.toFixed(1)),
          "Эффективность, %": Number(p.capacityUtilizationPct.toFixed(1)),
          "Time util, %": Number(p.timeUtilizationPct.toFixed(1)),
          "Конфликт, %": Number(p.conflictPct.toFixed(1))
        })),
        hangars: hangars.map((h) => ({
          Ангар: h.hangarName,
          "Мест (nominal)": h.standCount,
          "Занято, ч": h.occupiedH,
          "Простой, ч": h.idleH,
          "Ёмкость, ч": h.capacityH,
          "Stand util, %": h.utilizationPct,
          "Эффективность, %": h.efficiency.capacityUtilizationPct,
          "Time util, %": h.efficiency.timeUtilizationPct,
          "ВС·ч": h.efficiency.aircraftHours,
          "Место·ч схемы": h.efficiency.capacityHours,
          "Конфликт, %": h.efficiency.conflictPct,
          Резервов: h.reservationCount
        })),
        stands: standRows.map((s) => ({
          Место: s.standCode,
          Ангар: s.hangarName,
          Схема: s.layoutName,
          "Доступно, ч": s.availableH ?? 0,
          "Занято, ч": s.occupiedH,
          "Простой, ч": s.idleH,
          "Utilization, %": s.utilizationPct
        })),
        timelineChart: {
          labels: timelinePoints.map((p) => dayjs(p.from).format("DD.MM")),
          aircraftHours: timelinePoints.map((p) => Number(p.aircraftHours.toFixed(2))),
          standUtilizationPct: timelinePoints.map((p) => Number(p.standUtilizationPct.toFixed(1))),
          capacityUtilizationPct: timelinePoints.map((p) => Number(p.capacityUtilizationPct.toFixed(1)))
        }
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={`analyticsStack${refreshing ? " analyticsStackRefreshing" : ""}`}>
      {refreshing ? <div className="analyticsRefreshHint muted">Обновление…</div> : null}
      <div className="analyticsModuleHead">
        <div>
          <strong>Utilization</strong>
          <span className="muted">
            {" "}
            · {periodLabel} · {detailLabel}
          </span>
        </div>
        <ExcelExportButton
          onClick={() => void onExport()}
          disabled={exporting || hangars.length === 0}
          title="Выгрузить Utilization в Excel (таблицы + график)"
        />
      </div>
      <StatCards
        items={[
          {
            label: "Stand util",
            value: `${fmtNum(filteredKpis.standUtilizationPct)}%`,
            hint: "место·ч / ёмкость активной схемы"
          },
          {
            label: "Эффективность",
            value: `${fmtNum(filteredKpis.capacityUtilizationPct)}%`,
            hint: "ВС·ч / место·ч схемы"
          },
          {
            label: "Time util",
            value: `${fmtNum(filteredKpis.timeUtilizationPct)}%`,
            hint: "доля времени занятости ангара"
          },
          { label: "Конфликты схем", value: `${fmtNum(filteredKpis.conflictPct)}%` },
          { label: "ВС·часы", value: fmtNum(filteredKpis.aircraftHours) },
          { label: "Место·часы", value: fmtNum(filteredKpis.capacityHours) }
        ]}
      />

      <section className="card analyticsCard">
        <div className="analyticsEffHeader">
          <div>
            <h3>Таймлайн утилизации</h3>
            <p className="muted small">
              Пики и просадки спроса по расставленным событиям · детализация: {timelineGrainLabel}
            </p>
          </div>
        </div>
        <UtilizationTimelineChart points={timelinePoints} />
      </section>

      <section className="card analyticsCard">
        <div className="analyticsEffHeader">
          <div>
            <h3>Эффективность использования ангаров</h3>
            <p className="muted small">{data.efficiency?.note}</p>
          </div>
        </div>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>{grain === "period" ? "Ангар" : "Интервал"}</th>
                {grain === "period" ? null : <th>Ангар</th>}
                <th>Эффект., %</th>
                <th>Time util, %</th>
                <th>Stand util, %</th>
                <th>ВС·ч</th>
                <th>Место·ч</th>
                <th>Конфликт, %</th>
              </tr>
            </thead>
            <tbody>
              {grain === "period"
                ? hangars.map((h) => (
                    <tr key={h.hangarId}>
                      <td>{h.hangarName}</td>
                      <td>
                        <div className="analyticsUtilCell">
                          <span>{fmtNum(h.efficiency.capacityUtilizationPct)}%</span>
                          <span className="analyticsUtilTrack">
                            <span
                              className="analyticsUtilFill"
                              style={{ width: `${Math.min(100, h.efficiency.capacityUtilizationPct)}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <td>{fmtNum(h.efficiency.timeUtilizationPct)}%</td>
                      <td>{fmtNum(h.utilizationPct)}%</td>
                      <td>{fmtNum(h.efficiency.aircraftHours)}</td>
                      <td>{fmtNum(h.efficiency.capacityHours)}</td>
                      <td>{fmtNum(h.efficiency.conflictPct)}%</td>
                    </tr>
                  ))
                : buckets.flatMap((b) =>
                    b.hangars.map((h) => (
                      <tr key={`${b.key}-${h.hangarId}`}>
                        <td>{b.label}</td>
                        <td>{h.hangarName}</td>
                        <td>{fmtNum(h.capacityUtilizationPct)}%</td>
                        <td>{fmtNum(h.timeUtilizationPct)}%</td>
                        <td>{fmtNum(h.standUtilizationPct)}%</td>
                        <td>{fmtNum(h.aircraftHours)}</td>
                        <td>{fmtNum(h.capacityHours)}</td>
                        <td>{fmtNum(h.conflictPct)}%</td>
                      </tr>
                    ))
                  )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card analyticsCard">
        <h3>Ангары (stand utilization)</h3>
        <p className="muted small">
          Ёмкость и простой только по активной схеме; заблокированные конфигурации не учитываются.
        </p>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>Ангар</th>
                <th>Мест (nominal)</th>
                <th>Занято, ч</th>
                <th>Простой, ч</th>
                <th>Utilization</th>
                <th>Резервов</th>
              </tr>
            </thead>
            <tbody>
              {hangars.map((h) => (
                <tr key={h.hangarId}>
                  <td>{h.hangarName}</td>
                  <td>{h.standCount}</td>
                  <td>{fmtNum(h.occupiedH)}</td>
                  <td>{fmtNum(h.idleH)}</td>
                  <td>
                    <div className="analyticsUtilCell">
                      <span>{fmtNum(h.utilizationPct)}%</span>
                      <span className="analyticsUtilTrack">
                        <span className="analyticsUtilFill" style={{ width: `${Math.min(100, h.utilizationPct)}%` }} />
                      </span>
                    </div>
                  </td>
                  <td>{h.reservationCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card analyticsCard">
        <h3>Места стоянки</h3>
        <p className="muted small">
          Простой места считается только пока его схема была активной. Места заблокированных схем — без idle.
        </p>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>Место</th>
                <th>Ангар</th>
                <th>Схема</th>
                <th>Доступно, ч</th>
                <th>Занято, ч</th>
                <th>Простой, ч</th>
                <th>Utilization</th>
              </tr>
            </thead>
            <tbody>
              {stands
                .filter((s) => !s.blockedByOtherLayout || s.reservationCount > 0 || (s.availableH ?? 0) > 0)
                .slice(0, 80)
                .map((s) => (
                <tr key={s.standId}>
                  <td>{s.standCode}</td>
                  <td>{s.hangarName}</td>
                  <td>{s.layoutName}</td>
                  <td>{fmtNum(s.availableH)}</td>
                  <td>{fmtNum(s.occupiedH)}</td>
                  <td>{fmtNum(s.idleH)}</td>
                  <td>{fmtNum(s.utilizationPct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stands.length > 80 ? <div className="muted">Показаны топ-80 мест по загрузке</div> : null}
        </div>
      </section>
    </div>
  );
}

function ComparePanel(props: {
  q: { isLoading: boolean; error: Error | null; data?: CompareResponse };
  list: SandboxSummary[];
  compareA: string;
  compareB: string;
  setCompareA: (v: string) => void;
  setCompareB: (v: string) => void;
  compareReady: boolean;
  filters: AnalyticsFilters;
  periodLabel: string;
}) {
  const { q, list, compareA, compareB, setCompareA, setCompareB, compareReady, filters, periodLabel } = props;
  const [expandedHangarId, setExpandedHangarId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const hangarCompare = useMemo(() => {
    const rows = q.data?.hangarCompare ?? [];
    return rows
      .map((h) => ({
        ...h,
        aEvents: (h.aEvents ?? []).filter((e) => matchFilters(e, filters)),
        bEvents: (h.bEvents ?? []).filter((e) => matchFilters(e, filters))
      }))
      .filter((h) => {
        if (filters.hangarIds.length > 0 && !filters.hangarIds.includes(h.hangarId)) return false;
        if (filtersActiveExceptHangar(filters) && h.aEvents.length === 0 && h.bEvents.length === 0) return false;
        return true;
      });
  }, [q.data, filters]);

  const compareChartData = useMemo<ChartData<"bar">>(
    () => ({
      labels: hangarCompare.map((h) => h.hangarName),
      datasets: [
        {
          label: "A, ч",
          data: hangarCompare.map((h) => h.aOccupiedH),
          backgroundColor: "rgba(14, 116, 144, 0.45)",
          borderRadius: 3
        },
        {
          label: "B, ч",
          data: hangarCompare.map((h) => h.bOccupiedH),
          backgroundColor: "rgba(180, 83, 9, 0.45)",
          borderRadius: 3
        }
      ]
    }),
    [hangarCompare]
  );

  const compareChartOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", align: "start", labels: { boxWidth: 12, color: "#475569" } }
      },
      scales: {
        x: { ticks: { color: "#64748b", maxRotation: 45, minRotation: 0 }, grid: { display: false } },
        y: {
          beginAtZero: true,
          title: { display: true, text: "ч", color: "#64748b" },
          ticks: { color: "#64748b" },
          grid: { color: "rgba(148, 163, 184, 0.25)" }
        }
      }
    }),
    []
  );

  const onExport = async () => {
    if (!q.data) return;
    setExporting(true);
    try {
      const eventsFlat: Array<Record<string, string | number | null>> = [];
      for (const h of hangarCompare) {
        for (const e of h.aEvents) {
          eventsFlat.push({
            Сценарий: "A",
            Ангар: h.hangarName,
            Борт: e.aircraft,
            Событие: e.title,
            "Тип события": e.eventType,
            Статус: e.status,
            Место: e.standCode,
            Старт: e.startAt,
            Окончание: e.endAt,
            "Занято, ч": e.occupiedH
          });
        }
        for (const e of h.bEvents) {
          eventsFlat.push({
            Сценарий: "B",
            Ангар: h.hangarName,
            Борт: e.aircraft,
            Событие: e.title,
            "Тип события": e.eventType,
            Статус: e.status,
            Место: e.standCode,
            Старт: e.startAt,
            Окончание: e.endAt,
            "Занято, ч": e.occupiedH
          });
        }
      }

      await exportCompareExcel({
        periodLabel,
        nameA: q.data.a.name,
        nameB: q.data.b.name,
        kpis: [
          { label: "Δ событий", value: fmtSigned(q.data.delta.events) },
          { label: "Δ размещённых", value: fmtSigned(q.data.delta.placed) },
          { label: "Δ неразмещённых", value: fmtSigned(q.data.delta.unplaced) },
          { label: "Δ ВС·ч", value: fmtSigned(q.data.delta.aircraftHours) },
          { label: "Δ занятость мест, ч", value: fmtSigned(q.data.delta.occupiedStandHours) },
          { label: "Δ простой, ч", value: fmtSigned(q.data.delta.idleH) },
          { label: "Δ utilization, п.п.", value: fmtSigned(q.data.delta.utilizationPct) },
          { label: "Δ ср. TAT, ч", value: fmtSigned(q.data.delta.avgEventTatH) }
        ],
        sides: [
          {
            Сторона: "A",
            Название: q.data.a.name,
            Событий: q.data.a.events,
            Размещено: q.data.a.placed,
            Неразмещено: q.data.a.unplaced,
            "ВС·ч": q.data.a.aircraftHours,
            "Занято мест·ч": q.data.a.occupiedStandHours,
            "Простой, ч": q.data.a.idleH,
            "Utilization, %": q.data.a.utilizationPct,
            "Ср. TAT, ч": q.data.a.avgEventTatH
          },
          {
            Сторона: "B",
            Название: q.data.b.name,
            Событий: q.data.b.events,
            Размещено: q.data.b.placed,
            Неразмещено: q.data.b.unplaced,
            "ВС·ч": q.data.b.aircraftHours,
            "Занято мест·ч": q.data.b.occupiedStandHours,
            "Простой, ч": q.data.b.idleH,
            "Utilization, %": q.data.b.utilizationPct,
            "Ср. TAT, ч": q.data.b.avgEventTatH
          }
        ],
        hangars: hangarCompare.map((h) => ({
          Ангар: h.hangarName,
          "A, ч": h.aOccupiedH,
          "B, ч": h.bOccupiedH,
          "Δ, ч": h.deltaH,
          "Событий A": h.aEvents.length,
          "Событий B": h.bEvents.length
        })),
        events: eventsFlat,
        chart: {
          labels: hangarCompare.map((h) => h.hangarName),
          aHours: hangarCompare.map((h) => h.aOccupiedH),
          bHours: hangarCompare.map((h) => h.bOccupiedH)
        }
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="analyticsStack">
      <div className="analyticsModuleHead">
        <div>
          <strong>Сценарии A vs B</strong>
          <span className="muted"> · {periodLabel}</span>
        </div>
        <ExcelExportButton
          onClick={() => void onExport()}
          disabled={!compareReady || exporting || !q.data}
          title="Выгрузить сравнение A vs B в Excel (таблицы + график)"
        />
      </div>

      <div className="analyticsToolbar card">
        <label className="analyticsField analyticsFieldGrow">
          <span>Сценарий A</span>
          <select className="evInput" value={compareA} onChange={(e) => setCompareA(e.target.value)}>
            <option value="prod">Рабочий контур</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="analyticsField analyticsFieldGrow">
          <span>Сценарий B</span>
          <select className="evInput" value={compareB} onChange={(e) => setCompareB(e.target.value)}>
            <option value="">— выберите —</option>
            <option value="prod">Рабочий контур</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!compareReady ? (
        <div className="muted">Выберите два разных сценария для сравнения.</div>
      ) : q.isLoading && !q.data ? (
        <div className="muted">Загрузка…</div>
      ) : q.error && !q.data ? (
        <div className="error">{String((q.error as any).message ?? q.error)}</div>
      ) : q.data ? (
        <>
          <div className="analyticsCompareHeads">
            <div className="card analyticsCard">
              <div className="muted">A · {scopeLabel(compareA, list)}</div>
              <h3>{q.data.a.name}</h3>
              <div className="analyticsMiniStats">
                <span>
                  <b>{q.data.a.events}</b> событий
                </span>
                <span>
                  <b>{fmtNum(q.data.a.utilizationPct)}%</b> util
                </span>
                <span>
                  <b>{fmtNum(q.data.a.idleH)}</b> ч простоя
                </span>
                <span>
                  <b>{fmtNum(q.data.a.aircraftHours)}</b> ВС·ч
                </span>
              </div>
            </div>
            <div className="card analyticsCard">
              <div className="muted">B · {scopeLabel(compareB, list)}</div>
              <h3>{q.data.b.name}</h3>
              <div className="analyticsMiniStats">
                <span>
                  <b>{q.data.b.events}</b> событий
                </span>
                <span>
                  <b>{fmtNum(q.data.b.utilizationPct)}%</b> util
                </span>
                <span>
                  <b>{fmtNum(q.data.b.idleH)}</b> ч простоя
                </span>
                <span>
                  <b>{fmtNum(q.data.b.aircraftHours)}</b> ВС·ч
                </span>
              </div>
            </div>
          </div>

          <StatCards
            items={[
              { label: "Δ событий", value: fmtSigned(q.data.delta.events) },
              { label: "Δ размещённых", value: fmtSigned(q.data.delta.placed) },
              { label: "Δ неразмещённых", value: fmtSigned(q.data.delta.unplaced) },
              { label: "Δ ВС·ч", value: fmtSigned(q.data.delta.aircraftHours) },
              { label: "Δ занятость мест, ч", value: fmtSigned(q.data.delta.occupiedStandHours) },
              { label: "Δ простой, ч", value: fmtSigned(q.data.delta.idleH) },
              { label: "Δ utilization, п.п.", value: fmtSigned(q.data.delta.utilizationPct) },
              { label: "Δ ср. TAT, ч", value: fmtSigned(q.data.delta.avgEventTatH) }
            ]}
          />

          <section className="card analyticsCard">
            <h3>Сравнение загрузки по ангарам</h3>
            {hangarCompare.length === 0 ? (
              <div className="muted">Нет данных в периоде</div>
            ) : (
              <div className="analyticsCompareChartWrap">
                <Chart type="bar" data={compareChartData} options={compareChartOptions} />
              </div>
            )}
          </section>

          <section className="card analyticsCard">
            <h3>Загрузка по ангарам (A vs B)</h3>
            <p className="muted small">Нажмите на ангар, чтобы раскрыть события сценариев.</p>
            <div className="analyticsTableWrap">
              <table className="analyticsTable">
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>Ангар</th>
                    <th>A, ч</th>
                    <th>B, ч</th>
                    <th>Δ</th>
                    <th>Событий A/B</th>
                  </tr>
                </thead>
                <tbody>
                  {hangarCompare.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        Нет данных в периоде
                      </td>
                    </tr>
                  ) : (
                    hangarCompare.map((h) => {
                      const open = expandedHangarId === h.hangarId;
                      return (
                        <Fragment key={h.hangarId}>
                          <tr className="analyticsExpandRow" onClick={() => setExpandedHangarId(open ? null : h.hangarId)}>
                            <td aria-hidden="true">{open ? "▾" : "▸"}</td>
                            <td>
                              <button type="button" className="analyticsExpandBtn">
                                {h.hangarName}
                              </button>
                            </td>
                            <td>{fmtNum(h.aOccupiedH)}</td>
                            <td>{fmtNum(h.bOccupiedH)}</td>
                            <td className={h.deltaH > 0 ? "analyticsBad" : h.deltaH < 0 ? "analyticsGood" : undefined}>
                              {fmtSigned(h.deltaH)}
                            </td>
                            <td>
                              {h.aEvents.length} / {h.bEvents.length}
                            </td>
                          </tr>
                          {open ? (
                            <tr className="analyticsExpandDetail">
                              <td colSpan={6}>
                                <div className="analyticsCompareEvents">
                                  <div>
                                    <strong>A · события</strong>
                                    <CompareEventsList events={h.aEvents} />
                                  </div>
                                  <div>
                                    <strong>B · события</strong>
                                    <CompareEventsList events={h.bEvents} />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function filtersActiveExceptHangar(filters: AnalyticsFilters): boolean {
  return (
    filters.operatorIds.length > 0 ||
    filters.aircraftTypeIds.length > 0 ||
    filters.aircraftIds.length > 0 ||
    filters.eventTypeIds.length > 0
  );
}

function CompareEventsList(props: { events: CompareEvent[] }) {
  if (props.events.length === 0) return <div className="muted small">Нет событий</div>;
  return (
    <ul className="analyticsEventMiniList">
      {props.events.map((e) => (
        <li key={`${e.eventId}-${e.startAt}-${e.standCode ?? "none"}`}>
          <b>{e.aircraft}</b> · {e.title}
          <div className="muted">
            {e.eventType}
            {e.standCode ? ` · ${e.standCode}` : " · без места"} · {dayjs(e.startAt).format("DD.MM HH:mm")}–
            {dayjs(e.endAt).format("DD.MM HH:mm")} · {fmtNum(e.occupiedH)} ч
          </div>
        </li>
      ))}
    </ul>
  );
}
