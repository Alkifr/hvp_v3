import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

import { apiGet, apiPatch, apiPost } from "../../lib/api";
import { isValidDateInput } from "../../lib/dateInput";
import { parseHashPage } from "../../lib/eventDeepLink";
import { fromInputMskOptional, MSK_OFFSET_MINUTES, startOfMskDayIso, endOfMskDayIso } from "../../lib/localDate";
import { hasPermission } from "../../lib/permissionCatalog";
import { downloadTowReportXlsx } from "../../lib/towReportExcel";
import { parseTowsViewShare, syncTowsViewHash } from "../../lib/viewShareUrl";
import { authMe } from "../auth/authApi";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { useActiveSandbox } from "../components/SandboxSwitcher";
import { TowPlanBoard, type PlanBoardRow } from "./TowPlanBoard";

dayjs.extend(utc);

export type TowReportRow = {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStatus: string;
  seq: number;
  direction: string;
  directionLabel: string;
  hangarId: string;
  hangarNumber: string;
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
  operatorId: string;
  operator: string;
  fromStand: string;
  toStand: string;
  plannedStartAt: string;
  plannedStartMsk: string;
  plannedEndAt: string;
  plannedEndMsk: string;
  occupancyEndAt: string;
  occupancyEndMsk: string;
  inferredOccupancyEndAt: string;
  standOccupancy: string;
  standOccupancyMinutes: number | null;
  notes: string;
  toSlotEndAt: string;
  toSlotEndMsk: string;
  toSlotDuration: string;
  toSlotMinutes: number | null;
  positionComment: string;
  startChangeReason: string;
  fromLabel: string;
  toLabel: string;
  placementId: string;
};

type TowListResponse = { items: TowReportRow[] };

type TowBoardHangar = { id: string; label: string };

type TowBoardRow = PlanBoardRow & {
  status: string;
  startMsk: string;
  endMsk: string;
  hangars: TowBoardHangar[];
  aircraftTypeId: string;
  aircraftId: string;
  operatorId: string;
  standLabel: string;
  towCount: number;
  pendingEdges: string[];
  existingTows: string[];
};

type TowBoardResponse = { minutes: number | null; items: TowBoardRow[] };

