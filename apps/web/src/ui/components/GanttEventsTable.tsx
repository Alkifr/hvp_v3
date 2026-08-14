import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import {
  buildGanttTableColumns,
  defaultWidths,
  extraPrimaryFieldKeys,
  factoryColumnConfig,
  formatPrimaryCell,
  isFullCatalogVisible,
  normalizeColOrder,
  PINNED_LEFT_IDS,
  resolveVisibleIds,
  safeReadTableCols,
  safeWriteTableCols,
  shouldUseFactoryHidden,
  TABLE_KEY,
  type GanttTableColConfig,
  type GanttTableColDef,
  type GanttTableColId,
  type PrimaryCatalogField
} from "../../lib/ganttTableColumns";
import { FIELD_LABEL, resolveHistoryValue, type HistoryRefMaps } from "../../lib/eventHistoryFormat";
import {
  DEFAULT_EVENT_STATUS,
  overlayStatusCatalog,
  SELECTABLE_EVENT_STATUSES,
  statusCatalogLabel,
  type EventStatusCatalogItem,
  type EventStatusCode
} from "../../lib/eventStatusCatalog";
import { SingleSelectDropdown } from "./SingleSelectDropdown";
import { useActiveSandbox } from "./SandboxSwitcher";

type TableColId = GanttTableColId;
type TableColDef = GanttTableColDef;

function formatAircraftTypeLabel(type: { icaoType?: string | null; name: string } | null | undefined): string {
  if (!type) return "—";
  return type.name || "—";
}

function formatOperatorCode(
  operator: { code?: string | null; name?: string | null } | null | undefined,
  fallbackCode?: string | null
): string {
  const code = (operator?.code ?? fallbackCode ?? "").trim();
  if (code) return code;
  const name = (operator?.name ?? "").trim();
  return name || "—";
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

function IconCancel() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconCard() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconGrip() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="7" r="1.5" />
      <circle cx="15" cy="7" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="17" r="1.5" />
      <circle cx="15" cy="17" r="1.5" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 10.5V17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="7.2" r="1.1" fill="currentColor" />
    </svg>
  );
}

type Aircraft = {
  id: string;
  tailNumber: string;
  operatorId: string;
  typeId: string;
  operator?: { id: string; code?: string | null; name: string } | null;
  type?: { id: string; icaoType?: string | null; name: string } | null;
};

type AircraftTypeRef = { id: string; icaoType?: string | null; name: string };
type EventType = { id: string; code: string; name: string; color?: string | null };
type Workshop = { id: string; code?: string; name: string; isActive?: boolean };
type Hangar = { id: string; name: string };
type Layout = {
  id: string;
  name: string;
  hangarId: string;
  code?: string;
  capacitySummary?: string;
  standsSummary?: string;
  isCompatible?: boolean;
};
type Stand = {
  id: string;
  layoutId: string;
  code: string;
  name: string;
  isActive?: boolean;
  isCompatible?: boolean;
};

type EventPlacementRow = {
  id: string;
  hangarId?: string | null;
  layoutId?: string | null;
  standId?: string | null;
  hangar?: { id?: string; name: string } | null;
  layout?: { id?: string; name: string; hangarId?: string } | null;
  stand?: { id?: string; code: string; name?: string } | null;
};

export type GanttTableEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  budgetStartAt?: string | null;
  budgetEndAt?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  level: "STRATEGIC" | "OPERATIONAL";
  status: string;
  planningKind?: "PLANNED" | "UNPLANNED" | string;
  notes?: string | null;
  aircraft?: {
    id?: string;
    tailNumber: string;
    operatorId?: string | null;
    typeId?: string | null;
    operator?: { id: string; code?: string | null; name: string } | null;
    type?: { id: string; icaoType?: string | null; name: string } | null;
  } | null;
  virtualAircraft?: { operatorId?: string; aircraftTypeId?: string; label?: string } | null;
  eventType: { id?: string; name: string; color?: string | null };
  hangar?: { id?: string; name: string } | null;
  workshop?: { id?: string; code?: string | null; name: string } | null;
  layout?: { id?: string; name: string; hangarId?: string } | null;
  reservation?: { stand?: { id?: string; code: string } | null } | null;
  placements?: EventPlacementRow[];
};

type RowDraft = {
  id: string;
  title: string;
  level: "STRATEGIC" | "OPERATIONAL";
  status: EventStatusCode;
  planningKind: "PLANNED" | "UNPLANNED";
  aircraftId: string;
  eventTypeId: string;
  startAtLocal: string;
  endAtLocal: string;
  budgetStartAtLocal: string;
  budgetEndAtLocal: string;
  actualStartAtLocal: string;
  actualEndAtLocal: string;
  notes: string;
  hangarId: string;
  workshopId: string;
  layoutId: string;
  standId: string;
  allowOverlap: boolean;
  multiPlacement: boolean;
  hasVirtualAircraft: boolean;
};

const STATUS_OPTIONS: Array<RowDraft["status"]> = [...SELECTABLE_EVENT_STATUSES];

function toInputLocal(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = dayjs(v);
  return d.isValid() ? d.format("YYYY-MM-DDTHH:mm") : "";
}

function fromInputLocalOptional(v: string): string | null {
  if (!v) return null;
  const d = dayjs(v).second(0).millisecond(0);
  return d.isValid() ? d.toISOString() : null;
}

function eventPlanningKind(ev: GanttTableEvent): "PLANNED" | "UNPLANNED" {
  if (ev.planningKind === "PLANNED" || ev.planningKind === "UNPLANNED") return ev.planningKind;
  return ev.budgetStartAt && ev.budgetEndAt ? "PLANNED" : "UNPLANNED";
}

