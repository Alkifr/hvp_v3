import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

import { apiDelete, apiGet, apiPost } from "../../lib/api";
import { isValidDateInput, isValidDateTimeLocal } from "../../lib/dateInput";
import { parseHashPage } from "../../lib/eventDeepLink";
import { fromInputMskOptional, MSK_OFFSET_MINUTES, toInputMsk } from "../../lib/localDate";
import { hasPermission } from "../../lib/permissionCatalog";
import { downloadTowReportXlsx } from "../../lib/towReportExcel";
import { parseTowsViewShare, syncTowsViewHash } from "../../lib/viewShareUrl";
import { authMe } from "../auth/authApi";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { useActiveSandbox } from "../components/SandboxSwitcher";
import { TowPlanGrid, type TowPlanRow } from "./TowPlanGrid";
import { TowReportTable, type TowReportRow } from "./TowReportTable";

dayjs.extend(utc);

type PlanResponse = {
  items: TowPlanRow[];
};

type TowArchiveItem = {
  id: string;
  title: string;
  fromAt: string;
  toAt: string;
  planCount: number;
  reportCount: number;
  createdAt: string;
  createdBy: { displayName?: string | null; email: string } | null;
};

type TowArchiveDetail = TowArchiveItem & {
  payload: { from: string; to: string; plan: TowPlanRow[]; report: TowReportRow[] };
};

type FacetRow = {
  hangars: Array<{ id: string; label: string }>;
  operatorId: string;
  operator: string;
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
};

type TowFilters = {
  hangarIds: string[];
  operatorIds: string[];
  aircraftTypeIds: string[];
  aircraftIds: string[];
};

type TowFilterKey = keyof TowFilters;

function mskNow() {
  return dayjs().utcOffset(MSK_OFFSET_MINUTES);
}

function operationalWindow(now = mskNow()) {
  const start = now.hour() < 8 ? now.subtract(1, "day") : now;
  return {
    from: `${start.format("YYYY-MM-DD")}T08:00`,
    to: `${start.add(1, "day").format("YYYY-MM-DD")}T08:00`
  };
}

function shiftOperationalDay(fromLocal: string, days: number): { from: string; to: string } {
  const raw = isValidDateTimeLocal(fromLocal) || isValidDateInput(fromLocal) ? fromLocal.slice(0, 10) : operationalWindow().from.slice(0, 10);
  const start = dayjs(raw).add(days, "day");
  return {
    from: `${start.format("YYYY-MM-DD")}T08:00`,
    to: `${start.add(1, "day").format("YYYY-MM-DD")}T08:00`
  };
}

function asDateTime(value: string, fallback: string): string {
  if (isValidDateTimeLocal(value)) return value;
  if (isValidDateInput(value)) return `${value}T08:00`;
  return fallback;
}

const TOWS_UI_LS_KEY = "hangarPlanning:towsUi:v2";
const TOWS_UI_LS_KEY_V1 = "hangarPlanning:towsUi:v1";

function safeRead(key: string): any | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWriteTowsUi(v: unknown) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TOWS_UI_LS_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

function readStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

function facetMatches(row: FacetRow, filters: TowFilters, skip?: TowFilterKey): boolean {
  if (skip !== "hangarIds" && filters.hangarIds.length > 0 && !row.hangars.some((hangar) => filters.hangarIds.includes(hangar.id))) {
    return false;
  }
  if (skip !== "operatorIds" && filters.operatorIds.length > 0 && !filters.operatorIds.includes(row.operatorId)) return false;
  if (skip !== "aircraftTypeIds" && filters.aircraftTypeIds.length > 0 && !filters.aircraftTypeIds.includes(row.aircraftTypeId)) {
    return false;
  }
  if (skip !== "aircraftIds" && filters.aircraftIds.length > 0 && !filters.aircraftIds.includes(row.aircraftId)) return false;
  return true;
}

function reportFacet(row: TowReportRow): FacetRow {
  return {
    hangars: row.hangarId ? [{ id: row.hangarId, label: row.hangarNumber || row.hangarId }] : [],
    operatorId: row.operatorId,
    operator: row.operator,
    aircraftTypeId: row.aircraftTypeId,
    aircraftType: row.aircraftType,
    aircraftId: row.aircraftId,
    tailNumber: row.tailNumber
  };
}