type FacetRow = {
  hangars: TowBoardHangar[];
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

type Draft = {
  fromStand: string;
  toStand: string;
  notes: string;
  positionComment: string;
  startChangeReason: string;
  startLocal: string;
  endLocal: string;
};

function mskNow() {
  return dayjs().utcOffset(MSK_OFFSET_MINUTES);
}

function toInputMsk(iso: string): string {
  const d = dayjs(iso).utcOffset(MSK_OFFSET_MINUTES);
  return d.isValid() ? d.format("YYYY-MM-DDTHH:mm") : "";
}

function IconSave() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M8 3v6h8V3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 17h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function occupancyDurationLabel(startLocal: string, endLocal: string): string {
  const startIso = fromInputMskOptional(startLocal);
  const endIso = fromInputMskOptional(endLocal);
  if (!startIso || !endIso) return "";
  const ms = dayjs(endIso).valueOf() - dayjs(startIso).valueOf();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

function draftFromRow(row: TowReportRow): Draft {
  return {
    fromStand: row.fromStand,
    toStand: row.toStand,
    notes: row.notes,
    positionComment: row.positionComment,
    startChangeReason: row.startChangeReason,
    startLocal: toInputMsk(row.plannedStartAt),
    endLocal: toInputMsk(row.occupancyEndAt || row.inferredOccupancyEndAt)
  };
}

function isDirty(row: TowReportRow, draft: Draft): boolean {
  return (
    draft.fromStand !== row.fromStand ||
    draft.toStand !== row.toStand ||
    draft.notes !== row.notes ||
    draft.positionComment !== row.positionComment ||
    draft.startChangeReason !== row.startChangeReason ||
    draft.startLocal !== toInputMsk(row.plannedStartAt) ||
    draft.endLocal !== toInputMsk(row.occupancyEndAt || row.inferredOccupancyEndAt)
  );
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

function towFacet(row: TowReportRow): FacetRow {
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

function boardFacet(row: TowBoardRow): FacetRow {
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

function parseEmails(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.includes("@"))
    )
  ];
}

const TOWS_UI_LS_KEY = "hangarPlanning:towsUi:v1";

function safeReadTowsUi(): any | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(TOWS_UI_LS_KEY);
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

export function RmTowsView() {
  const qc = useQueryClient();
  const { active: activeSandbox, activeId: activeSandboxId } = useActiveSandbox();
  const savedUi = useMemo(() => {
    const ls = safeReadTowsUi();
    if (typeof window === "undefined") return ls;
    const { page, query } = parseHashPage(location.hash);
    if (page !== "tows") return ls;
    const share = parseTowsViewShare(query);
    if (!share) return ls;
    return {
      ...ls,
      ...share,
      fromDate: share.fromDate || ls?.fromDate,
      toDate: share.toDate || ls?.toDate,
      tab: share.tab || ls?.tab
    };
  }, []);
  const defaultFrom = mskNow().startOf("month").format("YYYY-MM-DD");
  const defaultTo = mskNow().endOf("month").format("YYYY-MM-DD");
  const [rangeFrom, setRangeFrom] = useState(() =>
    isValidDateInput(String(savedUi?.fromDate ?? "")) ? String(savedUi.fromDate) : defaultFrom
  );
  const [rangeTo, setRangeTo] = useState(() =>
    isValidDateInput(String(savedUi?.toDate ?? "")) ? String(savedUi.toDate) : defaultTo
  );
  const [hangarIds, setHangarIds] = useState<string[]>(() => readStringArray(savedUi?.filterHangarIds));
  const [operatorIds, setOperatorIds] = useState<string[]>(() => readStringArray(savedUi?.filterOperatorIds));
  const [aircraftTypeIds, setAircraftTypeIds] = useState<string[]>(() => readStringArray(savedUi?.filterAircraftTypeIds));
  const [aircraftIds, setAircraftIds] = useState<string[]>(() => readStringArray(savedUi?.filterAircraftIds));
  const [pane, setPane] = useState<"plan" | "registry">(() => (savedUi?.tab === "registry" ? "registry" : "plan"));
  const [recipientsText, setRecipientsText] = useState(() => String(savedUi?.recipients ?? ""));
  const [sendOpen, setSendOpen] = useState(false);
  const [sendNote, setSendNote] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [exporting, setExporting] = useState(false);

  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => authMe() });
  const permissions = meQ.data && meQ.data.ok ? meQ.data.user.permissions : [];
  const canWrite = hasPermission(permissions, "tows:write") || hasPermission(permissions, "gantt:write");
  const canGantt = hasPermission(permissions, "gantt:read");

  const periodParams = () => {
    const params = new URLSearchParams();
    params.set("from", startOfMskDayIso(rangeFrom) ?? dayjs(rangeFrom).toISOString());
    params.set("to", endOfMskDayIso(rangeTo) ?? dayjs(rangeTo).endOf("day").toISOString());
    return params;
  };

  const listQ = useQuery({
    queryKey: ["tows-report", rangeFrom, rangeTo, activeSandbox?.id ?? null],
    enabled: isValidDateInput(rangeFrom) && isValidDateInput(rangeTo),
    queryFn: () => apiGet<TowListResponse>(`/api/tows?${periodParams().toString()}`)
  });

  const boardQ = useQuery({
    queryKey: ["tows-board", rangeFrom, rangeTo, activeSandbox?.id ?? null],
    enabled: isValidDateInput(rangeFrom) && isValidDateInput(rangeTo),
    queryFn: () => apiGet<TowBoardResponse>(`/api/tows/board?${periodParams().toString()}`)
  });

  const loaded = listQ.data?.items ?? [];
  const boardLoaded = boardQ.data?.items ?? [];
  const filters = useMemo<TowFilters>(
    () => ({ hangarIds, operatorIds, aircraftTypeIds, aircraftIds }),
    [hangarIds, operatorIds, aircraftTypeIds, aircraftIds]
  );
  const facetRows = useMemo(() => {
    const rows: FacetRow[] = [];
    if (boardQ.isSuccess) rows.push(...boardLoaded.map(boardFacet));
    if (listQ.isSuccess) rows.push(...loaded.map(towFacet));
    return rows;
  }, [boardQ.isSuccess, boardLoaded, listQ.isSuccess, loaded]);

  useEffect(() => {
    safeWriteTowsUi({
      fromDate: rangeFrom,
      toDate: rangeTo,
      tab: pane,
      recipients: recipientsText,
      filterHangarIds: hangarIds,
      filterOperatorIds: operatorIds,
      filterAircraftTypeIds: aircraftTypeIds,
      filterAircraftIds: aircraftIds
    });
  }, [rangeFrom, rangeTo, pane, recipientsText, hangarIds, operatorIds, aircraftTypeIds, aircraftIds]);

  useEffect(() => {
    syncTowsViewHash({
      fromDate: rangeFrom,
      toDate: rangeTo,
      tab: pane,
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
      if (row.operatorId && facetMatches(row, filters, "operatorIds")) {
        operatorMap.set(row.operatorId, row.operator || row.operatorId);
      }
      if (row.aircraftTypeId && facetMatches(row, filters, "aircraftTypeIds")) {
        typeMap.set(row.aircraftTypeId, row.aircraftType || row.aircraftTypeId);
      }
      if (row.aircraftId && facetMatches(row, filters, "aircraftIds")) {
        aircraftMap.set(row.aircraftId, row.tailNumber || row.aircraftId);
      }
    }
    const toOpts = (map: Map<string, string>) =>
      [...map.entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru"));
    return {
      hangars: toOpts(hangarMap),
      operators: toOpts(operatorMap),
      aircraftTypes: toOpts(typeMap),
      aircraft: toOpts(aircraftMap)
    };
  }, [facetRows, filters]);

  useEffect(() => {
    if (facetRows.length === 0) return;
    const prune = (selected: string[], available: Set<string>) => selected.filter((id) => available.has(id));
    const hangarAvail = new Set(smartFilterOptions.hangars.map((o) => o.id));
    const operatorAvail = new Set(smartFilterOptions.operators.map((o) => o.id));
    const typeAvail = new Set(smartFilterOptions.aircraftTypes.map((o) => o.id));
    const aircraftAvail = new Set(smartFilterOptions.aircraft.map((o) => o.id));
    const nextHangars = prune(hangarIds, hangarAvail);
    if (nextHangars.length !== hangarIds.length) setHangarIds(nextHangars);
    const nextOperators = prune(operatorIds, operatorAvail);
    if (nextOperators.length !== operatorIds.length) setOperatorIds(nextOperators);
    const nextTypes = prune(aircraftTypeIds, typeAvail);
    if (nextTypes.length !== aircraftTypeIds.length) setAircraftTypeIds(nextTypes);
    const nextAircraft = prune(aircraftIds, aircraftAvail);
    if (nextAircraft.length !== aircraftIds.length) setAircraftIds(nextAircraft);
  }, [facetRows.length, smartFilterOptions, hangarIds, operatorIds, aircraftTypeIds, aircraftIds]);

  const boardItems = useMemo(
    () => boardLoaded.filter((row) => facetMatches(boardFacet(row), filters)),
    [boardLoaded, filters]
  );

  const items = useMemo(() => {
    return loaded
      .filter((row) => facetMatches(towFacet(row), filters))
      .map((row, idx) => ({ ...row, seq: idx + 1 }));
  }, [loaded, filters]);

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of items) {
        if (!next[row.id]) next[row.id] = draftFromRow(row);
      }
      return next;
    });
  }, [items]);

  const inbound = useMemo(() => items.filter((r) => r.direction === "IN").length, [items]);
  const outbound = useMemo(() => items.filter((r) => r.direction === "OUT").length, [items]);

  const saveM = useMutation({
    mutationFn: async (row: TowReportRow) => {
      const draft = drafts[row.id] ?? draftFromRow(row);
      const startIso = fromInputMskOptional(draft.startLocal);
      const endIso = fromInputMskOptional(draft.endLocal);
      const startChanged = draft.startLocal !== toInputMsk(row.plannedStartAt);
      const inferredEndLocal = toInputMsk(row.inferredOccupancyEndAt);
      const storedEndLocal = toInputMsk(row.occupancyEndAt || row.inferredOccupancyEndAt);
      const endChanged = draft.endLocal !== storedEndLocal;
      if (startChanged && !draft.startChangeReason.trim()) {
        throw new Error("Укажите причину изменения времени начала буксировки");
      }
      const occupancyMatchesDefault = draft.endLocal === inferredEndLocal;
      return apiPatch<TowReportRow>(`/api/tows/${row.id}`, {
        fromLabel: draft.fromStand.trim() || null,
        toLabel: draft.toStand.trim() || null,
        notes: draft.notes.trim() || null,
        positionComment: draft.positionComment.trim() || null,
        startChangeReason: draft.startChangeReason.trim() || null,
        startAt: startChanged && startIso ? startIso : undefined,
        occupancyEndAt: endChanged ? (occupancyMatchesDefault ? null : endIso) : undefined,
        changeReason: draft.startChangeReason.trim() || "Буксировка"
      });
    },
    onSuccess: async (updated) => {
      setDrafts((prev) => ({ ...prev, [updated.id]: draftFromRow(updated) }));
      await qc.invalidateQueries({ queryKey: ["tows-report"] });
      await qc.invalidateQueries({ queryKey: ["tows-board"] });
    }
  });

  const sendM = useMutation({
    mutationFn: async (target: "self" | "list") => {
      const recipients = parseEmails(recipientsText);
      if (target === "list" && recipients.length === 0) throw new Error("Укажите получателей");
      return apiPost<{ ok: true; recipients: string[]; subject: string; rows: number }>("/api/tows/send", {
        from: startOfMskDayIso(rangeFrom) ?? dayjs(rangeFrom).toISOString(),
        to: endOfMskDayIso(rangeTo) ?? dayjs(rangeTo).endOf("day").toISOString(),
        hangarIds,
        operatorIds,
        aircraftTypeIds,
        aircraftIds,
        recipients: target === "list" ? recipients : undefined,
        target,
        note: sendNote.trim() || undefined
      });
    },
    onSuccess: (res) => {
      setSendMessage(`Письмо «${res.subject}» отправлено: ${res.recipients.join(", ")}. Строк: ${res.rows}.`);
    }
  });

  const dirtyCount = useMemo(
    () => items.filter((row) => isDirty(row, drafts[row.id] ?? draftFromRow(row))).length,
    [items, drafts]
  );
  const waitingEdges = useMemo(
    () => boardItems.filter((row) => !row.locked && row.pendingEdges.length > 0).length,
    [boardItems]
  );
  const selfEmail = meQ.data && meQ.data.ok ? meQ.data.user.email : "";

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const stamp = mskNow().format("YYYYMMDD-HHmm");
      await downloadTowReportXlsx(items, `buksirovki-${stamp}.xlsx`);
    } finally {
      setExporting(false);
    }
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
              ? "Неделя показывает начало и конец этапа: зелёная плашка — буксировка назначена, красная — нет. Шкала события и сутки ангара остаются рядом."
              : "Сводный реестр буксировок за период. Письмо уходит по тем же столбцам, что и Excel."}
          </p>
        </div>
        <div className="massHeroStats" aria-label="Сводка буксировок">
          {pane === "plan" ? (
            <>
              <span>
                <b>{boardItems.length}</b> бортов
              </span>
              <span>
                <b>{waitingEdges}</b> ждут края
              </span>
            </>
          ) : (
            <>
              <span>
                <b>{items.length}</b> буксировок
              </span>
              <span>
                <b>{inbound}</b> закаток
              </span>
              <span>
                <b>{outbound}</b> выкаток
              </span>
            </>
          )}
          <span>
            <b>{activeSandbox ? "Песочница" : "Рабочий контур"}</b>
          </span>
        </div>
      </section>

      <section className="card hangarFilterPanel analyticsFilterBar">
        <div className="ganttToolbar">
          <div className="ganttToolbarRow">
            <div className="ganttToolbarGroup">
              <label className="tgField">
                <span className="tgFieldLabel">с</span>
                <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} style={{ width: 150 }} />
              </label>
              <label className="tgField">
                <span className="tgFieldLabel">по</span>
                <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} style={{ width: 150 }} />
              </label>
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
              {pane === "registry" ? (
                <button className="btn" type="button" onClick={() => setSendOpen((open) => !open)} disabled={!canWrite}>
                  Отправить реестр
                </button>
              ) : null}
              {pane === "registry" ? (
              <button
                className="btn ganttIconBtn"
                type="button"
                onClick={() => void exportXlsx()}
                disabled={exporting || items.length === 0}
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
          {listQ.isFetching || boardQ.isFetching ? <div className="muted">обновление…</div> : null}
          {listQ.error ? <div className="error">{String((listQ.error as Error).message ?? listQ.error)}</div> : null}
          {boardQ.error ? <div className="error">{String((boardQ.error as Error).message ?? boardQ.error)}</div> : null}
        </div>
      </section>

      <div className="sandboxesTabs" role="tablist" aria-label="Окна РМ Буксировки">
        <button
          type="button"
          role="tab"
          aria-selected={pane === "plan"}
          className={pane === "plan" ? "sandboxesTab active" : "sandboxesTab"}
          onClick={() => setPane("plan")}
        >
          План <span className="sandboxesTabCount">{boardItems.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "registry"}
          className={pane === "registry" ? "sandboxesTab active" : "sandboxesTab"}
          onClick={() => setPane("registry")}
        >
          Реестр <span className="sandboxesTabCount">{items.length}</span>
        </button>
      </div>

      {pane === "plan" ? (
        <TowPlanBoard
          rows={boardItems}
          canWrite={canWrite}
          canGantt={canGantt}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          onOpenEvent={openEvent}
        />
      ) : (
      <section className="card towsTableCard">
        {sendOpen ? (
          <div className="towsSendPanel">
            <label className="tgField">
              <span className="tgFieldLabel">Получатели</span>
              <textarea
                className="towsMemo"
                rows={2}
                value={recipientsText}
                placeholder="адреса через запятую или с новой строки"
                onChange={(e) => {
                  setRecipientsText(e.target.value);
                  setSendMessage("");
                }}
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Комментарий к письму</span>
              <textarea className="towsMemo" rows={2} value={sendNote} onChange={(e) => setSendNote(e.target.value)} />
            </label>
            <div className="row">
              <button
                className="btn btnPrimary"
                type="button"
                disabled={!canWrite || sendM.isPending || items.length === 0}
                onClick={() => sendM.mutate("list")}
              >
                Отправить
              </button>
              <button
                className="btn"
                type="button"
                disabled={!canWrite || sendM.isPending || items.length === 0 || !selfEmail}
                onClick={() => sendM.mutate("self")}
              >
                Себе
              </button>
              <span className="muted">
                Уйдут сохранённые строки за период ({items.length}), столбцы как в Excel.
                {selfEmail ? ` Себе — ${selfEmail}.` : ""}
              </span>
            </div>
            {dirtyCount > 0 ? <div className="muted">Несохранённые правки в письмо не входят.</div> : null}
            {sendMessage ? <div className="muted">{sendMessage}</div> : null}
            {sendM.error ? <div className="error">{String((sendM.error as Error).message ?? sendM.error)}</div> : null}
          </div>
        ) : null}
        <div className="itpTableWrap towsTableWrap">
          <table className="itpTable towsTable">
            <thead>
              <tr>
                {canWrite || canGantt ? <th className="towsActionsCol" /> : null}
                <th>Строка</th>
                <th>Ангар</th>
                <th>Тип ВС</th>
                <th>Борт</th>
                <th>Оператор</th>
                <th>Откуда (с МС)</th>
                <th>Куда (на МС)</th>
                <th>Начало (мск)</th>
                <th>Конец (мск)</th>
                <th>Продолжительность занятия МС</th>
                <th>Примечание</th>
                <th>Слот ТО</th>
                <th>Позиция</th>
                <th>Причина сдвига начала</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={(canWrite || canGantt ? 1 : 0) + 14} className="muted">
                    Нет буксировок в выбранном периоде. Расставьте края на вкладке «План».
                  </td>
                </tr>
              ) : (
                items.map((row) => {
                  const draft = drafts[row.id] ?? draftFromRow(row);
                  const dirty = isDirty(row, draft);
                  const scheduleLocked = row.eventStatus === "DONE";
                  const rowCanWrite = canWrite && !scheduleLocked;
                  return (
                    <tr key={row.id}>
                      {canWrite || canGantt ? (
                        <td className="towsActionsCol">
                          <div className="ganttTableRowActions">
                            {canWrite ? (
                              <button
                                className="ganttTableIconBtn ganttTableIconBtnPrimary"
                                type="button"
                                title="Сохранить"
                                aria-label="Сохранить"
                                disabled={!rowCanWrite || !dirty || saveM.isPending}
                                onClick={() => saveM.mutate(row)}
                              >
                                <IconSave />
                              </button>
                            ) : null}
                            {canGantt ? (
                              <button
                                className="ganttTableIconBtn"
                                type="button"
                                title="К событию"
                                aria-label="К событию"
                                onClick={() => openEvent(row.eventId)}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M14 4h6v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M10 14 20 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                      <td>{row.seq}</td>
                      <td>
                        <div>{row.hangarNumber || "—"}</div>
                        {row.directionLabel ? <div className="muted">{row.directionLabel}</div> : null}
                        {scheduleLocked ? <div className="muted">Завершено — правки недоступны</div> : null}
                      </td>
                      <td>{row.aircraftType || "—"}</td>
                      <td>{row.tailNumber || "—"}</td>
                      <td>{row.operator || "—"}</td>
                      <td>
                        {rowCanWrite ? (
                          <input
                            value={draft.fromStand}
                            onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: { ...draft, fromStand: e.target.value } }))}
                          />
                        ) : (
                          row.fromStand || "—"
                        )}
                      </td>
                      <td>
                        {rowCanWrite ? (
                          <input
                            value={draft.toStand}
                            onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: { ...draft, toStand: e.target.value } }))}
                          />
                        ) : (
                          row.toStand || "—"
                        )}
                      </td>
                      <td>
                        {rowCanWrite ? (
                          <input
                            type="datetime-local"
                            value={draft.startLocal}
                            onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: { ...draft, startLocal: e.target.value } }))}
                          />
                        ) : (
                          row.plannedStartMsk
                        )}
                      </td>
                      <td>
                        {rowCanWrite ? (
                          <input
                            type="datetime-local"
                            value={draft.endLocal}
                            onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: { ...draft, endLocal: e.target.value } }))}
                          />
                        ) : (
                          row.occupancyEndMsk || "—"
                        )}
                      </td>
                      <td>{occupancyDurationLabel(draft.startLocal, draft.endLocal) || row.standOccupancy || "—"}</td>
                      <td>
                        {rowCanWrite ? (
                          <textarea
                            className="towsMemo"
                            rows={2}
                            value={draft.notes}
                            onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: { ...draft, notes: e.target.value } }))}
                          />
                        ) : (
                          row.notes || "—"
                        )}
                      </td>
                      <td>{row.toSlotEndMsk || "—"}</td>
                      <td>
                        {rowCanWrite ? (
                          <textarea
                            className="towsMemo"
                            rows={2}
                            value={draft.positionComment}
                            placeholder="комментарий"
                            onChange={(e) =>
                              setDrafts((p) => ({ ...p, [row.id]: { ...draft, positionComment: e.target.value } }))
                            }
                          />
                        ) : (
                          row.positionComment || "—"
                        )}
                      </td>
                      <td>
                        {rowCanWrite ? (
                          <textarea
                            className="towsMemo"
                            rows={2}
                            value={draft.startChangeReason}
                            placeholder="если сдвигали начало"
                            onChange={(e) =>
                              setDrafts((p) => ({ ...p, [row.id]: { ...draft, startChangeReason: e.target.value } }))
                            }
                          />
                        ) : (
                          row.startChangeReason || "—"
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {saveM.error ? <div className="error">{String((saveM.error as Error).message ?? saveM.error)}</div> : null}
      </section>
      )}
    </div>
  );
}