function durationDaysLabel(startLocal: string, endLocal: string): string {
  if (!startLocal || !endLocal) return "—";
  const s = dayjs(startLocal);
  const e = dayjs(endLocal);
  if (!s.isValid() || !e.isValid() || e.valueOf() < s.valueOf()) return "—";
  return (e.diff(s, "minute") / 60 / 24).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function durationHoursLabel(startLocal: string, endLocal: string): string {
  if (!startLocal || !endLocal) return "—";
  const s = dayjs(startLocal);
  const e = dayjs(endLocal);
  if (!s.isValid() || !e.isValid() || e.valueOf() < s.valueOf()) return "—";
  return (Math.max(0, e.diff(s, "minute")) / 60).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function timeOfLocal(local: string): string {
  if (!local) return "—";
  const d = dayjs(local);
  return d.isValid() ? d.format("HH:mm") : "—";
}

type SavedTableView = {
  id: string;
  tableKey: string;
  name: string;
  isActive: boolean;
  config: GanttTableColConfig;
};

function draftFromEvent(ev: GanttTableEvent): RowDraft {
  const placements = ev.placements ?? [];
  return {
    id: ev.id,
    title: ev.title,
    level: ev.level,
    status: ((STATUS_OPTIONS as string[]).includes(ev.status) ? ev.status : DEFAULT_EVENT_STATUS) as RowDraft["status"],
    planningKind: eventPlanningKind(ev),
    aircraftId: ev.aircraft?.id ?? "",
    eventTypeId: ev.eventType?.id ?? "",
    startAtLocal: toInputLocal(ev.startAt),
    endAtLocal: toInputLocal(ev.endAt),
    budgetStartAtLocal: toInputLocal(ev.budgetStartAt),
    budgetEndAtLocal: toInputLocal(ev.budgetEndAt),
    actualStartAtLocal: toInputLocal(ev.actualStartAt),
    actualEndAtLocal: toInputLocal(ev.actualEndAt),
    notes: ev.notes ?? "",
    hangarId: ev.hangar?.id ?? "",
    workshopId: ev.workshop?.id ?? "",
    layoutId: ev.layout?.id ?? "",
    standId: ev.reservation?.stand?.id ?? "",
    allowOverlap: false,
    multiPlacement: placements.length > 1,
    hasVirtualAircraft: !ev.aircraft?.id && !!ev.virtualAircraft
  };
}

function computeDiff(a: RowDraft, b: RowDraft) {
  const keys: Array<keyof RowDraft> = [
    "title",
    "level",
    "status",
    "planningKind",
    "aircraftId",
    "eventTypeId",
    "workshopId",
    "startAtLocal",
    "endAtLocal",
    "budgetStartAtLocal",
    "budgetEndAtLocal",
    "actualStartAtLocal",
    "actualEndAtLocal",
    "notes",
    "hangarId",
    "layoutId",
    "standId",
    "allowOverlap"
  ];
  return keys
    .filter((k) => String(a[k] ?? "") !== String(b[k] ?? ""))
    .map((k) => ({ field: String(k), from: a[k] ?? "", to: b[k] ?? "" }));
}

function ConfirmDrawer(props: {
  open: boolean;
  changeReason: string;
  onChangeReason: (v: string) => void;
  diffs: Array<{ field: string; from: unknown; to: unknown }>;
  refMaps: HistoryRefMaps;
  error?: string | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!props.open) return null;
  return (
    <div className="drawerBackdrop">
      <div className="drawer drawerV2" role="dialog" aria-modal="true" aria-label="Подтверждение изменения">
        <header className="drawerHeader">
          <div className="drawerHeaderText">
            <div className="drawerTitle">Подтверждение изменения</div>
            <div className="drawerSubtitle">Укажите причину — она попадёт в историю события.</div>
          </div>
          <button
            className="drawerCloseBtn"
            type="button"
            onClick={props.onClose}
            aria-label="Закрыть"
            title="Закрыть"
            disabled={props.pending}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
            <span className="drawerCloseBtnLabel">Закрыть</span>
          </button>
        </header>
        <div className="drawerBody">
          <div className="evConfirm">
            <label className="evField">
              <span className="evFieldLabel">Причина изменения</span>
              <textarea
                className="evInput evTextarea"
                rows={3}
                value={props.changeReason}
                onChange={(e) => props.onChangeReason(e.target.value)}
                placeholder="Например: перенос по запросу оператора, уточнение сроков…"
                autoFocus
              />
            </label>
            {props.diffs.length > 0 ? (
              <div className="evDiff">
                <div className="evDiffTitle">Изменения</div>
                <div className="evDiffList">
                  {props.diffs.map((d) => (
                    <div key={d.field} className="evDiffItem">
                      <span className="evDiffField">{FIELD_LABEL[d.field] ?? d.field}</span>
                      <span className="evDiffValues">
                        <span className="evDiffFrom">{resolveHistoryValue(d.field, d.from, props.refMaps)}</span>
                        <span className="evDiffArrow" aria-hidden="true">
                          →
                        </span>
                        <span className="evDiffTo">{resolveHistoryValue(d.field, d.to, props.refMaps)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <footer className="evFooter">
              <div className="evFooterInfo">
                {props.error ? (
                  <span className="error">{props.error}</span>
                ) : props.pending ? (
                  <span className="muted">Сохраняем…</span>
                ) : (
                  <span className="muted">Причина обязательна.</span>
                )}
              </div>
              <div className="evFooterActions">
                <button className="btn" type="button" onClick={props.onClose} disabled={props.pending}>
                  Отмена
                </button>
                <button
                  className="btn btnPrimary"
                  type="button"
                  onClick={props.onConfirm}
                  disabled={props.pending || !props.changeReason.trim()}
                >
                  Подтвердить и сохранить
                </button>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

const SELECT_COL_ID = "__select";
const SELECT_COL_WIDTH = 40;

export function GanttEventsTable(props: {
  events: GanttTableEvent[];
  canEdit: boolean;
  /** На мобиле отключаем DnD порядка столбцов */
  allowColumnReorder?: boolean;
  eventsQueryFromISO: string;
  eventsQueryToISO: string;
  aircraft: Aircraft[];
  eventTypes: EventType[];
  workshops: Workshop[];
  hangars: Hangar[];
  aircraftTypes: AircraftTypeRef[];
  operators: Array<{ id: string; code?: string | null; name: string }>;
  onOpenEvent: (eventId: string) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
}) {
  const allowColumnReorder = props.allowColumnReorder !== false;
  const colPickerOpen = props.settingsOpen;
  const setColPickerOpen = props.onSettingsOpenChange;
  const qc = useQueryClient();
  const { active: activeSandbox } = useActiveSandbox();
  const savedCols = useMemo(() => safeReadTableCols(), []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [original, setOriginal] = useState<RowDraft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [colMenuQuery, setColMenuQuery] = useState("");
  const [saveAsName, setSaveAsName] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [factorySelected, setFactorySelected] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const appliedServerView = useRef(false);
  const infoRef = useRef<HTMLDivElement | null>(null);

  const catalogQ = useQuery({
    queryKey: ["analytics", "primary-table", "meta"],
    queryFn: () =>
      apiGet<{ ok: true; fields: PrimaryCatalogField[] }>("/api/analytics/primary-table/meta")
  });
  const eventStatusesQ = useQuery({
    queryKey: ["ref", "event-statuses"],
    queryFn: () => apiGet<EventStatusCatalogItem[]>("/api/ref/event-statuses"),
    staleTime: 60_000
  });
  const statusCatalog = useMemo(() => overlayStatusCatalog(eventStatusesQ.data), [eventStatusesQ.data]);
  const statusSelectOptions = useMemo(() => {
    const selectable = statusCatalog.filter((s) => s.selectable);
    const current = draft?.status;
    if (current && !selectable.some((s) => s.code === current)) {
      const extra = statusCatalog.find((s) => s.code === current);
      if (extra) return [...selectable, extra];
    }
    return selectable;
  }, [statusCatalog, draft?.status]);
  const viewsQ = useQuery({
    queryKey: ["table-views", TABLE_KEY],
    queryFn: () => apiGet<{ ok: true; views: SavedTableView[] }>(`/api/table-views?tableKey=${TABLE_KEY}`)
  });

  const tableColumns = useMemo(() => buildGanttTableColumns(catalogQ.data?.fields), [catalogQ.data?.fields]);
  const colById = useMemo(() => new Map(tableColumns.map((c) => [c.id, c])), [tableColumns]);

  const [colWidths, setColWidths] = useState<Record<TableColId, number>>(() => {
    const columns = buildGanttTableColumns(null);
    const next = defaultWidths(columns);
    for (const col of columns) {
      const w = Number(savedCols?.widths?.[col.id]);
      if (Number.isFinite(w)) next[col.id] = Math.max(col.minWidth, Math.round(w));
    }
    return next;
  });
  const [visibleIds, setVisibleIds] = useState<Set<TableColId>>(
    () => new Set(resolveVisibleIds(savedCols, buildGanttTableColumns(null)))
  );
  const [colOrder, setColOrder] = useState<TableColId[]>(() =>
    normalizeColOrder(savedCols?.order, buildGanttTableColumns(null))
  );
  const [dragColId, setDragColId] = useState<TableColId | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const columnsReady = useRef(true);

  const applyConfig = useCallback(
    (
      config: GanttTableColConfig | null | undefined,
      columns: GanttTableColDef[],
      opts?: { allowShowAll?: boolean }
    ) => {
      const factory = factoryColumnConfig(columns);
      if (!config) {
        setColWidths(factory.widths);
        setVisibleIds(new Set(factory.visible));
        setColOrder(normalizeColOrder(factory.order, columns));
        return;
      }
      const nextWidths = { ...factory.widths };
      for (const col of columns) {
        const w = Number(config.widths?.[col.id]);
        if (Number.isFinite(w)) nextWidths[col.id] = Math.max(col.minWidth, Math.round(w));
      }
      setColWidths(nextWidths);
      setVisibleIds(new Set(resolveVisibleIds(config, columns, opts)));
      setColOrder(normalizeColOrder(config.order?.length ? config.order : factory.order, columns));
    },
    []
  );

  useEffect(() => {
    if (!tableColumns.length) return;
    setColWidths((prev) => ({ ...defaultWidths(tableColumns), ...prev }));
    setVisibleIds((prev) => new Set(resolveVisibleIds({ visible: Array.from(prev), hidden: [], order: [], widths: {} }, tableColumns)));
    setColOrder((prev) => normalizeColOrder(prev, tableColumns));
  }, [tableColumns]);

  useEffect(() => {
    if (appliedServerView.current || factorySelected || !viewsQ.data || !tableColumns.length) return;
    if (!catalogQ.data && !catalogQ.isError) return;
    appliedServerView.current = true;
    const active = viewsQ.data.views.find((v) => v.isActive);
    if (!active?.config) return;
    const cfg = active.config;
    const looksUnrestricted =
      isFullCatalogVisible(cfg.visible, tableColumns.length) ||
      ((!cfg.visible || cfg.visible.length === 0) && shouldUseFactoryHidden(cfg.hidden, tableColumns.length));
    if (looksUnrestricted) {
      setFactorySelected(true);
      setActiveViewId(null);
      applyConfig(null, tableColumns);
      return;
    }
    setActiveViewId(active.id);
    applyConfig(cfg, tableColumns, { allowShowAll: true });
  }, [viewsQ.data, catalogQ.data, catalogQ.isError, tableColumns, applyConfig, factorySelected]);

  const orderedColumns = useMemo(
    () => colOrder.map((id) => colById.get(id)).filter((c): c is TableColDef => Boolean(c)),
    [colOrder, colById]
  );

  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => c.hideable === false || visibleIds.has(c.id)),
    [orderedColumns, visibleIds]
  );
  const selectionEnabled = Boolean(props.canEdit && props.onSelectedIdsChange);
  const selectedIdSet = useMemo(() => new Set(props.selectedIds ?? []), [props.selectedIds]);
  const displayColumns = useMemo<TableColDef[]>(() => {
    if (!selectionEnabled) return visibleColumns;
    return [
      {
        id: SELECT_COL_ID,
        label: "",
        group: null,
        subgroup: null,
        defaultWidth: SELECT_COL_WIDTH,
        minWidth: SELECT_COL_WIDTH,
        sticky: "left",
        hideable: false,
        kind: "actions"
      },
      ...visibleColumns
    ];
  }, [selectionEnabled, visibleColumns]);

  const extraPrimaryKeys = useMemo(
    () => extraPrimaryFieldKeys(visibleColumns.map((c) => c.id)),
    [visibleColumns]
  );
  const eventIds = useMemo(() => props.events.map((e) => e.id), [props.events]);

  const primaryQ = useQuery({
    queryKey: [
      "analytics",
      "primary-table",
      "gantt-rows",
      props.eventsQueryFromISO,
      props.eventsQueryToISO,
      extraPrimaryKeys,
      eventIds
    ],
    enabled: extraPrimaryKeys.length > 0 && eventIds.length > 0,
    queryFn: () =>
      apiPost<{ ok: true; rows: Array<Record<string, unknown>> }>("/api/analytics/primary-table/query", {
        from: props.eventsQueryFromISO,
        to: props.eventsQueryToISO,
        fields: extraPrimaryKeys,
        eventIds,
        limit: Math.min(2000, Math.max(eventIds.length, 1))
      })
  });

  const primaryByEventId = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const row of primaryQ.data?.rows ?? []) {
      const id = typeof row.eventId === "string" ? row.eventId : null;
      if (id) map.set(id, row);
    }
    return map;
  }, [primaryQ.data?.rows]);

  const stickyLeftById = useMemo(() => {
    const map = new Map<TableColId, number>();
    let left = 0;
    for (const col of displayColumns) {
      if (col.sticky !== "left") continue;
      map.set(col.id, left);
      left += col.id === SELECT_COL_ID ? SELECT_COL_WIDTH : (colWidths[col.id] ?? col.defaultWidth);
    }
    return map;
  }, [displayColumns, colWidths]);

  const lastStickyLeftId = useMemo(() => {
    let last: TableColId | null = null;
    for (const col of displayColumns) {
      if (col.sticky === "left") last = col.id;
    }
    return last;
  }, [displayColumns]);

  const currentConfig = useMemo<GanttTableColConfig>(() => {
    const pinned = tableColumns.filter((c) => c.hideable === false).map((c) => c.id);
    const visible = Array.from(new Set([...pinned, ...visibleIds]));
    return {
      widths: colWidths,
      visible,
      hidden: tableColumns.filter((c) => c.hideable !== false && !visibleIds.has(c.id)).map((c) => c.id),
      order: colOrder
    };
  }, [colWidths, visibleIds, colOrder, tableColumns]);

  useEffect(() => {
    if (!columnsReady.current) return;
    safeWriteTableCols(currentConfig);
  }, [currentConfig]);

  // Горизонтальный скролл всегда у нижнего края экрана: высота wrap = оставшееся место до низа viewport.
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    const syncHeight = () => {
      const top = el.getBoundingClientRect().top;
      const bottomGap = 12;
      el.style.height = `${Math.max(240, Math.floor(window.innerHeight - top - bottomGap))}px`;
    };
    syncHeight();
    const raf = window.requestAnimationFrame(syncHeight);
    window.addEventListener("resize", syncHeight);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncHeight) : null;
    if (el.parentElement) ro?.observe(el.parentElement);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", syncHeight);
      ro?.disconnect();
    };
  }, [localError, confirmOpen]);

  useEffect(() => {
    if (!infoOpen && !colPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setInfoOpen(false);
      setColPickerOpen(false);
    };
    const onDoc = (e: MouseEvent) => {
      if (!infoOpen) return;
      if (infoRef.current && e.target instanceof Node && !infoRef.current.contains(e.target)) {
        setInfoOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [infoOpen, colPickerOpen, setColPickerOpen]);

  const startColResize = useCallback((col: TableColDef, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[col.id];
    const onMove = (ev: PointerEvent) => {
      setColWidths((prev) => ({
        ...prev,
        [col.id]: Math.max(col.minWidth, Math.round(startW + ev.clientX - startX))
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [colWidths]);

  const toggleColVisible = useCallback((id: TableColId) => {
    const def = colById.get(id);
    if (!def || def.hideable === false) return;
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [colById]);

  const moveColumn = useCallback((fromId: TableColId, toId: TableColId) => {
    if (fromId === toId || PINNED_LEFT_IDS.includes(fromId) || PINNED_LEFT_IDS.includes(toId)) return;
    setColOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(fromId);
      const to = next.indexOf(toId);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, fromId);
      return normalizeColOrder(next, tableColumns);
    });
  }, [tableColumns]);

  const colStyle = useCallback(
    (id: TableColId): CSSProperties => {
      const col = colById.get(id);
      const w = id === SELECT_COL_ID ? SELECT_COL_WIDTH : (colWidths[id] ?? col?.defaultWidth ?? 120);
      const left = stickyLeftById.get(id);
      return {
        width: w,
        minWidth: w,
        maxWidth: w,
        ...(left != null ? { left } : {})
      };
    },
    [colWidths, stickyLeftById, colById]
  );

  const layoutsQ = useQuery({
    queryKey: ["ref", "layouts", "gantt-table"],
    queryFn: () => apiGet<Layout[]>("/api/ref/layouts?activeOnly=1")
  });
  const standsQ = useQuery({
    queryKey: ["ref", "stands", "gantt-table"],
    queryFn: () => apiGet<Stand[]>("/api/ref/stands?activeOnly=1")
  });

  const historyRefMaps = useMemo<HistoryRefMaps>(() => {
    const hangars = new Map(props.hangars.map((h) => [h.id, h.name] as const));
    const layouts = new Map<string, string>();
    for (const l of layoutsQ.data ?? []) {
      const hangarName = hangars.get(l.hangarId);
      layouts.set(l.id, hangarName ? `${hangarName} / ${l.name}` : l.name);
    }
    const stands = new Map<string, string>();
    for (const s of standsQ.data ?? []) {
      stands.set(s.id, s.code?.trim() ? s.code : s.name);
    }
    return {
      hangars,
      layouts,
      stands,
      aircraft: new Map(props.aircraft.map((a) => [a.id, a.tailNumber] as const)),
      aircraftTypes: new Map(
        props.aircraftTypes.map((t) => [t.id, t.icaoType ? `${t.icaoType} · ${t.name}` : t.name] as const)
      ),
      eventTypes: new Map(props.eventTypes.map((t) => [t.id, t.name] as const)),
      workshops: new Map(props.workshops.map((w) => [w.id, w.name] as const))
    };
  }, [
    props.hangars,
    props.aircraft,
    props.aircraftTypes,
    props.eventTypes,
    props.workshops,
    layoutsQ.data,
    standsQ.data
  ]);

  const layoutsByHangar = useMemo(() => {
    const m = new Map<string, Layout[]>();
    for (const l of layoutsQ.data ?? []) {
      const arr = m.get(l.hangarId) ?? [];
      arr.push(l);
      m.set(l.hangarId, arr);
    }
    return m;
  }, [layoutsQ.data]);

  const standsByLayout = useMemo(() => {
    const m = new Map<string, Stand[]>();
    for (const s of standsQ.data ?? []) {
      if (s.isActive === false) continue;
      const arr = m.get(s.layoutId) ?? [];
      arr.push(s);
      m.set(s.layoutId, arr);
    }
    return m;
  }, [standsQ.data]);

  const aircraftOptions = useMemo(
    () => props.aircraft.map((a) => ({ id: a.id, label: a.tailNumber })),
    [props.aircraft]
  );

  const operatorCodeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of props.operators) {
      const code = formatOperatorCode(o);
      if (code !== "—") m.set(o.id, code);
    }
    for (const a of props.aircraft) {
      if (a.operator?.id && !m.has(a.operator.id)) {
        const code = formatOperatorCode(a.operator);
        if (code !== "—") m.set(a.operator.id, code);
      }
    }
    return m;
  }, [props.operators, props.aircraft]);

  const aircraftTypeById = useMemo(() => {
    const m = new Map<string, AircraftTypeRef>();
    for (const t of props.aircraftTypes) m.set(t.id, t);
    return m;
  }, [props.aircraftTypes]);

  const sortedEvents = useMemo(
    () =>
      [...props.events].sort(
        (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.title.localeCompare(b.title, "ru")
      ),
    [props.events]
  );
  const visibleEventIds = useMemo(() => sortedEvents.map((ev) => ev.id), [sortedEvents]);
  const selectedVisibleCount = useMemo(
    () => visibleEventIds.reduce((n, id) => n + (selectedIdSet.has(id) ? 1 : 0), 0),
    [visibleEventIds, selectedIdSet]
  );
  const allVisibleSelected = visibleEventIds.length > 0 && selectedVisibleCount === visibleEventIds.length;

  const toggleSelected = (eventId: string, selected: boolean) => {
    if (!props.onSelectedIdsChange) return;
    const next = new Set(selectedIdSet);
    if (selected) next.add(eventId);
    else next.delete(eventId);
    props.onSelectedIdsChange([...next]);
  };

  const toggleAllVisible = (selected: boolean) => {
    if (!props.onSelectedIdsChange) return;
    props.onSelectedIdsChange(selected ? visibleEventIds : []);
  };

  const renderSelectCell = (ev: GanttTableEvent) => (
    <input
      type="checkbox"
      className="ganttTableSelectBox"
      checked={selectedIdSet.has(ev.id)}
      onChange={(e) => toggleSelected(ev.id, e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      aria-label="Выбрать событие"
    />
  );

  // если событие исчезло из выборки — сбрасываем черновик
  useEffect(() => {
    if (!editingId) return;
    if (!props.events.some((e) => e.id === editingId)) {
      setEditingId(null);
      setDraft(null);
      setOriginal(null);
      setConfirmOpen(false);
      setChangeReason("");
      setLocalError(null);
    }
  }, [editingId, props.events]);

  const diffs = draft && original ? computeDiff(original, draft) : [];
  const isDirty = diffs.length > 0;

  const beginEdit = (ev: GanttTableEvent) => {
    if (!props.canEdit) {
      props.onOpenEvent(ev.id);
      return;
    }
    if (editingId && editingId !== ev.id && isDirty) {
      if (!confirm("Есть несохранённые изменения в другой строке. Отменить их и перейти?")) return;
    }
    const d = draftFromEvent(ev);
    setEditingId(ev.id);
    setDraft(d);
    setOriginal(d);
    setLocalError(null);
    setChangeReason("");
    setConfirmOpen(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
    setOriginal(null);
    setLocalError(null);
    setChangeReason("");
    setConfirmOpen(false);
  };

  const patchDraft = (patch: Partial<RowDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setLocalError(null);
  };

  const requestSave = () => {
    if (!draft || !original) return;
    if (computeDiff(original, draft).length === 0) return;
    try {
      validateDraft(draft);
      setLocalError(null);
      if (activeSandbox) {
        saveM.mutate();
        return;
      }
      setConfirmOpen(true);
    } catch (e: any) {
      setLocalError(String(e?.message ?? e));
    }
  };

  const saveM = useMutation({
    mutationFn: async () => {
      if (!draft || !original) throw new Error("Нет черновика");
      validateDraft(draft);
      const reason = changeReason.trim();
      if (!activeSandbox && !reason) throw new Error("Укажите причину изменения");

      const startAt = dayjs(draft.startAtLocal).second(0).millisecond(0).toISOString();
      const endAt = dayjs(draft.endAtLocal).second(0).millisecond(0).toISOString();
      const budgetStartAt = fromInputLocalOptional(draft.budgetStartAtLocal);
      const budgetEndAt = fromInputLocalOptional(draft.budgetEndAtLocal);
      const actualStartAt = fromInputLocalOptional(draft.actualStartAtLocal);
      const actualEndAt = fromInputLocalOptional(draft.actualEndAtLocal);
      const normalizedBudgetStartAt = draft.planningKind === "UNPLANNED" ? null : budgetStartAt ?? startAt;
      const normalizedBudgetEndAt = draft.planningKind === "UNPLANNED" ? null : budgetEndAt ?? endAt;

      const source = props.events.find((e) => e.id === draft.id);
      const placementsPayload = draft.multiPlacement
        ? undefined
        : [
            {
              startAt,
              endAt,
              budgetStartAt: normalizedBudgetStartAt,
              budgetEndAt: normalizedBudgetEndAt,
              actualStartAt,
              actualEndAt,
              hangarId: draft.hangarId || null,
              layoutId: draft.layoutId || null,
              standId: draft.standId || null,
              sortOrder: 0
            }
          ];

      const payload: Record<string, unknown> = {
        level: draft.level,
        status: draft.status,
        planningKind: draft.planningKind,
        title: draft.title,
        eventTypeId: draft.eventTypeId,
        startAt,
        endAt,
        budgetStartAt: normalizedBudgetStartAt,
        budgetEndAt: normalizedBudgetEndAt,
        actualStartAt,
        actualEndAt,
        notes: draft.notes.trim() ? draft.notes : null,
        allowOverlap: draft.allowOverlap,
        ...(reason ? { changeReason: reason } : {})
      };

      if (draft.aircraftId) payload.aircraftId = draft.aircraftId;
      else if (source?.virtualAircraft) payload.virtualAircraft = source.virtualAircraft;

      if (!draft.multiPlacement) {
        payload.hangarId = draft.hangarId || null;
        payload.layoutId = draft.layoutId || null;
        payload.placements = placementsPayload;
      }
      payload.workshopId = draft.workshopId || null;

      await apiPatch(`/api/events/${draft.id}`, payload);

      const standChanged = original.standId !== draft.standId;
      const locationEditable = !draft.multiPlacement;
      if (locationEditable && standChanged) {
        if (draft.standId) {
          if (!draft.layoutId) throw new Error("Выберите вариант размещения перед назначением места");
          await apiPut(`/api/reservations/by-event/${draft.id}`, {
            layoutId: draft.layoutId,
            standId: draft.standId,
            allowOverlap: draft.allowOverlap,
            ...(reason ? { changeReason: reason } : {})
          });
        } else if (original.standId) {
          await apiDelete(`/api/reservations/by-event/${draft.id}`);
        }
      }
    },
    onSuccess: () => {
      setConfirmOpen(false);
      setChangeReason("");
      setLocalError(null);
      if (draft) {
        setOriginal(draft);
      }
      setEditingId(null);
      setDraft(null);
      setOriginal(null);
      void qc.invalidateQueries({ queryKey: ["events", props.eventsQueryFromISO, props.eventsQueryToISO] });
      void qc.invalidateQueries({ queryKey: ["analytics", "primary-table", "gantt-rows"] });
    },
    onError: (e: any) => {
      setLocalError(String(e?.message ?? e));
    }
  });

  const views = viewsQ.data?.views ?? [];
  const activeView = factorySelected
    ? null
    : (activeViewId ? views.find((v) => v.id === activeViewId) : null) ??
      (appliedServerView.current ? views.find((v) => v.isActive) ?? null : null);

  const saveViewM = useMutation({
    mutationFn: async () => {
      if (!activeView) throw new Error("NO_ACTIVE_VIEW");
      return apiPatch<{ ok: true; view: SavedTableView }>(`/api/table-views/${activeView.id}`, {
        config: currentConfig
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["table-views", TABLE_KEY] });
    },
    onError: (e: any) => setLocalError(String(e?.message ?? e))
  });

  const saveViewAsM = useMutation({
    mutationFn: async (name: string) => {
      return apiPost<{ ok: true; view: SavedTableView }>("/api/table-views", {
        tableKey: TABLE_KEY,
        name,
        config: currentConfig,
        isActive: true
      });
    },
    onSuccess: async (res) => {
      appliedServerView.current = true;
      setFactorySelected(false);
      setActiveViewId(res.view.id);
      setSaveAsName("");
      await qc.invalidateQueries({ queryKey: ["table-views", TABLE_KEY] });
    },
    onError: (e: any) => setLocalError(String(e?.message ?? e))
  });

  const activateViewM = useMutation({
    mutationFn: async (view: SavedTableView) => {
      await apiPatch(`/api/table-views/${view.id}`, { isActive: true });
      return view;
    },
    onSuccess: async (view) => {
      appliedServerView.current = true;
      setFactorySelected(false);
      setActiveViewId(view.id);
      applyConfig(view.config, tableColumns, { allowShowAll: true });
      await qc.invalidateQueries({ queryKey: ["table-views", TABLE_KEY] });
    },
    onError: (e: any) => setLocalError(String(e?.message ?? e))
  });

  const deleteViewM = useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/table-views/${id}`);
      return id;
    },
    onSuccess: async () => {
      setActiveViewId(null);
      setFactorySelected(true);
      applyConfig(null, tableColumns);
      await qc.invalidateQueries({ queryKey: ["table-views", TABLE_KEY] });
    },
    onError: (e: any) => setLocalError(String(e?.message ?? e))
  });

  const deactivateViewM = useMutation({
    mutationFn: async (id: string) => {
      await apiPatch(`/api/table-views/${id}`, { isActive: false });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["table-views", TABLE_KEY] });
    },
    onError: (e: any) => setLocalError(String(e?.message ?? e))
  });

  const selectFactoryDefault = () => {
    const currentId = activeView?.id;
    setFactorySelected(true);
    setActiveViewId(null);
    applyConfig(null, tableColumns);
    if (currentId) deactivateViewM.mutate(currentId);
  };

  const promptSaveAs = () => {
    const fallback = activeView ? `${activeView.name} (копия)` : "Мой набор";
    const name = (saveAsName.trim() || window.prompt("Название набора столбцов", fallback) || "").trim();
    if (!name) return;
    saveViewAsM.mutate(name);
  };

  const onSaveView = () => {
    if (!activeView) {
      promptSaveAs();
      return;
    }
    saveViewM.mutate();
  };

  const onDeleteView = () => {
    if (!activeView) return;
    if (!window.confirm(`Удалить набор «${activeView.name}»?`)) return;
    deleteViewM.mutate(activeView.id);
  };

  const resolveAircraftMeta = (ev: GanttTableEvent, d?: RowDraft | null) => {
    // Как в карточке: при выбранном борте в черновике — предпросмотр оператора/типа до сохранения.
    if (d) {
      if (d.aircraftId) {
        const selected = props.aircraft.find((a) => a.id === d.aircraftId) ?? null;
        const operator =
          formatOperatorCode(selected?.operator) !== "—"
            ? formatOperatorCode(selected?.operator)
            : selected?.operatorId
              ? operatorCodeById.get(selected.operatorId) ?? "—"
              : "—";
        const typeRef =
          selected?.type ?? (selected?.typeId ? aircraftTypeById.get(selected.typeId) ?? null : null);
        return { operator, aircraftType: formatAircraftTypeLabel(typeRef) };
      }
      if (d.hasVirtualAircraft) {
        const opId = ev.virtualAircraft?.operatorId ?? "";
        const typeId = String(ev.virtualAircraft?.aircraftTypeId ?? "");
        return {
          operator: (opId ? operatorCodeById.get(opId) : undefined) ?? "—",
          aircraftType: formatAircraftTypeLabel(typeId ? aircraftTypeById.get(typeId) : null)
        };
      }
      return { operator: "—", aircraftType: "—" };
    }
    if (ev.virtualAircraft && !ev.aircraft?.id) {
      const opId = ev.virtualAircraft.operatorId ?? "";
      const typeId = String(ev.virtualAircraft.aircraftTypeId ?? "");
      return {
        operator: (opId ? operatorCodeById.get(opId) : undefined) ?? "—",
        aircraftType: formatAircraftTypeLabel(typeId ? aircraftTypeById.get(typeId) : null)
      };
    }
    const opId = ev.aircraft?.operatorId ?? ev.aircraft?.operator?.id ?? "";
    const typeId = String(ev.aircraft?.typeId ?? ev.aircraft?.type?.id ?? "");
    const operator =
      formatOperatorCode(ev.aircraft?.operator) !== "—"
        ? formatOperatorCode(ev.aircraft?.operator)
        : opId
          ? operatorCodeById.get(opId) ?? "—"
          : "—";
    const typeRef = ev.aircraft?.type ?? (typeId ? aircraftTypeById.get(typeId) ?? null : null);
    return { operator, aircraftType: formatAircraftTypeLabel(typeRef) };
  };

  const cellClass = (col: TableColDef) => {
    const parts: string[] = [];
    if (col.sticky === "left") parts.push("ganttTableStickyCol");
    if (col.id === "actions") parts.push("ganttTableActionsCol");
    if (col.id === SELECT_COL_ID) parts.push("ganttTableSelectCol");
    if (col.id === lastStickyLeftId) parts.push("ganttTableStickyColEdge");
    return parts.length ? parts.join(" ") : undefined;
  };

  const renderReadonlyCell = (col: TableColDef, ev: GanttTableEvent, meta: { operator: string; aircraftType: string }) => {
    switch (col.kind) {
      case "title":
        return (
          <span className="ganttTableCellText" title={ev.title}>
            <strong>{ev.title}</strong>
          </span>
        );
      case "level":
        return ev.level === "STRATEGIC" ? "Стратегический" : "Оперативный";
      case "status":
        return statusCatalogLabel(ev.status, statusCatalog);
      case "planningKind":
        return eventPlanningKind(ev) === "PLANNED" ? "Плановое" : "Внеплановое";
      case "aircraftId":
        return ev.aircraft?.tailNumber ?? ev.virtualAircraft?.label ?? "—";
      case "operator":
        return (
          <span className="ganttTableCellText" title={meta.operator}>
            {meta.operator}
          </span>
        );
      case "aircraftType":
        return (
          <span className="ganttTableCellText" title={meta.aircraftType}>
            {meta.aircraftType}
          </span>
        );
      case "eventTypeId":
        return (
          <span className="ganttTableCellText" title={ev.eventType?.name ?? undefined}>
            {ev.eventType?.name ?? "—"}
          </span>
        );
      case "workshopId":
        return (
          <span
            className="ganttTableCellText"
            title={ev.workshop ? (ev.workshop.code ? `${ev.workshop.code} • ${ev.workshop.name}` : ev.workshop.name) : undefined}
          >
            {ev.workshop?.name ?? "—"}
          </span>
        );
      case "startAtLocal":
        return formatCellDate(ev.startAt);
      case "endAtLocal":
        return formatCellDate(ev.endAt);
      case "tatPlanDays":
        return <span className="ganttTableReadonly">{durationDaysLabel(toInputLocal(ev.startAt), toInputLocal(ev.endAt))}</span>;
      case "tatPlanHours":
        return <span className="ganttTableReadonly">{durationHoursLabel(toInputLocal(ev.startAt), toInputLocal(ev.endAt))}</span>;
      case "timeOfStart":
        return timeOfLocal(toInputLocal(ev.startAt));
      case "timeOfEnd":
        return timeOfLocal(toInputLocal(ev.endAt));
      case "budgetStartAtLocal":
        return formatCellDate(ev.budgetStartAt);
      case "budgetEndAtLocal":
        return formatCellDate(ev.budgetEndAt);
      case "tatBudgetDays":
        return (
          <span className="ganttTableReadonly">
            {durationDaysLabel(toInputLocal(ev.budgetStartAt), toInputLocal(ev.budgetEndAt))}
          </span>
        );
      case "actualStartAtLocal":
        return formatCellDate(ev.actualStartAt);
      case "actualEndAtLocal":
        return formatCellDate(ev.actualEndAt);
      case "tatActualDays":
        return (
          <span className="ganttTableReadonly">
            {durationDaysLabel(toInputLocal(ev.actualStartAt), toInputLocal(ev.actualEndAt))}
          </span>
        );
      case "tatActualHours":
        return (
          <span className="ganttTableReadonly">
            {durationHoursLabel(toInputLocal(ev.actualStartAt), toInputLocal(ev.actualEndAt))}
          </span>
        );
      case "timeOfActualStart":
        return timeOfLocal(toInputLocal(ev.actualStartAt));
      case "timeOfActualEnd":
        return timeOfLocal(toInputLocal(ev.actualEndAt));
      case "hangarId":
        return (
          <span className="ganttTableCellText" title={ev.hangar?.name ?? undefined}>
            {ev.hangar?.name ?? "—"}
          </span>
        );
      case "layoutId":
        return (
          <span className="ganttTableCellText" title={ev.layout?.name ?? undefined}>
            {ev.layout?.name ?? "—"}
          </span>
        );
      case "standId":
        return ev.reservation?.stand?.code ?? "—";
      case "allowOverlap":
        return "—";
      case "notes":
        return (
          <span className="ganttTableNotes" title={ev.notes?.trim() || undefined}>
            {ev.notes?.trim() ? ev.notes : "—"}
          </span>
        );
      case "actions":
        return (
          <div className="ganttTableRowActions">
            <button
              className="ganttTableIconBtn"
              type="button"
              title="Открыть карточку"
              aria-label="Открыть карточку"
              onClick={() => props.onOpenEvent(ev.id)}
            >
              <IconCard />
            </button>
          </div>
        );
      case "primary":
      default: {
        const value = primaryByEventId.get(ev.id)?.[col.id];
        const text = formatPrimaryCell(value, { key: col.id, label: col.label });
        return (
          <span className="ganttTableReadonly ganttTableCellText" title={text === "—" ? undefined : text}>
            {text}
          </span>
        );
      }
    }
  };

  const renderEditCell = (
    col: TableColDef,
    ev: GanttTableEvent,
    d: RowDraft,
    meta: { operator: string; aircraftType: string },
    ctx: {
      layoutOptions: Layout[];
      standOptions: Stand[];
      locationLocked: boolean;
      aircraftLocked: boolean;
      budgetDisabled: boolean;
    }
  ): ReactNode => {
    switch (col.kind) {
      case "title":
        return (
          <input className="evInput ganttTableInput" value={d.title} onChange={(e) => patchDraft({ title: e.target.value })} />
        );
      case "level":
        return (
          <select
            className="evInput ganttTableInput"
            value={d.level}
            onChange={(e) => patchDraft({ level: e.target.value as RowDraft["level"] })}
          >
            <option value="OPERATIONAL">Оперативный</option>
            <option value="STRATEGIC">Стратегический</option>
          </select>
        );
      case "status":
        return (
          <select
            className="evInput ganttTableInput"
            value={d.status}
            onChange={(e) => patchDraft({ status: e.target.value as RowDraft["status"] })}
          >
            {statusSelectOptions.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        );
      case "planningKind":
        return (
          <select
            className="evInput ganttTableInput"
            value={d.planningKind}
            onChange={(e) => {
              const planningKind = e.target.value as RowDraft["planningKind"];
              patchDraft({
                planningKind,
                budgetStartAtLocal: planningKind === "PLANNED" ? d.budgetStartAtLocal || d.startAtLocal : "",
                budgetEndAtLocal: planningKind === "PLANNED" ? d.budgetEndAtLocal || d.endAtLocal : ""
              });
            }}
          >
            <option value="PLANNED">Плановое</option>
            <option value="UNPLANNED">Внеплановое</option>
          </select>
        );
      case "aircraftId":
        return ctx.aircraftLocked ? (
          <input className="evInput ganttTableInput evInputReadonly" value={ev.virtualAircraft?.label ?? "—"} readOnly />
        ) : (
          <SingleSelectDropdown
            className="ganttTableSelect"
            compact
            searchable
            searchPlaceholder="Найти борт"
            placeholder="— выберите —"
            emptyLabel="— выберите —"
            options={aircraftOptions}
            value={d.aircraftId}
            onChange={(aircraftId) => patchDraft({ aircraftId })}
            maxHeight={260}
            width="100%"
          />
        );
      case "operator":
        return (
          <span className="ganttTableReadonly ganttTableCellText" title={meta.operator}>
            {meta.operator}
          </span>
        );
      case "aircraftType":
        return (
          <span className="ganttTableReadonly ganttTableCellText" title={meta.aircraftType}>
            {meta.aircraftType}
          </span>
        );
      case "eventTypeId":
        return (
          <select
            className="evInput ganttTableInput"
            value={d.eventTypeId}
            onChange={(e) => patchDraft({ eventTypeId: e.target.value })}
          >
            <option value="">— выберите —</option>
            {props.eventTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        );
      case "workshopId":
        return (
          <select
            className="evInput ganttTableInput"
            value={d.workshopId}
            onChange={(e) => patchDraft({ workshopId: e.target.value })}
          >
            <option value="">— не задан —</option>
            {props.workshops
              .filter((w) => w.isActive !== false || w.id === d.workshopId)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code ? `${w.code} • ${w.name}` : w.name}
                </option>
              ))}
          </select>
        );
      case "startAtLocal":
        return (
          <input
            className="evInput ganttTableInput"
            type="datetime-local"
            value={d.startAtLocal}
            onChange={(e) => patchDraft({ startAtLocal: e.target.value })}
          />
        );
      case "endAtLocal":
        return (
          <input
            className="evInput ganttTableInput"
            type="datetime-local"
            value={d.endAtLocal}
            onChange={(e) => patchDraft({ endAtLocal: e.target.value })}
          />
        );
      case "tatPlanDays":
        return <span className="ganttTableReadonly">{durationDaysLabel(d.startAtLocal, d.endAtLocal)}</span>;
      case "tatPlanHours":
        return <span className="ganttTableReadonly">{durationHoursLabel(d.startAtLocal, d.endAtLocal)}</span>;
      case "timeOfStart":
        return <span className="ganttTableReadonly">{timeOfLocal(d.startAtLocal)}</span>;
      case "timeOfEnd":
        return <span className="ganttTableReadonly">{timeOfLocal(d.endAtLocal)}</span>;
      case "budgetStartAtLocal":
        return (
          <input
            className="evInput ganttTableInput"
            type="datetime-local"
            value={d.budgetStartAtLocal}
            disabled={ctx.budgetDisabled}
            onChange={(e) => patchDraft({ budgetStartAtLocal: e.target.value })}
          />
        );
      case "budgetEndAtLocal":
        return (
          <input
            className="evInput ganttTableInput"
            type="datetime-local"
            value={d.budgetEndAtLocal}
            disabled={ctx.budgetDisabled}
            onChange={(e) => patchDraft({ budgetEndAtLocal: e.target.value })}
          />
        );
      case "tatBudgetDays":
        return <span className="ganttTableReadonly">{durationDaysLabel(d.budgetStartAtLocal, d.budgetEndAtLocal)}</span>;
      case "actualStartAtLocal":
        return (
          <input
            className="evInput ganttTableInput"
            type="datetime-local"
            value={d.actualStartAtLocal}
            onChange={(e) => patchDraft({ actualStartAtLocal: e.target.value })}
          />
        );
      case "actualEndAtLocal":
        return (
          <input
            className="evInput ganttTableInput"
            type="datetime-local"
            value={d.actualEndAtLocal}
            onChange={(e) => patchDraft({ actualEndAtLocal: e.target.value })}
          />
        );
      case "tatActualDays":
        return <span className="ganttTableReadonly">{durationDaysLabel(d.actualStartAtLocal, d.actualEndAtLocal)}</span>;
      case "tatActualHours":
        return <span className="ganttTableReadonly">{durationHoursLabel(d.actualStartAtLocal, d.actualEndAtLocal)}</span>;
      case "timeOfActualStart":
        return <span className="ganttTableReadonly">{timeOfLocal(d.actualStartAtLocal)}</span>;
      case "timeOfActualEnd":
        return <span className="ganttTableReadonly">{timeOfLocal(d.actualEndAtLocal)}</span>;
      case "hangarId":
        return ctx.locationLocked ? (
          <input
            className="evInput ganttTableInput evInputReadonly"
            value={ev.hangar?.name ?? "—"}
            readOnly
            title="Несколько этапов — правьте в карточке"
          />
        ) : (
          <select
            className="evInput ganttTableInput"
            value={d.hangarId}
            onChange={(e) => patchDraft({ hangarId: e.target.value, layoutId: "", standId: "" })}
          >
            <option value="">— не задан —</option>
            {props.hangars.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        );
      case "layoutId":
        return ctx.locationLocked ? (
          <input className="evInput ganttTableInput evInputReadonly" value={ev.layout?.name ?? "—"} readOnly />
        ) : (
          <select
            className="evInput ganttTableInput"
            value={d.layoutId}
            disabled={!d.hangarId}
            onChange={(e) => patchDraft({ layoutId: e.target.value, standId: "" })}
          >
            <option value="">— не задан —</option>
            {ctx.layoutOptions.map((l) => (
              <option key={l.id} value={l.id} title={l.standsSummary || undefined}>
                {l.name}
                {l.standsSummary ? ` — ${l.standsSummary}` : l.capacitySummary ? ` — ${l.capacitySummary}` : ""}
              </option>
            ))}
          </select>
        );
      case "standId":
        return ctx.locationLocked ? (
          <input className="evInput ganttTableInput evInputReadonly" value={ev.reservation?.stand?.code ?? "—"} readOnly />
        ) : (
          <select
            className="evInput ganttTableInput"
            value={d.standId}
            disabled={!d.layoutId}
            onChange={(e) => patchDraft({ standId: e.target.value })}
          >
            <option value="">— не выбрано —</option>
            {ctx.standOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code}
              </option>
            ))}
          </select>
        );
      case "allowOverlap":
        return (
          <input
            type="checkbox"
            checked={d.allowOverlap}
            onChange={(e) => patchDraft({ allowOverlap: e.target.checked })}
            title="Разрешить нахлёст при сохранении"
          />
        );
      case "notes":
        return (
          <input className="evInput ganttTableInput" value={d.notes} onChange={(e) => patchDraft({ notes: e.target.value })} />
        );
      case "actions":
        return (
          <div className="ganttTableRowActions" title={ctx.locationLocked ? "Несколько ангаров — место в карточке" : undefined}>
            <button
              className="ganttTableIconBtn ganttTableIconBtnPrimary"
              type="button"
              title="Сохранить"
              aria-label="Сохранить"
              onClick={requestSave}
              disabled={!isDirty || saveM.isPending}
            >
              <IconSave />
            </button>
            <button
              className="ganttTableIconBtn"
              type="button"
              title="Отмена"
              aria-label="Отмена"
              onClick={cancelEdit}
              disabled={saveM.isPending}
            >
              <IconCancel />
            </button>
            <button
              className="ganttTableIconBtn"
              type="button"
              title="Открыть карточку"
              aria-label="Открыть карточку"
              onClick={() => props.onOpenEvent(ev.id)}
            >
              <IconCard />
            </button>
          </div>
        );
      case "primary":
      default: {
        const value = primaryByEventId.get(ev.id)?.[col.id];
        const text = formatPrimaryCell(value, { key: col.id, label: col.label });
        return (
          <span className="ganttTableReadonly ganttTableCellText" title={text === "—" ? undefined : text}>
            {text}
          </span>
        );
      }
    }
  };

  return (
    <div className="ganttTablePanel">
      {localError && !confirmOpen ? <div className="error ganttTableError">{localError}</div> : null}

      <div className="ganttTableWrap" ref={tableWrapRef}>
        <table className="ganttEventsTable">
          <colgroup>
            {displayColumns.map((col) => (
              <col key={col.id} style={{ width: col.id === SELECT_COL_ID ? SELECT_COL_WIDTH : colWidths[col.id] }} />
            ))}
          </colgroup>
          <thead>
            <tr
              onContextMenu={(e) => {
                e.preventDefault();
                setColPickerOpen(true);
              }}
            >
              {displayColumns.map((col) => (
                <th
                  key={col.id}
                  className={cellClass(col)}
                  style={colStyle(col.id)}
                  title={
                    col.id === SELECT_COL_ID
                      ? "Выбрать все отфильтрованные"
                      : col.id === "actions"
                        ? "Действия · ПКМ — настройки"
                        : col.label
                  }
                >
                  {col.id === SELECT_COL_ID ? (
                    <input
                      type="checkbox"
                      className="ganttTableSelectBox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected;
                      }}
                      onChange={(e) => toggleAllVisible(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={visibleEventIds.length === 0}
                      aria-label="Выбрать все отфильтрованные"
                    />
                  ) : (
                    <>
                      <span className="ganttTableThLabel">{col.id === "actions" ? "…" : col.label}</span>
                      <button
                        type="button"
                        className="ganttTableColResize"
                        aria-label={`Изменить ширину столбца «${col.label || "Действия"}»`}
                        onPointerDown={(e) => startColResize(col, e)}
                      />
                    </>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedEvents.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, displayColumns.length)} className="ganttTableEmpty">
                  Нет событий в выбранном периоде и фильтрах
                </td>
              </tr>
            ) : (
              sortedEvents.map((ev) => {
                const isEditing = editingId === ev.id && draft;
                const isSelected = selectedIdSet.has(ev.id);
                const meta = resolveAircraftMeta(ev, isEditing ? draft : null);
                const rowClass = [
                  isEditing ? "ganttTableRowEditing" : "",
                  isEditing && isDirty ? "ganttTableRowDirty" : "",
                  !isEditing && isSelected ? "ganttTableRowSelected" : ""
                ]
                  .filter(Boolean)
                  .join(" ");

                if (!isEditing) {
                  return (
                    <tr
                      key={ev.id}
                      className={rowClass}
                      onClick={() => beginEdit(ev)}
                      title={props.canEdit ? "Нажмите, чтобы редактировать" : "Открыть карточку"}
                    >
                      {displayColumns.map((col) => (
                        <td
                          key={col.id}
                          className={cellClass(col)}
                          style={colStyle(col.id)}
                          onClick={
                            col.id === "actions" || col.id === SELECT_COL_ID ? (e) => e.stopPropagation() : undefined
                          }
                        >
                          {col.id === SELECT_COL_ID ? renderSelectCell(ev) : renderReadonlyCell(col, ev, meta)}
                        </td>
                      ))}
                    </tr>
                  );
                }

                const d = draft!;
                const layoutOptions = d.hangarId ? layoutsByHangar.get(d.hangarId) ?? [] : [];
                const standOptions = d.layoutId ? standsByLayout.get(d.layoutId) ?? [] : [];
                const ctx = {
                  layoutOptions,
                  standOptions,
                  locationLocked: d.multiPlacement,
                  aircraftLocked: d.hasVirtualAircraft && !d.aircraftId,
                  budgetDisabled: d.planningKind === "UNPLANNED"
                };

                return (
                  <tr key={ev.id} className={rowClass}>
                    {displayColumns.map((col) => (
                      <td
                        key={col.id}
                        className={cellClass(col)}
                        style={colStyle(col.id)}
                        onClick={col.id === SELECT_COL_ID ? (e) => e.stopPropagation() : undefined}
                      >
                        {col.id === SELECT_COL_ID ? renderSelectCell(ev) : renderEditCell(col, ev, d, meta, ctx)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {colPickerOpen ? (
        <div
          className="modalBackdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setInfoOpen(false);
              setColPickerOpen(false);
            }
          }}
        >
          <div className="modalWindow ganttTableColsModal" role="dialog" aria-labelledby="ganttTableColsTitle">
            <div className="modalHeader">
              <div className="ganttTableSettingsTitle">
                <div className="modalTitle" id="ganttTableColsTitle">
                  Настройки
                </div>
                <div className="ganttTableInfoWrap" ref={infoRef}>
                  <button
                    type="button"
                    className="ganttTableInfoBtn"
                    aria-label="Справка по таблице"
                    title="Справка по таблице"
                    onClick={() => setInfoOpen((v) => !v)}
                  >
                    <IconInfo />
                  </button>
                  {infoOpen ? (
                    <div className="ganttTableInfoPop ganttTableInfoPopModal" role="note">
                      Редактирование: клик по строке → правки в черновике → сохранить. Чекбоксы слева — массовая смена
                      статуса (панель под фильтрами). Действия и «Форма ТО» закреплены слева. ПКМ по заголовку открывает
                      эти настройки. Наборы хранятся на пользователе. Трудоёмкость ME / AV / INT / NDT / SHOP / CabRep
                      (бюджет, MPS, факт) — только чтение; правка в карточке.
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="modalClose"
                aria-label="Закрыть"
                onClick={() => {
                  setInfoOpen(false);
                  setColPickerOpen(false);
                }}
              >
                ×
              </button>
            </div>
            <div className="modalBody ganttTableColsModalBody">
              <aside className="ganttTableColsPresets">
                <div className="ganttTableColsPresetsTitle">Заготовки</div>
                <button
                  type="button"
                  className={`ganttTableColsPreset${activeView ? "" : " isActive"}`}
                  onClick={selectFactoryDefault}
                >
                  <span>По умолчанию</span>
                  <span className="muted">24 столбца</span>
                </button>
                {views.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`ganttTableColsPreset${activeView?.id === v.id ? " isActive" : ""}`}
                    onClick={() => activateViewM.mutate(v)}
                  >
                    <span>{v.name}</span>
                    <span className="muted">
                      {Array.isArray(v.config?.visible) && v.config.visible.length
                        ? `${v.config.visible.length} столбцов`
                        : "Сохранённый набор"}
                    </span>
                  </button>
                ))}
                {views.length === 0 ? (
                  <div className="muted ganttTableColsPresetsEmpty">Пока нет сохранённых наборов</div>
                ) : null}
              </aside>
              <div className="ganttTableColsPicker">
                <input
                  className="evInput ganttTableInput"
                  placeholder="Поиск по названию или группе"
                  value={colMenuQuery}
                  onChange={(e) => setColMenuQuery(e.target.value)}
                />
                {allowColumnReorder ? (
                  <div className="ganttTableColMenuHint muted">Отметьте реквизиты. Перетащите строку, чтобы изменить порядок.</div>
                ) : (
                  <div className="ganttTableColMenuHint muted">Отметьте реквизиты для текущего набора.</div>
                )}
                <div className="ganttTableColMenuList ganttTableColsPickerList">
                  {orderedColumns.map((col, index) => {
                    const q = colMenuQuery.trim().toLocaleLowerCase("ru");
                    if (q) {
                      const hay = `${col.label} ${col.group ?? ""} ${col.subgroup ?? ""} ${col.id}`.toLocaleLowerCase("ru");
                      if (!hay.includes(q)) return null;
                    }
                    const prev = orderedColumns
                      .slice(0, index)
                      .reverse()
                      .find((c) => {
                        if (!q) return true;
                        const hay = `${c.label} ${c.group ?? ""} ${c.subgroup ?? ""} ${c.id}`.toLocaleLowerCase("ru");
                        return hay.includes(q);
                      });
                    const showGroup = col.group && col.group !== prev?.group;
                    const showSub = col.subgroup && (col.subgroup !== prev?.subgroup || col.group !== prev?.group);
                    const locked = col.hideable === false;
                    const checked = locked || visibleIds.has(col.id);
                    const reorderLocked = !allowColumnReorder || PINNED_LEFT_IDS.includes(col.id);
                    return (
                      <div key={col.id}>
                        {showGroup ? <div className="ganttTableColMenuGroup">{col.group}</div> : null}
                        {showSub ? <div className="ganttTableColMenuSubgroup">{col.subgroup}</div> : null}
                        <label
                          className={`ganttTableColMenuItem${locked ? " ganttTableColMenuItemLocked" : ""}${
                            dragColId === col.id ? " ganttTableColMenuItemDragging" : ""
                          }`}
                          draggable={!reorderLocked}
                          onDragStart={(e) => {
                            if (reorderLocked) {
                              e.preventDefault();
                              return;
                            }
                            setDragColId(col.id);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", col.id);
                          }}
                          onDragOver={(e) => {
                            if (reorderLocked || !dragColId || dragColId === col.id) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (!allowColumnReorder) return;
                            const from = e.dataTransfer.getData("text/plain") || dragColId;
                            if (from) moveColumn(from, col.id);
                            setDragColId(null);
                          }}
                          onDragEnd={() => setDragColId(null)}
                        >
                          <span
                            className={`ganttTableColMenuGrip${reorderLocked ? " ganttTableColMenuGripLocked" : ""}`}
                            title={reorderLocked ? "Фиксированный столбец" : "Перетащить"}
                          >
                            <IconGrip />
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={() => toggleColVisible(col.id)}
                          />
                          <span>{col.label || "Действия"}</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="ganttTableColsModalFooter">
              <input
                className="evInput ganttTableInput"
                placeholder="Название нового набора"
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const name = saveAsName.trim();
                    if (name) saveViewAsM.mutate(name);
                  }
                }}
              />
              <button
                className="btn"
                type="button"
                disabled={saveViewAsM.isPending || !saveAsName.trim()}
                onClick={() => {
                  const name = saveAsName.trim();
                  if (name) saveViewAsM.mutate(name);
                }}
              >
                Сохранить как…
              </button>
              {activeView ? (
                <button className="btn" type="button" disabled={saveViewM.isPending} onClick={onSaveView}>
                  Сохранить
                </button>
              ) : null}
              {activeView ? (
                <button className="btn" type="button" disabled={deleteViewM.isPending} onClick={onDeleteView}>
                  Удалить
                </button>
              ) : null}
              <button className="btn" type="button" onClick={selectFactoryDefault}>
                Сбросить к 24
              </button>
              <button
                className="btn btnPrimary"
                type="button"
                onClick={() => {
                  setInfoOpen(false);
                  setColPickerOpen(false);
                }}
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDrawer
        open={confirmOpen}
        changeReason={changeReason}
        onChangeReason={setChangeReason}
        diffs={diffs}
        refMaps={historyRefMaps}
        error={localError}
        pending={saveM.isPending}
        onClose={() => {
          if (saveM.isPending) return;
          setConfirmOpen(false);
        }}
        onConfirm={() => saveM.mutate()}
      />
    </div>
  );
}

function formatCellDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = dayjs(v);
  return d.isValid() ? d.format("DD.MM.YYYY HH:mm") : "—";
}

function validateDraft(draft: RowDraft) {
  if (!draft.title.trim()) throw new Error("Заполните название");
  if (!draft.eventTypeId) throw new Error("Заполните тип события");
  if (!draft.aircraftId && !draft.hasVirtualAircraft) throw new Error("Заполните борт");
  const startAt = dayjs(draft.startAtLocal);
  const endAt = dayjs(draft.endAtLocal);
  if (!startAt.isValid() || !endAt.isValid()) throw new Error("Заполните оперативный период");
  if (endAt.valueOf() <= startAt.valueOf()) throw new Error("Дата окончания должна быть позже начала");
  const budgetStartAt = fromInputLocalOptional(draft.budgetStartAtLocal);
  const budgetEndAt = fromInputLocalOptional(draft.budgetEndAtLocal);
  if ((budgetStartAt && !budgetEndAt) || (!budgetStartAt && budgetEndAt)) {
    throw new Error("Заполните обе даты бюджетного периода");
  }
  if (budgetStartAt && budgetEndAt && dayjs(budgetEndAt).valueOf() <= dayjs(budgetStartAt).valueOf()) {
    throw new Error("Окончание бюджетного периода должно быть позже начала");
  }
  const actualStartAt = fromInputLocalOptional(draft.actualStartAtLocal);
  const actualEndAt = fromInputLocalOptional(draft.actualEndAtLocal);
  if ((actualStartAt && !actualEndAt) || (!actualStartAt && actualEndAt)) {
    throw new Error("Заполните обе даты фактического периода");
  }
  if (actualStartAt && actualEndAt && dayjs(actualEndAt).valueOf() <= dayjs(actualStartAt).valueOf()) {
    throw new Error("Окончание фактического периода должно быть позже начала");
  }
}
