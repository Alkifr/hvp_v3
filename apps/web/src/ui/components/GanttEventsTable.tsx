import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiDelete, apiGet, apiPatch, apiPut } from "../../lib/api";

const TABLE_COLS_LS_KEY = "hangarPlanning:ganttTableColumns:v1";

type TableColId =
  | "title"
  | "level"
  | "status"
  | "planningKind"
  | "aircraftId"
  | "operator"
  | "aircraftType"
  | "eventTypeId"
  | "startAtLocal"
  | "endAtLocal"
  | "tatOper"
  | "budgetStartAtLocal"
  | "budgetEndAtLocal"
  | "tatBudget"
  | "actualStartAtLocal"
  | "actualEndAtLocal"
  | "tatActual"
  | "hangarId"
  | "layoutId"
  | "standId"
  | "allowOverlap"
  | "notes"
  | "actions";

type TableColDef = {
  id: TableColId;
  label: string;
  defaultWidth: number;
  minWidth: number;
  sticky?: "left" | "right";
  hideable?: boolean;
};

const TABLE_COLUMNS: TableColDef[] = [
  { id: "title", label: "Название", defaultWidth: 180, minWidth: 120, sticky: "left", hideable: false },
  { id: "level", label: "Уровень", defaultWidth: 120, minWidth: 90 },
  { id: "status", label: "Статус", defaultWidth: 120, minWidth: 90 },
  { id: "planningKind", label: "Тип план.", defaultWidth: 110, minWidth: 90 },
  { id: "aircraftId", label: "Борт", defaultWidth: 110, minWidth: 80 },
  { id: "operator", label: "Оператор", defaultWidth: 140, minWidth: 90 },
  { id: "aircraftType", label: "Тип ВС", defaultWidth: 140, minWidth: 90 },
  { id: "eventTypeId", label: "Тип события", defaultWidth: 140, minWidth: 100 },
  { id: "startAtLocal", label: "Опер. начало", defaultWidth: 150, minWidth: 120 },
  { id: "endAtLocal", label: "Опер. окончание", defaultWidth: 150, minWidth: 120 },
  { id: "tatOper", label: "TAT опер.", defaultWidth: 110, minWidth: 80 },
  { id: "budgetStartAtLocal", label: "Бюдж. начало", defaultWidth: 150, minWidth: 120 },
  { id: "budgetEndAtLocal", label: "Бюдж. окончание", defaultWidth: 150, minWidth: 120 },
  { id: "tatBudget", label: "TAT бюдж.", defaultWidth: 110, minWidth: 80 },
  { id: "actualStartAtLocal", label: "Факт начало", defaultWidth: 150, minWidth: 120 },
  { id: "actualEndAtLocal", label: "Факт окончание", defaultWidth: 150, minWidth: 120 },
  { id: "tatActual", label: "TAT факт", defaultWidth: 110, minWidth: 80 },
  { id: "hangarId", label: "Ангар", defaultWidth: 120, minWidth: 90 },
  { id: "layoutId", label: "Вариант", defaultWidth: 140, minWidth: 90 },
  { id: "standId", label: "Место", defaultWidth: 100, minWidth: 70 },
  { id: "allowOverlap", label: "Нахлёст", defaultWidth: 80, minWidth: 60 },
  { id: "notes", label: "Примечание", defaultWidth: 180, minWidth: 100 },
  { id: "actions", label: "Действия", defaultWidth: 220, minWidth: 180, sticky: "right", hideable: false }
];

const DEFAULT_COL_WIDTHS = Object.fromEntries(TABLE_COLUMNS.map((c) => [c.id, c.defaultWidth])) as Record<
  TableColId,
  number
>;
const DEFAULT_HIDDEN_COLS: TableColId[] = [];