function rowFacet(row: TowPlanRow): FacetRow {
  return {
    hangars: row.hangars,
    operatorId: row.operatorId,
    operator: row.operator,
    aircraftTypeId: row.aircraftTypeId,
    aircraftType: row.aircraftType,
    aircraftId: row.aircraftId,
    tailNumber: row.tailNumber
  };
}

export function RmTowsView() {
  const qc = useQueryClient();
  const { active: activeSandbox, activeId: activeSandboxId } = useActiveSandbox();
  const windowDefault = operationalWindow();
  const savedUi = useMemo(() => {
    const current = safeRead(TOWS_UI_LS_KEY);
    const legacy = safeRead(TOWS_UI_LS_KEY_V1);
    const ls = current ?? (legacy ? { ...legacy, fromDate: "", toDate: "" } : null);
    if (typeof window === "undefined") return ls;
    const { page, query } = parseHashPage(location.hash);
    if (page !== "tows") return ls;
    const share = parseTowsViewShare(query);
    if (!share) return ls;
    return {
      ...ls,
      ...share,
      fromDate: share.fromDate || ls?.fromDate,
      toDate: share.toDate || ls?.toDate
    };
  }, []);
  const [rangeFrom, setRangeFrom] = useState(() => asDateTime(String(savedUi?.fromDate ?? ""), windowDefault.from));
  const [rangeTo, setRangeTo] = useState(() => asDateTime(String(savedUi?.toDate ?? ""), windowDefault.to));
  const [hangarIds, setHangarIds] = useState<string[]>(() => readStringArray(savedUi?.filterHangarIds));
  const [operatorIds, setOperatorIds] = useState<string[]>(() => readStringArray(savedUi?.filterOperatorIds));
  const [aircraftTypeIds, setAircraftTypeIds] = useState<string[]>(() => readStringArray(savedUi?.filterAircraftTypeIds));
  const [aircraftIds, setAircraftIds] = useState<string[]>(() => readStringArray(savedUi?.filterAircraftIds));
  const [pane, setPane] = useState<"plan" | "registry" | "archive">(() => (savedUi?.tab === "registry" ? "registry" : "plan"));
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  const [fixMessage, setFixMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [planDirty, setPlanDirty] = useState(0);
  const [reportDirty, setReportDirty] = useState(0);
  const onPlanDirty = useCallback((count: number) => setPlanDirty(count), []);
  const onReportDirty = useCallback((count: number) => setReportDirty(count), []);

  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => authMe() });
  const permissions = meQ.data && meQ.data.ok ? meQ.data.user.permissions : [];
  const canWrite =
    hasPermission(permissions, "tows:write") ||
    hasPermission(permissions, "events:write") ||
    hasPermission(permissions, "gantt:write");
  const canGantt = hasPermission(permissions, "gantt:read");
  const rangeReady = isValidDateTimeLocal(rangeFrom) && isValidDateTimeLocal(rangeTo) && rangeTo > rangeFrom;
  const fromIso = fromInputMskOptional(rangeFrom);
  const toIso = fromInputMskOptional(rangeTo);

  const planQ = useQuery({
    queryKey: ["tows-plan", fromIso, toIso, activeSandbox?.id ?? null],
    enabled: rangeReady && Boolean(fromIso && toIso),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("from", fromIso!);
      params.set("to", toIso!);
      return apiGet<PlanResponse>(`/api/tows/plan?${params.toString()}`);
    }
  });
  const reportQ = useQuery({
    queryKey: ["tows-report", fromIso, toIso, activeSandbox?.id ?? null],
    enabled: rangeReady && Boolean(fromIso && toIso),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("from", fromIso!);
      params.set("to", toIso!);
      return apiGet<{ items: TowReportRow[] }>(`/api/tows?${params.toString()}`);
    }
  });
  const archivesQ = useQuery({
    queryKey: ["tows-archives"],
    enabled: true,
    queryFn: () => apiGet<{ items: TowArchiveItem[] }>("/api/tows/archives")
  });
  const archiveQ = useQuery({
    queryKey: ["tows-archive", archiveId],
    enabled: Boolean(archiveId),
    queryFn: () => apiGet<{ item: TowArchiveDetail }>(`/api/tows/archives/${archiveId}`)
  });
  const openedTow = archiveId ? archiveQ.data?.item ?? null : null;
  const shownFrom = openedTow ? toInputMsk(openedTow.payload.from) : rangeFrom;
  const shownTo = openedTow ? toInputMsk(openedTow.payload.to) : rangeTo;
  const loaded = openedTow?.payload.plan ?? (archiveId ? [] : planQ.data?.items ?? []);
  const reportLoaded = openedTow?.payload.report ?? (archiveId ? [] : reportQ.data?.items ?? []);
  const filters = useMemo<TowFilters>(
    () => ({ hangarIds, operatorIds, aircraftTypeIds, aircraftIds }),
    [hangarIds, operatorIds, aircraftTypeIds, aircraftIds]
  );
  const facetRows = useMemo(() => [...loaded.map(rowFacet), ...reportLoaded.map(reportFacet)], [loaded, reportLoaded]);

  useEffect(() => {
    safeWriteTowsUi({
      fromDate: rangeFrom,
      toDate: rangeTo,
      tab: pane,
      filterHangarIds: hangarIds,
      filterOperatorIds: operatorIds,
      filterAircraftTypeIds: aircraftTypeIds,
      filterAircraftIds: aircraftIds
    });
  }, [rangeFrom, rangeTo, pane, hangarIds, operatorIds, aircraftTypeIds, aircraftIds]);

  useEffect(() => {
    if (pane !== "registry") return;
    void qc.refetchQueries({ queryKey: ["tows-report"] });
  }, [pane, fromIso, toIso, activeSandbox?.id, qc]);

  useEffect(() => {
    syncTowsViewHash({
      fromDate: rangeFrom,
      toDate: rangeTo,
      tab: pane === "registry" ? "registry" : "plan",
      filterHangarIds: hangarIds,
      filterOperatorIds: operatorIds,
      filterAircraftTypeIds: aircraftTypeIds,
      filterAircraftIds: aircraftIds,
      sandboxId: activeSandboxId
    });
  }, [rangeFrom, rangeTo, pane, hangarIds, operatorIds, aircraftTypeIds, aircraftIds, activeSandboxId]);

  const smartFilterOptions = useMemo(() => {
    const hangarMap = new Map<string, string>();
    const operatorMap = new Map<string, string>();
    const typeMap = new Map<string, string>();
    const aircraftMap = new Map<string, string>();
    for (const row of facetRows) {
      if (facetMatches(row, filters, "hangarIds")) {
        for (const hangar of row.hangars) hangarMap.set(hangar.id, hangar.label || hangar.id);
      }
      if (row.operatorId && facetMatches(row, filters, "operatorIds")) operatorMap.set(row.operatorId, row.operator || row.operatorId);
      if (row.aircraftTypeId && facetMatches(row, filters, "aircraftTypeIds")) {
        typeMap.set(row.aircraftTypeId, row.aircraftType || row.aircraftTypeId);
      }
      if (row.aircraftId && facetMatches(row, filters, "aircraftIds")) aircraftMap.set(row.aircraftId, row.tailNumber || row.aircraftId);
    }
    const toOpts = (map: Map<string, string>) =>
      [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "ru"));
    return {
      hangars: toOpts(hangarMap),
      operators: toOpts(operatorMap),
      aircraftTypes: toOpts(typeMap),
      aircraft: toOpts(aircraftMap)
    };
  }, [facetRows, filters]);

  useEffect(() => {
    if (archiveId || facetRows.length === 0) return;
    const prune = (selected: string[], available: Set<string>) => selected.filter((id) => available.has(id));
    const nextHangars = prune(hangarIds, new Set(smartFilterOptions.hangars.map((item) => item.id)));
    if (nextHangars.length !== hangarIds.length) setHangarIds(nextHangars);
    const nextOperators = prune(operatorIds, new Set(smartFilterOptions.operators.map((item) => item.id)));
    if (nextOperators.length !== operatorIds.length) setOperatorIds(nextOperators);
    const nextTypes = prune(aircraftTypeIds, new Set(smartFilterOptions.aircraftTypes.map((item) => item.id)));
    if (nextTypes.length !== aircraftTypeIds.length) setAircraftTypeIds(nextTypes);
    const nextAircraft = prune(aircraftIds, new Set(smartFilterOptions.aircraft.map((item) => item.id)));
    if (nextAircraft.length !== aircraftIds.length) setAircraftIds(nextAircraft);
  }, [archiveId, facetRows.length, smartFilterOptions, hangarIds, operatorIds, aircraftTypeIds, aircraftIds]);

  const items = useMemo(() => loaded.filter((row) => facetMatches(rowFacet(row), filters)), [loaded, filters]);
  const reportItems = useMemo(
    () => reportLoaded.filter((row) => facetMatches(reportFacet(row), filters)).map((row, index) => ({ ...row, seq: index + 1 })),
    [reportLoaded, filters]
  );
  const waiting = useMemo(() => items.filter((row) => !row.towId).length, [items]);

  const saveArchiveM = useMutation({
    mutationFn: () => apiPost<{ item: { id: string } }>("/api/tows/archives", { from: fromIso, to: toIso }),
    onSuccess: async (res) => {
      setArchiveId(res.item.id);
      setPane("plan");
      await qc.invalidateQueries({ queryKey: ["tows-archives"] });
    }
  });
  const deleteArchiveM = useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: true }>(`/api/tows/archives/${id}`),
    onSuccess: async (_result, id) => {
      if (archiveId === id) setArchiveId(null);
      await qc.invalidateQueries({ queryKey: ["tows-archives"] });
      await qc.removeQueries({ queryKey: ["tows-archive", id] });
    }
  });

  const fixM = useMutation({
    mutationFn: async () => {
      if (!fromIso || !toIso) throw new Error("Укажите период");
      if (reportItems.length === 0) throw new Error("В выбранном периоде нет назначенных буксировок");
      return apiPost<{ ok: true; subject: string; rows: number }>("/api/tows/fix", {
        from: fromIso,
        to: toIso,
        hangarIds,
        operatorIds,
        aircraftTypeIds,
        aircraftIds
      });
    },
    onSuccess: async (res) => {
      setFixMessage(`План зафиксирован: ${res.rows} строк. Письмо отправляется из раздела «Рассылка».`);
      await qc.invalidateQueries({ queryKey: ["tows-report"] });
      await qc.invalidateQueries({ queryKey: ["tows-sends"] });
    }
  });

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const stamp = mskNow().format("YYYYMMDD-HHmm");
      await downloadTowReportXlsx(reportItems, `buksirovki-${stamp}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const shiftDay = (days: number) => {
    const next = shiftOperationalDay(rangeFrom, days);
    setRangeFrom(next.from);
    setRangeTo(next.to);
  };

  const openEvent = (eventId: string) => {
    const q = new URLSearchParams();
    q.set("event", eventId);
    if (activeSandbox?.id) q.set("sandbox", activeSandbox.id);
    location.hash = `gantt?${q.toString()}`;
  };

  return (
    <div className="itpPage towsPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Рабочее место буксировок</div>
          <h1>РМ Буксировки</h1>
          <p className="muted towsPaneHint">
            {pane === "plan"
              ? "План — все события выбранного периода. Откуда, куда и время буксировки заполняются вместе. Буксировка видна в строке, только если её время попадает в период."
              : "Реестр — только буксировки, заполненные на плане. Занятие МС, примечание, позиция и причина правятся здесь. Слот ТО показан датой окончания."}
          </p>
        </div>
        <div className="massHeroStats" aria-label="Сводка буксировок">
          <span>
            <b>{pane === "plan" ? items.length : reportItems.length}</b> {pane === "plan" ? "строк" : "буксировок"}
          </span>
          {pane === "plan" ? (
            <span>
              <b>{waiting}</b> без буксировки
            </span>
          ) : null}
          <span>
            <b>{activeSandbox ? "Песочница" : "Рабочий контур"}</b>
          </span>
        </div>
      </section>

      <section className="card hangarFilterPanel analyticsFilterBar">
        <div className="ganttToolbar">
          <div className="ganttToolbarRow">
            <div className="ganttToolbarGroup">
              <button className="btn towsDayStep" type="button" aria-label="Предыдущие сутки" title="Предыдущие сутки, 08:00–08:00" disabled={Boolean(openedTow)} onClick={() => shiftDay(-1)}>
                ‹
              </button>
              <label className="tgField">
                <span className="tgFieldLabel">с</span>
                <input type="datetime-local" value={shownFrom} disabled={Boolean(openedTow)} onChange={(e) => setRangeFrom(e.target.value)} />
              </label>
              <label className="tgField">
                <span className="tgFieldLabel">по</span>
                <input type="datetime-local" value={shownTo} disabled={Boolean(openedTow)} onChange={(e) => setRangeTo(e.target.value)} />
              </label>
              <button className="btn towsDayStep" type="button" aria-label="Следующие сутки" title="Следующие сутки, 08:00–08:00" disabled={Boolean(openedTow)} onClick={() => shiftDay(1)}>
                ›
              </button>
              <label className={`tgField${hangarIds.length ? " tgFieldActive" : ""}`}>
                <span className="tgFieldLabel">Ангар</span>
                <MultiSelectDropdown
                  options={smartFilterOptions.hangars}
                  value={hangarIds}
                  onChange={setHangarIds}
                  placeholder="все"
                  width={150}
                  maxHeight={320}
                  searchable
                  searchPlaceholder="Найти ангар"
                  compact
                />
              </label>
              <label className={`tgField${operatorIds.length ? " tgFieldActive" : ""}`}>
                <span className="tgFieldLabel">Оператор</span>
                <MultiSelectDropdown
                  options={smartFilterOptions.operators}
                  value={operatorIds}
                  onChange={setOperatorIds}
                  placeholder="все"
                  width={160}
                  maxHeight={320}
                  searchable
                  searchPlaceholder="Найти оператора"
                  compact
                />
              </label>
              <label className={`tgField${aircraftTypeIds.length ? " tgFieldActive" : ""}`}>
                <span className="tgFieldLabel">Тип ВС</span>
                <MultiSelectDropdown
                  options={smartFilterOptions.aircraftTypes}
                  value={aircraftTypeIds}
                  onChange={setAircraftTypeIds}
                  placeholder="все"
                  width={150}
                  maxHeight={320}
                  searchable
                  searchPlaceholder="Найти тип ВС"
                  compact
                />
              </label>
              <label className={`tgField${aircraftIds.length ? " tgFieldActive" : ""}`}>
                <span className="tgFieldLabel">Борт</span>
                <MultiSelectDropdown
                  options={smartFilterOptions.aircraft}
                  value={aircraftIds}
                  onChange={setAircraftIds}
                  placeholder="все"
                  width={140}
                  maxHeight={320}
                  searchable
                  searchPlaceholder="Найти борт"
                  compact
                />
              </label>
            </div>
            <div className="ganttToolbarGroup towsToolbarExport">
              {canWrite && !openedTow ? (
                <button className="btn" type="button" disabled={!rangeReady || !fromIso || saveArchiveM.isPending} title="Сохранить план и реестр этого окна. Потом архив можно открыть целиком." onClick={() => saveArchiveM.mutate()}>
                  {saveArchiveM.isPending ? "Сохранение…" : "Сохранить архив"}
                </button>
              ) : null}
              {pane === "registry" && !openedTow ? (
                <button className="btn" type="button" onClick={() => setFixOpen((open) => !open)} disabled={!canWrite}>
                  Зафиксировать план
                </button>
              ) : null}
              {pane === "registry" ? (
              <button
                className="btn ganttIconBtn"
                type="button"
                onClick={() => void exportXlsx()}
                disabled={exporting || reportItems.length === 0}
                title="Выгрузить Excel"
                aria-label="Выгрузить Excel"
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
              ) : null}
            </div>
          </div>
          {!rangeReady ? <div className="error">Окончание окна должно быть позже начала</div> : null}
          {planQ.error ? <div className="error">{String((planQ.error as Error).message ?? planQ.error)}</div> : null}
          {reportQ.error ? <div className="error">{String((reportQ.error as Error).message ?? reportQ.error)}</div> : null}
          <div className="towsDirtySlot">
            {pane === "plan" && planDirty > 0 ? <span className="muted">Несохранённых буксировок: {planDirty}.</span> : null}
            {pane === "registry" && reportDirty > 0 ? <span className="muted">Несохранённых строк: {reportDirty}. В фиксацию они не входят.</span> : null}
          </div>
        </div>
      </section>

      {pane === "registry" && fixOpen ? (
        <section className="card towsSendPanel">
          <div className="muted">Сохраняется снимок видимых строк. Шаблон письма, Excel и журнал отправок — в разделе «Рассылка».</div>
          <div className="row">
            <button
              className="btn btnPrimary"
              type="button"
              disabled={!canWrite || fixM.isPending || reportItems.length === 0 || reportDirty > 0}
              onClick={() => fixM.mutate()}
            >
              Зафиксировать
            </button>
          </div>
          {fixM.isError ? <div className="error">{String((fixM.error as Error).message ?? fixM.error)}</div> : null}
          {fixMessage ? <div className="muted">{fixMessage}</div> : null}
        </section>
      ) : null}

      {openedTow ? (
        <div className="personnelArchiveBanner">
          <span>Открыт архив · {openedTow.title}. Снимок от {new Date(openedTow.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{openedTow.createdBy ? `, ${openedTow.createdBy.displayName || openedTow.createdBy.email}` : ""}. План и реестр показывают сохранённые строки. Текущие буксировки не меняются.</span>
          <button type="button" className="btn" onClick={() => setArchiveId(null)}>К текущим буксировкам</button>
        </div>
      ) : null}
      {archiveId && archiveQ.isLoading ? <section className="card">Загрузка архива…</section> : null}
      {archiveQ.error ? <div className="error">{String((archiveQ.error as Error).message ?? archiveQ.error)}</div> : null}
      {saveArchiveM.error ? <div className="error">{String((saveArchiveM.error as Error).message ?? saveArchiveM.error)}</div> : null}

      <div className="sandboxesTabs" role="tablist" aria-label="Окна РМ Буксировки">
        <button
          type="button"
          role="tab"
          aria-selected={pane === "plan"}
          className={pane === "plan" ? "sandboxesTab active" : "sandboxesTab"}
          onClick={() => setPane("plan")}
        >
          План <span className="sandboxesTabCount">{items.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "registry"}
          className={pane === "registry" ? "sandboxesTab active" : "sandboxesTab"}
          onClick={() => setPane("registry")}
        >
          Реестр <span className="sandboxesTabCount">{reportItems.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "archive"}
          className={pane === "archive" ? "sandboxesTab active" : "sandboxesTab"}
          onClick={() => setPane("archive")}
        >
          Архив <span className="sandboxesTabCount">{archivesQ.data?.items.length ?? 0}</span>
        </button>
      </div>

      {pane === "archive" ? (
        <section className="card">
          <h2 className="personnelResourceTitle">Архив буксировок</h2>
          <p className="muted">«Сохранить архив» записывает план и реестр выбранного окна. Строка открывает этот снимок на вкладках «План» и «Реестр». «Удалить» убирает сохранённое окно.</p>
          {deleteArchiveM.error ? <div className="error">{String((deleteArchiveM.error as Error).message ?? deleteArchiveM.error)}</div> : null}
          {archivesQ.isLoading ? <p className="muted">Загрузка…</p> : archivesQ.data?.items.length ? (
            <table className="personnelSimpleTable">
              <thead><tr><th>Сохранён</th><th>Окно</th><th>План</th><th>Реестр</th><th>Кто</th>{canWrite ? <th></th> : null}</tr></thead>
              <tbody>
                {archivesQ.data.items.map((item) => (
                  <tr key={item.id} className={`personnelArchiveRow${archiveId === item.id ? " personnelArchiveActive" : ""}`} onClick={() => { setArchiveId(item.id); setPane("plan"); }}>
                    <td>{new Date(item.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{item.title}</td>
                    <td>{item.planCount}</td>
                    <td>{item.reportCount}</td>
                    <td>{item.createdBy?.displayName || item.createdBy?.email || "—"}</td>
                    {canWrite ? <td><button type="button" className="btn btnDanger" disabled={deleteArchiveM.isPending && deleteArchiveM.variables === item.id} onClick={(event) => { event.stopPropagation(); if (!confirm(`Удалить сохранённое окно «${item.title}»?`)) return; deleteArchiveM.mutate(item.id); }}>Удалить</button></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">Сохранённых окон ещё нет.</p>}
        </section>
      ) : pane === "plan" ? (
        <section className="card towsTableCard">
          <TowPlanGrid items={items} canWrite={canWrite && !openedTow} dataUpdatedAt={openedTow ? 0 : planQ.dataUpdatedAt} onDirtyChange={onPlanDirty} />
        </section>
      ) : (
        <section className="card towsTableCard">
          <TowReportTable
            items={reportItems}
            canWrite={canWrite && !openedTow}
            canGantt={canGantt}
            onOpenEvent={openEvent}
            onDirtyChange={onReportDirty}
          />
        </section>
      )}
    </div>
  );
}