function safeReadTableCols(): { widths?: Partial<Record<TableColId, number>>; hidden?: TableColId[] } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(TABLE_COLS_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeWriteTableCols(v: { widths: Record<TableColId, number>; hidden: TableColId[] }) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TABLE_COLS_LS_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
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
type Hangar = { id: string; name: string };
type Layout = {
  id: string;
  name: string;
  hangarId: string;
  code?: string;
  capacitySummary?: string;
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
  layout?: { id?: string; name: string; hangarId?: string } | null;
  reservation?: { stand?: { id?: string; code: string } | null } | null;
  placements?: EventPlacementRow[];
};

type RowDraft = {
  id: string;
  title: string;
  level: "STRATEGIC" | "OPERATIONAL";
  status: "DRAFT" | "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "CANCELLED";
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
  layoutId: string;
  standId: string;
  allowOverlap: boolean;
  multiPlacement: boolean;
  hasVirtualAircraft: boolean;
};

const FIELD_LABEL: Record<string, string> = {
  title: "Название",
  level: "Уровень",
  status: "Статус",
  planningKind: "Тип планирования",
  aircraftId: "Борт",
  eventTypeId: "Тип события",
  startAtLocal: "Начало",
  endAtLocal: "Окончание",
  budgetStartAtLocal: "Бюджетное начало",
  budgetEndAtLocal: "Бюджетное окончание",
  actualStartAtLocal: "Фактическое начало",
  actualEndAtLocal: "Фактическое окончание",
  notes: "Примечание",
  hangarId: "Ангар",
  layoutId: "Вариант размещения",
  standId: "Место",
  allowOverlap: "Разрешить нахлёст"
};

const STATUS_OPTIONS: Array<RowDraft["status"]> = [
  "DRAFT",
  "PLANNED",
  "CONFIRMED",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED"
];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  PLANNED: "Запланировано",
  CONFIRMED: "Подтверждено",
  IN_PROGRESS: "В работе",
  DONE: "Завершено",
  CANCELLED: "Отменено"
};

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

function tatDetailed(startLocal: string, endLocal: string): string {
  if (!startLocal || !endLocal) return "—";
  const s = dayjs(startLocal);
  const e = dayjs(endLocal);
  if (!s.isValid() || !e.isValid() || e.valueOf() <= s.valueOf()) return "—";
  const hours = Math.max(0, e.diff(s, "minute")) / 60;
  return `${Number(hours.toFixed(1))} ч / ${Number((hours / 24).toFixed(2))} дн`;
}

function draftFromEvent(ev: GanttTableEvent): RowDraft {
  const placements = ev.placements ?? [];
  return {
    id: ev.id,
    title: ev.title,
    level: ev.level,
    status: ((STATUS_OPTIONS as string[]).includes(ev.status) ? ev.status : "PLANNED") as RowDraft["status"],
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
                        <span className="evDiffFrom">{String(d.from || "—")}</span>
                        <span className="evDiffArrow" aria-hidden="true">
                          →
                        </span>
                        <span className="evDiffTo">{String(d.to || "—")}</span>
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

export function GanttEventsTable(props: {
  events: GanttTableEvent[];
  canEdit: boolean;
  eventsQueryFromISO: string;
  eventsQueryToISO: string;
  aircraft: Aircraft[];
  eventTypes: EventType[];
  hangars: Hangar[];
  aircraftTypes: AircraftTypeRef[];
  operators: Array<{ id: string; name: string }>;
  onOpenEvent: (eventId: string) => void;
}) {
  const qc = useQueryClient();
  const savedCols = useMemo(() => safeReadTableCols(), []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [original, setOriginal] = useState<RowDraft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<TableColId, number>>(() => {
    const next = { ...DEFAULT_COL_WIDTHS };
    const saved = savedCols?.widths;
    if (saved) {
      for (const col of TABLE_COLUMNS) {
        const w = Number(saved[col.id]);
        if (Number.isFinite(w)) next[col.id] = Math.max(col.minWidth, Math.round(w));
      }
    }
    return next;
  });
  const [hiddenCols, setHiddenCols] = useState<Set<TableColId>>(() => {
    const arr = savedCols?.hidden;
    if (!Array.isArray(arr)) return new Set(DEFAULT_HIDDEN_COLS);
    const hideable = new Set(TABLE_COLUMNS.filter((c) => c.hideable !== false).map((c) => c.id));
    return new Set(arr.filter((id): id is TableColId => hideable.has(id as TableColId)));
  });
  const [colMenu, setColMenu] = useState<null | { x: number; y: number }>(null);
  const colMenuRef = useRef<HTMLDivElement | null>(null);

  const visibleColumns = useMemo(
    () => TABLE_COLUMNS.filter((c) => !hiddenCols.has(c.id)),
    [hiddenCols]
  );

  useEffect(() => {
    safeWriteTableCols({ widths: colWidths, hidden: Array.from(hiddenCols) });
  }, [colWidths, hiddenCols]);

  useEffect(() => {
    if (!colMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (colMenuRef.current && e.target instanceof Node && !colMenuRef.current.contains(e.target)) {
        setColMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [colMenu]);

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

  const toggleColHidden = useCallback((id: TableColId) => {
    const def = TABLE_COLUMNS.find((c) => c.id === id);
    if (!def || def.hideable === false) return;
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const resetColumns = useCallback(() => {
    setColWidths({ ...DEFAULT_COL_WIDTHS });
    setHiddenCols(new Set(DEFAULT_HIDDEN_COLS));
    setColMenu(null);
  }, []);

  const colStyle = useCallback(
    (id: TableColId): CSSProperties => {
      const w = colWidths[id] ?? DEFAULT_COL_WIDTHS[id];
      return { width: w, minWidth: w, maxWidth: w };
    },
    [colWidths]
  );

  const layoutsQ = useQuery({
    queryKey: ["ref", "layouts", "gantt-table"],
    queryFn: () => apiGet<Layout[]>("/api/ref/layouts?activeOnly=1")
  });
  const standsQ = useQuery({
    queryKey: ["ref", "stands", "gantt-table"],
    queryFn: () => apiGet<Stand[]>("/api/ref/stands?activeOnly=1")
  });

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

  const operatorNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of props.operators) m.set(o.id, o.name);
    for (const a of props.aircraft) {
      if (a.operator?.id && !m.has(a.operator.id)) m.set(a.operator.id, a.operator.name);
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
      if (!reason) throw new Error("Укажите причину изменения");

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
        changeReason: reason
      };

      if (draft.aircraftId) payload.aircraftId = draft.aircraftId;
      else if (source?.virtualAircraft) payload.virtualAircraft = source.virtualAircraft;

      if (!draft.multiPlacement) {
        payload.hangarId = draft.hangarId || null;
        payload.layoutId = draft.layoutId || null;
        payload.placements = placementsPayload;
      }

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
            changeReason: reason
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
    },
    onError: (e: any) => {
      setLocalError(String(e?.message ?? e));
    }
  });

  const renderReadonlyMeta = (ev: GanttTableEvent) => {
    const opId = ev.aircraft?.operatorId ?? ev.aircraft?.operator?.id ?? ev.virtualAircraft?.operatorId ?? "";
    const typeId = String(ev.aircraft?.typeId ?? ev.aircraft?.type?.id ?? ev.virtualAircraft?.aircraftTypeId ?? "");
    const operator =
      ev.aircraft?.operator?.name ?? (opId ? operatorNameById.get(opId) : undefined) ?? "—";
    const typeRef = typeId ? aircraftTypeById.get(typeId) : null;
    const aircraftType = ev.aircraft?.type
      ? `${ev.aircraft.type.icaoType ? `${ev.aircraft.type.icaoType} • ` : ""}${ev.aircraft.type.name}`
      : typeRef
        ? `${typeRef.icaoType ? `${typeRef.icaoType} • ` : ""}${typeRef.name}`
        : "—";
    return { operator, aircraftType };
  };

  const cellClass = (col: TableColDef) => {
    if (col.sticky === "left") return "ganttTableStickyCol";
    if (col.sticky === "right") return "ganttTableActionsCol";
    return undefined;
  };

  const renderReadonlyCell = (col: TableColDef, ev: GanttTableEvent, meta: { operator: string; aircraftType: string }) => {
    switch (col.id) {
      case "title":
        return <strong>{ev.title}</strong>;
      case "level":
        return ev.level === "STRATEGIC" ? "Стратегический" : "Оперативный";
      case "status":
        return STATUS_LABEL[ev.status] ?? ev.status;
      case "planningKind":
        return eventPlanningKind(ev) === "PLANNED" ? "Плановое" : "Внеплановое";
      case "aircraftId":
        return ev.aircraft?.tailNumber ?? ev.virtualAircraft?.label ?? "—";
      case "operator":
        return meta.operator;
      case "aircraftType":
        return meta.aircraftType;
      case "eventTypeId":
        return ev.eventType?.name ?? "—";
      case "startAtLocal":
        return formatCellDate(ev.startAt);
      case "endAtLocal":
        return formatCellDate(ev.endAt);
      case "tatOper":
        return <span className="ganttTableReadonly">{tatDetailed(toInputLocal(ev.startAt), toInputLocal(ev.endAt))}</span>;
      case "budgetStartAtLocal":
        return formatCellDate(ev.budgetStartAt);
      case "budgetEndAtLocal":
        return formatCellDate(ev.budgetEndAt);
      case "tatBudget":
        return (
          <span className="ganttTableReadonly">
            {tatDetailed(toInputLocal(ev.budgetStartAt), toInputLocal(ev.budgetEndAt))}
          </span>
        );
      case "actualStartAtLocal":
        return formatCellDate(ev.actualStartAt);
      case "actualEndAtLocal":
        return formatCellDate(ev.actualEndAt);
      case "tatActual":
        return (
          <span className="ganttTableReadonly">
            {tatDetailed(toInputLocal(ev.actualStartAt), toInputLocal(ev.actualEndAt))}
          </span>
        );
      case "hangarId":
        return ev.hangar?.name ?? "—";
      case "layoutId":
        return ev.layout?.name ?? "—";
      case "standId":
        return ev.reservation?.stand?.code ?? "—";
      case "allowOverlap":
        return "—";
      case "notes":
        return <span className="ganttTableNotes">{ev.notes?.trim() ? ev.notes : "—"}</span>;
      case "actions":
        return (
          <button className="btn" type="button" onClick={() => props.onOpenEvent(ev.id)}>
            Карточка
          </button>
        );
      default:
        return null;
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
    switch (col.id) {
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
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
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
          <select
            className="evInput ganttTableInput"
            value={d.aircraftId}
            onChange={(e) => patchDraft({ aircraftId: e.target.value })}
          >
            <option value="">— выберите —</option>
            {props.aircraft.map((a) => (
              <option key={a.id} value={a.id}>
                {a.tailNumber}
              </option>
            ))}
          </select>
        );
      case "operator":
        return <span className="ganttTableReadonly">{meta.operator}</span>;
      case "aircraftType":
        return <span className="ganttTableReadonly">{meta.aircraftType}</span>;
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
      case "tatOper":
        return <span className="ganttTableReadonly">{tatDetailed(d.startAtLocal, d.endAtLocal)}</span>;
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
      case "tatBudget":
        return <span className="ganttTableReadonly">{tatDetailed(d.budgetStartAtLocal, d.budgetEndAtLocal)}</span>;
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
      case "tatActual":
        return <span className="ganttTableReadonly">{tatDetailed(d.actualStartAtLocal, d.actualEndAtLocal)}</span>;
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
              <option key={l.id} value={l.id}>
                {l.name}
                {l.capacitySummary ? ` — ${l.capacitySummary}` : ""}
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
                {s.code} • {s.name}
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
          <>
            <div className="ganttTableRowActions">
              <button className="btn btnPrimary" type="button" onClick={requestSave} disabled={!isDirty || saveM.isPending}>
                Сохранить
              </button>
              <button className="btn" type="button" onClick={cancelEdit} disabled={saveM.isPending}>
                Отмена
              </button>
              <button className="btn" type="button" onClick={() => props.onOpenEvent(ev.id)}>
                Карточка
              </button>
            </div>
            {ctx.locationLocked ? <div className="muted ganttTableRowHint">Несколько ангаров — место в карточке</div> : null}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="ganttTablePanel">
      <div className="ganttTableHint muted">
        Редактирование: клик по строке → правки в черновике → «Сохранить». ПКМ по заголовку — показать/скрыть столбцы.
        Тяните край заголовка, чтобы изменить ширину. Настройки сохраняются локально.
      </div>

      {localError && !confirmOpen ? <div className="error ganttTableError">{localError}</div> : null}

      <div className="ganttTableWrap">
        <table className="ganttEventsTable">
          <colgroup>
            {visibleColumns.map((col) => (
              <col key={col.id} style={{ width: colWidths[col.id] }} />
            ))}
          </colgroup>
          <thead>
            <tr
              onContextMenu={(e) => {
                e.preventDefault();
                setColMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              {visibleColumns.map((col) => (
                <th key={col.id} className={cellClass(col)} style={colStyle(col.id)} title={`${col.label} · ПКМ — столбцы`}>
                  <span className="ganttTableThLabel">{col.label}</span>
                  <button
                    type="button"
                    className="ganttTableColResize"
                    aria-label={`Изменить ширину столбца «${col.label}»`}
                    onPointerDown={(e) => startColResize(col, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedEvents.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, visibleColumns.length)} className="ganttTableEmpty">
                  Нет событий в выбранном периоде и фильтрах
                </td>
              </tr>
            ) : (
              sortedEvents.map((ev) => {
                const isEditing = editingId === ev.id && draft;
                const meta = renderReadonlyMeta(ev);
                const rowClass = [
                  isEditing ? "ganttTableRowEditing" : "",
                  isEditing && isDirty ? "ganttTableRowDirty" : ""
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
                      {visibleColumns.map((col) => (
                        <td
                          key={col.id}
                          className={cellClass(col)}
                          style={colStyle(col.id)}
                          onClick={col.id === "actions" ? (e) => e.stopPropagation() : undefined}
                        >
                          {renderReadonlyCell(col, ev, meta)}
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
                    {visibleColumns.map((col) => (
                      <td key={col.id} className={cellClass(col)} style={colStyle(col.id)}>
                        {renderEditCell(col, ev, d, meta, ctx)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {colMenu ? (
        <div
          ref={colMenuRef}
          className="ganttTableColMenu"
          style={{ left: colMenu.x, top: colMenu.y }}
          role="menu"
        >
          <div className="ganttTableColMenuTitle">Столбцы</div>
          <div className="ganttTableColMenuList">
            {TABLE_COLUMNS.map((col) => {
              const locked = col.hideable === false;
              const checked = !hiddenCols.has(col.id);
              return (
                <label key={col.id} className={`ganttTableColMenuItem${locked ? " ganttTableColMenuItemLocked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() => toggleColHidden(col.id)}
                  />
                  <span>{col.label}</span>
                </label>
              );
            })}
          </div>
          <button type="button" className="btn ganttTableColMenuReset" onClick={resetColumns}>
            Сбросить ширины и видимость
          </button>
        </div>
      ) : null}

      <ConfirmDrawer
        open={confirmOpen}
        changeReason={changeReason}
        onChangeReason={setChangeReason}
        diffs={diffs}
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
