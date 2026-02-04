import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import { authMe } from "../auth/authApi";
import { EventResourcesPanel } from "../components/EventResourcesPanel";

dayjs.extend(utc);

const GANTT_UI_LS_KEY = "hangarPlanning:ganttUi:v1";

function safeReadGanttUi(): any | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(GANTT_UI_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeWriteGanttUi(v: any) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GANTT_UI_LS_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

type EventRow = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  level: "STRATEGIC" | "OPERATIONAL";
  status: string;
  aircraft: {
    id?: string;
    tailNumber: string;
    operatorId?: string | null;
    typeId?: string | null;
    operator?: { id: string; code?: string | null; name: string } | null;
    type?: { id: string; icaoType?: string | null; name: string } | null;
  };
  eventType: { id?: string; name: string; color?: string | null };
  hangar?: { id?: string; name: string } | null;
  layout?: { id?: string; name: string; hangarId?: string } | null;
  reservation?: { stand?: { id?: string; code: string } | null } | null;
  towSegments?: Array<{ id: string; startAt: string; endAt: string }>;
};

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
type Layout = { id: string; name: string; hangarId: string; code?: string };
type Stand = { id: string; layoutId: string; code: string; name: string; isActive?: boolean };
type AircraftTypePaletteRow = { id: string; operatorId: string; aircraftTypeId: string; color: string; isActive: boolean };
type DndStand = Stand & { hangarId: string; hangarName: string; layoutName: string };

type GroupMode = "AIRCRAFT" | "HANGAR_STAND";

type TowSegment = { id: string; eventId: string; startAt: string; endAt: string };

type DndMoveRequest = { eventId: string; layoutId: string; standId: string; bumpOnConflict: boolean; bumpedEventId?: string };
type DndPlaceRequest = DndMoveRequest & { startAt: string; endAt: string };

type EditorDraft = {
  id?: string;
  title: string;
  level: "STRATEGIC" | "OPERATIONAL";
  status: "DRAFT" | "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  aircraftId: string;
  eventTypeId: string;
  startAtLocal: string; // YYYY-MM-DDTHH:mm
  endAtLocal: string; // YYYY-MM-DDTHH:mm
  notes: string;
  hangarId: string; // optional, "" means null
  layoutId: string; // optional, "" means null
  standId: string; // optional, "" means no reservation
};

type EventAudit = {
  id: string;
  eventId: string;
  action: "CREATE" | "UPDATE" | "RESERVE" | "UNRESERVE";
  actor: string;
  reason?: string | null;
  changes?: any;
  createdAt: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function calcBarXW(params: {
  startAt: string;
  endAt: string;
  from: dayjs.Dayjs;
  dayWidth: number;
  canvasWidth: number;
}): { x: number; w: number; leftRaw: number; rightRaw: number } | null {
  const s = dayjs.utc(params.startAt);
  const e = dayjs.utc(params.endAt);
  if (!s.isValid() || !e.isValid()) return null;
  if (e.valueOf() <= s.valueOf()) return null;

  const leftRaw = s.diff(params.from, "day", true) * params.dayWidth;
  const rightRaw = e.diff(params.from, "day", true) * params.dayWidth;

  const x = clamp(leftRaw, 0, params.canvasWidth);
  const r = clamp(rightRaw, 0, params.canvasWidth);
  const visible = r - x;
  if (!(visible > 0)) return null;

  // минимальная ширина для кликабельности, но без "вылета" за канвас
  const w = clamp(Math.max(6, visible), 6, params.canvasWidth - x);
  return { x, w, leftRaw, rightRaw };
}

function renderTowBreaks(params: {
  ev: EventRow;
  barX: number;
  barW: number;
  from: dayjs.Dayjs;
  dayWidth: number;
  canvasWidth: number;
}) {
  const segs = params.ev.towSegments ?? [];
  if (segs.length === 0) return null;

  const out: React.ReactNode[] = [];
  for (const s of segs) {
    const seg = calcBarXW({
      startAt: s.startAt,
      endAt: s.endAt,
      from: params.from,
      dayWidth: params.dayWidth,
      canvasWidth: params.canvasWidth
    });
    if (!seg) continue;
    const left = clamp(seg.x - params.barX, 0, params.barW);
    const width = clamp(seg.w, 0, params.barW - left);
    if (!(width > 0)) continue;
    out.push(
      <div
        key={`tow:${s.id}`}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left,
          width,
          background: "rgba(239, 68, 68, 0.95)",
          borderLeft: "2px solid rgba(255,255,255,0.9)",
          borderRight: "2px solid rgba(255,255,255,0.9)",
          zIndex: 0,
          pointerEvents: "none"
        }}
        title="Буксировка"
      />
    );
  }
  return out.length ? out : null;
}

function formatRowLabel(ev: EventRow) {
  const bits = [ev.eventType?.name];
  if (ev.hangar?.name) bits.push(ev.hangar.name);
  if (ev.reservation?.stand?.code) bits.push(ev.reservation.stand.code);
  return bits.filter(Boolean).join(" • ");
}

function isValidDateInput(v: string) {
  // Для <input type="date"> значение либо "" (в процессе ввода), либо "YYYY-MM-DD"
  if (!v) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = dayjs.utc(v);
  return d.isValid();
}

function barVisualStyle(status: string, baseColor: string) {
  // Базовая логика:
  // - основной цвет = тип ВС (в связке с оператором)
  // - статусы показываем преимущественно РАМКАМИ/прозрачностью
  // - CANCELLED всегда серый
  // - нахлёсты подсвечиваются отдельно (оверлеем), не здесь
  if (status === "CANCELLED") {
    return {
      background: "rgba(148, 163, 184, 0.85)",
      border: "1px solid rgba(100, 116, 139, 0.9)",
      color: "rgba(15, 23, 42, 0.85)"
    } as const;
  }

  const textColor = pickTextColorForBg(baseColor);

  if (status === "DONE") {
    return {
      background: baseColor,
      border: "2px solid rgba(34, 197, 94, 0.95)",
      color: textColor
    } as const;
  }

  if (status === "DRAFT" || status === "PLANNED") {
    return {
      background: baseColor,
      opacity: 0.78,
      border: "2px dashed rgba(15, 23, 42, 0.35)",
      color: textColor
    } as const;
  }

  // CONFIRMED / IN_PROGRESS (и прочие) — обычная заливка и рамка
  return {
    background: baseColor,
    border: "1px solid rgba(15, 23, 42, 0.22)",
    color: textColor
  } as const;
}

function pickTextColorForBg(color: string) {
  // Ожидаем #RRGGBB. Для неизвестных форматов — белый (как раньше).
  const m = String(color ?? "").trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return "white";
  const hex = m[1]!;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // YIQ, быстро и достаточно для UI:
  // чем выше значение, тем светлее фон. Порог ~155 даёт хорошее разделение.
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 155 ? "rgba(15, 23, 42, 0.92)" : "white";
}

const AIRCRAFT_MARK_PALETTE = [
  "#0ea5e9",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#e11d48",
  "#14b8a6",
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#8b5cf6"
] as const;

function hashToIndex(s: string, mod: number) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const n = Math.abs(h);
  return mod <= 0 ? 0 : n % mod;
}

function aircraftTypeMarkColor(ev: EventRow, palette?: Map<string, string>) {
  const opId = ev.aircraft.operatorId ?? ev.aircraft.operator?.id ?? "";
  const typeId = ev.aircraft.typeId ?? ev.aircraft.type?.id ?? "";
  const key = `${opId}|${typeId}`;
  if (!opId && !typeId) return "rgba(15, 23, 42, 0.22)";
  const fromRef = palette?.get(key);
  if (fromRef) return fromRef;
  return AIRCRAFT_MARK_PALETTE[hashToIndex(key, AIRCRAFT_MARK_PALETTE.length)]!;
}

type PlacedEvent = { ev: EventRow; overlapToMs: number | null };

function packOverlapsIntoLanes(events: EventRow[]): PlacedEvent[][] {
  const sorted = [...events].sort((a, b) => {
    const as = Date.parse(a.startAt);
    const bs = Date.parse(b.startAt);
    if (as !== bs) return as - bs;
    return Date.parse(a.endAt) - Date.parse(b.endAt);
  });

  const lanes: Array<{ items: PlacedEvent[]; lastEndMs: number }> = [];

  for (const ev of sorted) {
    const startMs = Date.parse(ev.startAt);
    const endMs = Date.parse(ev.endAt);

    if (lanes.length === 0) {
      lanes.push({ items: [{ ev, overlapToMs: null }], lastEndMs: endMs });
      continue;
    }

    const laneIdx = lanes.findIndex((l) => l.lastEndMs <= startMs);
    if (laneIdx >= 0) {
      lanes[laneIdx]!.items.push({ ev, overlapToMs: null });
      lanes[laneIdx]!.lastEndMs = endMs;
      continue;
    }

    const maxOverlapEndMs = Math.max(...lanes.map((l) => l.lastEndMs));
    const overlapToMs = Math.min(endMs, maxOverlapEndMs);
    lanes.push({ items: [{ ev, overlapToMs }], lastEndMs: endMs });
  }

  return lanes.map((l) => l.items);
}

function TodayLine(props: { from: dayjs.Dayjs; to: dayjs.Dayjs; canvasWidth: number }) {
  const today = dayjs.utc().startOf("day");
  if (today.valueOf() < props.from.valueOf() || today.valueOf() >= props.to.valueOf()) return null;
  const totalDays = Math.max(1, props.to.diff(props.from, "day"));
  const x = (today.diff(props.from, "day") / totalDays) * props.canvasWidth;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: x,
        width: 2,
        background: "rgba(220, 38, 38, 0.35)",
        zIndex: 5,
        pointerEvents: "none"
      }}
      title="Сегодня"
    />
  );
}

function Drawer(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div
      className="drawerBackdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="drawer">
        <div className="row" style={{ marginBottom: 12 }}>
          <strong>{props.title}</strong>
          <span style={{ flex: "1 1 auto" }} />
          <button className="btn" onClick={props.onClose}>
            Закрыть
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function GanttView() {
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => authMe(), retry: 0 });
  const me = meQ.data && (meQ.data as any).ok ? (meQ.data as any).user : null;
  const canDnd = Boolean(me?.permissions?.includes("events:write") && (me?.roles?.includes("ADMIN") || me?.roles?.includes("PLANNER")));

  const headerViewportRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);

  const ptrPreviewRef = useRef<null | { startAt: string; endAt: string; x: number; w: number }>(null);
  const ptrTargetRef = useRef<
    null | { layoutId: string; standId: string; rowKey: string; intent: "move" | "bump"; bumpedEventId?: string }
  >(null);
  const hangarStandRowsRef = useRef<any[]>([]);
  const initialFrom = useMemo(() => dayjs().add(-20, "day").format("YYYY-MM-DD"), []);
  const initialTo = useMemo(() => dayjs().add(30, "day").format("YYYY-MM-DD"), []);
  const savedUi = useMemo(() => safeReadGanttUi(), []);

  // input* — то, что пользователь вводит (может быть временно невалидным)
  // applied* — последнее валидное значение, которое используется в вычислениях/запросах
  const [rangeFromApplied, setRangeFromApplied] = useState<string>(() => String(savedUi?.rangeFromApplied ?? initialFrom));
  const [rangeToApplied, setRangeToApplied] = useState<string>(() => String(savedUi?.rangeToApplied ?? initialTo));
  const [rangeFromInput, setRangeFromInput] = useState<string>(() => String(savedUi?.rangeFromInput ?? savedUi?.rangeFromApplied ?? initialFrom));
  const [rangeToInput, setRangeToInput] = useState<string>(() => String(savedUi?.rangeToInput ?? savedUi?.rangeToApplied ?? initialTo));
  const [rangeError, setRangeError] = useState<string | null>(null);

  const from = useMemo(() => dayjs.utc(rangeFromApplied).startOf("day"), [rangeFromApplied]);
  // полузакрытый интервал [from, to)
  const to = useMemo(() => dayjs.utc(rangeToApplied).add(1, "day").startOf("day"), [rangeToApplied]);
  const days = useMemo(() => {
    const d = to.diff(from, "day");
    if (!Number.isFinite(d) || d <= 0) return 1;
    return d;
  }, [from, to]);

  const [groupMode, setGroupMode] = useState<GroupMode>(() => (savedUi?.groupMode === "HANGAR_STAND" ? "HANGAR_STAND" : "AIRCRAFT"));

  const [filterAircraftTypeId, setFilterAircraftTypeId] = useState<string>(() => String(savedUi?.filterAircraftTypeId ?? ""));
  const [filterAircraftId, setFilterAircraftId] = useState<string>(() => String(savedUi?.filterAircraftId ?? ""));

  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftTypeRef[]>("/api/ref/aircraft-types")
  });

  const q = useQuery({
    queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId],
    queryFn: () =>
      apiGet<EventRow[]>(
        `/api/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${
          filterAircraftTypeId ? `&aircraftTypeId=${encodeURIComponent(filterAircraftTypeId)}` : ""
        }${filterAircraftId ? `&aircraftId=${encodeURIComponent(filterAircraftId)}` : ""}`
      ),
    // чтобы полосы не "пропадали" на время refetch при больших диапазонах
    placeholderData: (prev) => prev ?? []
  });

  const aircraftQ = useQuery({
    queryKey: ["ref", "aircraft"],
    queryFn: () => apiGet<Aircraft[]>("/api/ref/aircraft")
  });

  const aircraftPaletteQ = useQuery({
    queryKey: ["ref", "aircraft-type-palette"],
    queryFn: () => apiGet<AircraftTypePaletteRow[]>("/api/ref/aircraft-type-palette")
  });

  const aircraftPaletteMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of aircraftPaletteQ.data ?? []) {
      if (r.isActive === false) continue;
      const key = `${r.operatorId}|${r.aircraftTypeId}`;
      if (!m.has(key)) m.set(key, String(r.color));
    }
    return m;
  }, [aircraftPaletteQ.data]);

  const eventTypesQ = useQuery({
    queryKey: ["ref", "event-types"],
    queryFn: () => apiGet<EventType[]>("/api/ref/event-types")
  });

  const hangarsQ = useQuery({
    queryKey: ["ref", "hangars"],
    queryFn: () => apiGet<Hangar[]>("/api/ref/hangars")
  });

  // В режиме HANGAR_STAND: либо все ангары, либо один выбранный.
  // Важно: строки не строим заранее — только по событиям в диапазоне (без "пустых" строк).
  const [selectedHangarId, setSelectedHangarId] = useState<string>(() => String(savedUi?.selectedHangarId ?? "ALL"));
  const [dndEnabled, setDndEnabled] = useState<boolean>(() => Boolean(savedUi?.dndEnabled ?? false));

  const resetFilters = () => {
    const rf = dayjs().add(-20, "day").format("YYYY-MM-DD");
    const rt = dayjs().add(30, "day").format("YYYY-MM-DD");

    setFilterAircraftTypeId("");
    setFilterAircraftId("");
    setSelectedHangarId("ALL");

    setRangeFromInput(rf);
    setRangeToInput(rt);
    setRangeFromApplied(rf);
    setRangeToApplied(rt);
    setRangeError(null);
  };

  const dndActive = dndEnabled && canDnd && groupMode === "HANGAR_STAND";

  const dndStandsQ = useQuery({
    queryKey: ["ref", "dnd-stands", selectedHangarId],
    enabled: dndActive,
    queryFn: async () => {
      const layouts = await apiGet<Layout[]>(
        selectedHangarId === "ALL" ? "/api/ref/layouts" : `/api/ref/layouts?hangarId=${encodeURIComponent(selectedHangarId)}`
      );
      const standsPerLayout = await Promise.all(
        layouts.map((l) => apiGet<Stand[]>(`/api/ref/stands?layoutId=${encodeURIComponent(l.id)}`))
      );
      const hangarById = new Map((hangarsQ.data ?? []).map((h) => [h.id, h.name] as const));
      const out: DndStand[] = [];
      for (let i = 0; i < layouts.length; i++) {
        const l = layouts[i]!;
        const hname = hangarById.get(l.hangarId) ?? "Ангар";
        for (const s of standsPerLayout[i] ?? []) {
          if ((s as any).isActive === false) continue;
          out.push({
            ...(s as any),
            layoutId: (s as any).layoutId ?? l.id,
            hangarId: l.hangarId,
            hangarName: hname,
            layoutName: l.name
          });
        }
      }
      out.sort((a, b) => `${a.hangarName} ${a.code}`.localeCompare(`${b.hangarName} ${b.code}`, "ru"));
      return out;
    }
  });

  const dndStandById = useMemo(() => {
    const m = new Map<string, DndStand>();
    for (const s of dndStandsQ.data ?? []) m.set(s.id, s);
    return m;
  }, [dndStandsQ.data]);

  useEffect(() => {
    safeWriteGanttUi({
      rangeFromApplied,
      rangeToApplied,
      rangeFromInput,
      rangeToInput,
      groupMode,
      selectedHangarId,
      filterAircraftTypeId,
      filterAircraftId,
      dndEnabled
    });
  }, [
    rangeFromApplied,
    rangeToApplied,
    rangeFromInput,
    rangeToInput,
    groupMode,
    selectedHangarId,
    filterAircraftTypeId,
    filterAircraftId,
    dndEnabled
  ]);

  const events = q.data ?? [];
  const dayWidth = 24; // px per day
  const canvasWidth = days * dayWidth;

  useEffect(() => {
    // при изменении диапазона/ширины синхронизируем заголовок с текущим scrollLeft тела
    const h = headerViewportRef.current;
    const b = bodyScrollRef.current;
    if (!h || !b) return;
    h.scrollLeft = b.scrollLeft;
  }, [days, canvasWidth]);

  const onBodyScroll = () => {
    const h = headerViewportRef.current;
    const b = bodyScrollRef.current;
    if (!h || !b) return;
    h.scrollLeft = b.scrollLeft;
  };

  // редактор
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [original, setOriginal] = useState<EditorDraft | null>(null);

  const selectedAircraft = useMemo(() => {
    const id = draft?.aircraftId ?? "";
    if (!id) return null;
    return (aircraftQ.data ?? []).find((a) => a.id === id) ?? null;
  }, [draft?.aircraftId, aircraftQ.data]);

  // подтверждение изменения
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState<"event" | "reserve" | "towAdd" | "towDel" | "dndMove" | null>(null);
  const [changeReason, setChangeReason] = useState("");

  const openEditorForNew = () => {
    const defaultAircraft = aircraftQ.data?.[0]?.id ?? "";
    const defaultEventType = eventTypesQ.data?.[0]?.id ?? "";
    const d: EditorDraft = {
      title: "ТО",
      level: "OPERATIONAL",
      status: "PLANNED",
      aircraftId: defaultAircraft,
      eventTypeId: defaultEventType,
      startAtLocal: dayjs().add(1, "day").hour(9).minute(0).second(0).format("YYYY-MM-DDTHH:mm"),
      endAtLocal: dayjs().add(3, "day").hour(18).minute(0).second(0).format("YYYY-MM-DDTHH:mm"),
      notes: "",
      hangarId: "",
      layoutId: "",
      standId: ""
    };
    setDraft(d);
    setOriginal(d);
    setChangeReason("");
    setEditorOpen(true);
  };

  const openEditorForExisting = (ev: EventRow) => {
    const startAtLocal = dayjs(ev.startAt).format("YYYY-MM-DDTHH:mm");
    const endAtLocal = dayjs(ev.endAt).format("YYYY-MM-DDTHH:mm");
    const d: EditorDraft = {
      id: ev.id,
      title: ev.title,
      level: ev.level,
      status: (ev.status as any) ?? "PLANNED",
      aircraftId: (ev.aircraft as any)?.id ?? "",
      eventTypeId: (ev.eventType as any)?.id ?? (ev as any)?.eventTypeId ?? "",
      startAtLocal,
      endAtLocal,
      notes: (ev as any)?.notes ?? "",
      hangarId: (ev.hangar as any)?.id ?? "",
      layoutId: (ev.layout as any)?.id ?? "",
      standId: (ev.reservation?.stand as any)?.id ?? ""
    };
    setDraft(d);
    setOriginal(d);
    setChangeReason("");
    setEditorOpen(true);
  };

  const layoutsForEditorQ = useQuery({
    queryKey: ["ref", "layouts", "editor", draft?.hangarId ?? ""],
    queryFn: () => apiGet<Layout[]>(`/api/ref/layouts?hangarId=${encodeURIComponent(draft!.hangarId)}`),
    enabled: !!draft?.hangarId
  });

  const standsForEditorQ = useQuery({
    queryKey: ["ref", "stands", "editor", draft?.layoutId ?? ""],
    queryFn: () => apiGet<Stand[]>(`/api/ref/stands?layoutId=${encodeURIComponent(draft!.layoutId)}`),
    enabled: !!draft?.layoutId
  });

  const historyQ = useQuery({
    queryKey: ["event-history", draft?.id ?? ""],
    queryFn: () => apiGet<EventAudit[]>(`/api/events/${draft!.id}/history`),
    enabled: !!draft?.id && editorOpen
  });

  const computeDraftDiff = (a: EditorDraft | null, b: EditorDraft | null) => {
    if (!a || !b) return [];
    const keys: Array<keyof EditorDraft> = [
      "title",
      "level",
      "status",
      "aircraftId",
      "eventTypeId",
      "startAtLocal",
      "endAtLocal",
      "notes",
      "hangarId",
      "layoutId",
      "standId"
    ];
    return keys
      .filter((k) => (a[k] ?? "") !== (b[k] ?? ""))
      .map((k) => ({ field: String(k), from: a[k] ?? "", to: b[k] ?? "" }));
  };

  const requestSaveWithReason = (what: "event" | "reserve") => {
    const diffs = computeDraftDiff(original, draft);
    const meaningfulDiffs =
      what === "reserve" ? diffs.filter((d) => ["hangarId", "layoutId", "standId"].includes(d.field)) : diffs;
    if (meaningfulDiffs.length === 0) {
      // нечего сохранять
      return;
    }
    setPendingSave(what);
    setConfirmOpen(true);
  };

  const requestTowAddWithReason = () => {
    if (!draft?.id) throw new Error("Сначала сохраните событие");
    const startAt = dayjs(towStartLocal).second(0).millisecond(0).toISOString();
    const endAt = dayjs(towEndLocal).second(0).millisecond(0).toISOString();
    if (dayjs(endAt).valueOf() <= dayjs(startAt).valueOf()) throw new Error("Окончание буксировки должно быть позже начала");
    setPendingTow({ kind: "add", startAt, endAt });
    setPendingSave("towAdd");
    setConfirmOpen(true);
  };

  const requestTowDeleteWithReason = (towId: string) => {
    if (!draft?.id) throw new Error("Нет события");
    setPendingTow({ kind: "del", towId });
    setPendingSave("towDel");
    setConfirmOpen(true);
  };

  const saveEventM = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Нет данных формы");
      if (!draft.aircraftId || !draft.eventTypeId) throw new Error("Заполните борт и тип события");
      const startAt = dayjs(draft.startAtLocal).second(0).millisecond(0).toISOString();
      const endAt = dayjs(draft.endAtLocal).second(0).millisecond(0).toISOString();
      if (dayjs(endAt).valueOf() <= dayjs(startAt).valueOf()) throw new Error("Дата окончания должна быть позже начала");

      const payload = {
        level: draft.level,
        status: draft.status,
        title: draft.title,
        aircraftId: draft.aircraftId,
        eventTypeId: draft.eventTypeId,
        startAt,
        endAt,
        hangarId: draft.hangarId || null,
        layoutId: draft.layoutId || null,
        notes: draft.notes?.trim() ? draft.notes : null,
        changeReason: changeReason.trim()
      };

      if (!draft.id) {
        const created = await apiPost<EventRow>("/api/events", payload);
        return created;
      }
      const updated = await apiPatch<EventRow>(`/api/events/${draft.id}`, payload);
      return updated;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId] });
      setOriginal(draft);
      setConfirmOpen(false);
      setPendingSave(null);
      setChangeReason("");
    }
  });

  const reserveM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Сначала сохраните событие");
      if (!draft.layoutId || !draft.standId) throw new Error("Выберите вариант и место");
      return await apiPut(`/api/reservations/by-event/${draft.id}`, {
        layoutId: draft.layoutId,
        standId: draft.standId,
        changeReason: changeReason.trim()
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId] });
      await qc.invalidateQueries({ queryKey: ["event-history", draft?.id ?? ""] });
      setOriginal(draft);
      setConfirmOpen(false);
      setPendingSave(null);
      setChangeReason("");
    }
  });

  const unreserveM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Нет события");
      return await apiDelete(`/api/reservations/by-event/${draft.id}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId] });
      await qc.invalidateQueries({ queryKey: ["event-history", draft?.id ?? ""] });
      setDraft((d) => (d ? { ...d, standId: "" } : d));
      setOriginal((o) => (o ? { ...o, standId: "" } : o));
    }
  });

  const towsQ = useQuery({
    queryKey: ["event-tows", draft?.id ?? ""],
    queryFn: () => apiGet<TowSegment[]>(`/api/events/${draft!.id}/tows`),
    enabled: !!draft?.id && editorOpen
  });

  const [towStartLocal, setTowStartLocal] = useState(() => dayjs().minute(0).second(0).format("YYYY-MM-DDTHH:mm"));
  const [towEndLocal, setTowEndLocal] = useState(() => dayjs().add(30, "minute").minute(0).second(0).format("YYYY-MM-DDTHH:mm"));

  const [pendingTow, setPendingTow] = useState<{ kind: "add"; startAt: string; endAt: string } | { kind: "del"; towId: string } | null>(
    null
  );

  const [pendingDnd, setPendingDnd] = useState<(DndMoveRequest | DndPlaceRequest) | null>(null);
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [dndHoverKey, setDndHoverKey] = useState<string | null>(null);
  const [dndHoverBarIds, setDndHoverBarIds] = useState<string[]>([]);
  const [dndHoverIntent, setDndHoverIntent] = useState<"move" | "bump" | null>(null);
  const [dndNotice, setDndNotice] = useState<string | null>(null);

  // Надёжный DnD на pointer events + предпросмотр по времени.
  const [ptrDrag, setPtrDrag] = useState<
    null | {
      eventId: string;
      mode: "move" | "resizeL" | "resizeR";
      started: boolean;
      startClientX: number;
      startClientY: number;
      grabOffsetPx: number;
      origStartMs: number;
      origEndMs: number;
    }
  >(null);
  const [ptrPreview, setPtrPreview] = useState<null | { startAt: string; endAt: string; x: number; w: number }>(null);
  const [ptrTarget, setPtrTarget] = useState<null | { layoutId: string; standId: string; rowKey: string; intent: "move" | "bump"; bumpedEventId?: string }>(
    null
  );

  useEffect(() => {
    ptrPreviewRef.current = ptrPreview;
  }, [ptrPreview]);
  useEffect(() => {
    ptrTargetRef.current = ptrTarget;
  }, [ptrTarget]);

  const requestDndMoveWithReason = (p: DndMoveRequest) => {
    if (!dndActive) return;
    setPendingDnd(p);
    setPendingSave("dndMove");
    setDndNotice(null);
    setChangeReason("");
    setConfirmOpen(true);
  };

  useEffect(() => {
    if (!dndActive) {
      setPtrDrag(null);
      setPtrTarget(null);
      return;
    }
    if (!ptrDrag) return;

    const onMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const barEl = (el?.closest?.("[data-dnd-bar='1']") as HTMLElement | null) ?? null;
      const dropEl = (el?.closest?.("[data-dnd-drop='1']") as HTMLElement | null) ?? null;

      let nextTarget:
        | null
        | { layoutId: string; standId: string; rowKey: string; intent: "move" | "bump"; bumpedEventId?: string } = null;

      // Цель (строка) берём по тому, где находится курсор, а вот "вытеснение" будем определять ОТ GHOST.
      // Поэтому здесь от barEl мы используем только rowKey/layout/stand (не bump).
      if (barEl) {
        const rowEl = (barEl.closest?.("[data-dnd-drop='1']") as HTMLElement | null) ?? null;
        const layoutId = rowEl?.dataset?.layoutId ?? "";
        const standId = rowEl?.dataset?.standId ?? "";
        const rowKey = rowEl?.dataset?.rowKey ?? "";
        if (layoutId && standId && rowKey) {
          nextTarget = { layoutId, standId, rowKey, intent: "move" };
        }
      }

      if (!nextTarget && dropEl) {
        const layoutId = dropEl.dataset?.layoutId ?? "";
        const standId = dropEl.dataset?.standId ?? "";
        const rowKey = dropEl.dataset?.rowKey ?? "";
        if (layoutId && standId && rowKey) {
          nextTarget = { layoutId, standId, rowKey, intent: "move" };
        }
      }

      ptrTargetRef.current = nextTarget;
      setPtrTarget(nextTarget);
      if (nextTarget) {
        if (dndHoverKey !== nextTarget.rowKey) setDndHoverKey(nextTarget.rowKey);
        if (dndHoverIntent !== nextTarget.intent) setDndHoverIntent(nextTarget.intent);
        // список конфликтующих баров рассчитываем отдельно (от ghost), здесь только сброс
        if (nextTarget.intent !== "bump" && dndHoverBarIds.length) setDndHoverBarIds([]);
      } else {
        if (dndHoverKey) setDndHoverKey(null);
        if (dndHoverBarIds.length) setDndHoverBarIds([]);
        if (dndHoverIntent) setDndHoverIntent(null);
      }

      // --- предпросмотр по времени (ghost) ---
      const d = ptrDrag;
      if (!d) return;
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      const startedNow = d.started || Math.hypot(dx, dy) >= 3;
      if (startedNow && !d.started) setPtrDrag({ ...d, started: true });
      if (!startedNow) return;

      if (nextTarget) {
        const right = bodyScrollRef.current;
        const inner = right?.querySelector?.(".ganttRightInner") as HTMLElement | null;
        const rect = inner?.getBoundingClientRect();
        const scrollLeft = right ? right.scrollLeft : 0;
        if (rect) {
          const px = e.clientX - rect.left + scrollLeft;
          const msPerPx = (24 * 60 * 60 * 1000) / dayWidth;
          const snapMs = 15 * 60 * 1000;
          const snap = (ms: number) => Math.round(ms / snapMs) * snapMs;

          let startMs = d.origStartMs;
          let endMs = d.origEndMs;
          if (d.mode === "move") {
            const newLeftPx = px - d.grabOffsetPx;
            startMs = snap(from.valueOf() + newLeftPx * msPerPx);
            endMs = startMs + (d.origEndMs - d.origStartMs);
          } else if (d.mode === "resizeR") {
            endMs = snap(from.valueOf() + px * msPerPx);
            if (endMs <= startMs + snapMs) endMs = startMs + snapMs;
          } else if (d.mode === "resizeL") {
            startMs = snap(from.valueOf() + px * msPerPx);
            if (startMs >= endMs - snapMs) startMs = endMs - snapMs;
          }
          const g = calcBarXW({
            startAt: new Date(startMs).toISOString(),
            endAt: new Date(endMs).toISOString(),
            from,
            dayWidth,
            canvasWidth
          });
          if (g) {
            const pv = { startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(), x: g.x, w: g.w };

            // Определяем "вытеснение" по GHOST: если период ghost пересекается с любыми событиями на целевой строке
            // (кроме перетаскиваемого), то intent=bump и подсвечиваем все такие события.
            const pvStart = startMs;
            const pvEnd = endMs;
            const targetRowKey = nextTarget.rowKey;
            const row = (hangarStandRowsRef.current ?? []).find((r: any) => r?.key === targetRowKey);
            const bumped: Array<{ id: string; startMs: number }> = [];
            if (row && row.kind === "stand") {
              for (const it of row.events) {
                const ev = it.ev;
                if (ev.id === d.eventId) continue;
                const s = dayjs(ev.startAt).valueOf();
                const en = dayjs(ev.endAt).valueOf();
                if (s < pvEnd && en > pvStart) {
                  bumped.push({ id: ev.id, startMs: s });
                }
              }
            }

            bumped.sort((a, b) => a.startMs - b.startMs);
            const bumpedIds = bumped.map((x) => x.id);

            if (bumpedIds.length) {
              if (nextTarget.intent !== "bump") {
                nextTarget = { ...nextTarget, intent: "bump" };
                ptrTargetRef.current = nextTarget;
                setPtrTarget(nextTarget);
                setDndHoverIntent("bump");
              }
              if (
                bumpedIds.length !== dndHoverBarIds.length ||
                bumpedIds.some((id, idx) => id !== dndHoverBarIds[idx])
              ) {
                setDndHoverBarIds(bumpedIds);
              }
            } else {
              if (nextTarget.intent !== "move") {
                nextTarget = { ...nextTarget, intent: "move" };
                ptrTargetRef.current = nextTarget;
                setPtrTarget(nextTarget);
                setDndHoverIntent("move");
              }
              if (dndHoverBarIds.length) setDndHoverBarIds([]);
            }

            ptrPreviewRef.current = pv;
            setPtrPreview(pv);
            return;
          }
        }
      }
      ptrPreviewRef.current = null;
      setPtrPreview(null);
    };

    const onUp = () => {
      const d = ptrDrag;
      const t = ptrTargetRef.current;
      setPtrDrag(null);
      setDraggingEventId(null);
      const preview = ptrPreviewRef.current;
      ptrPreviewRef.current = null;
      ptrTargetRef.current = null;
      setPtrPreview(null);
      setPtrTarget(null);

      if (!d?.started) return;
      if (!t) return;
      if (!preview) return;

      // размещение с временем
      setPendingDnd({
        eventId: d.eventId,
        layoutId: t.layoutId,
        standId: t.standId,
        bumpOnConflict: t.intent === "bump",
        startAt: preview.startAt,
        endAt: preview.endAt
      } as any);
      setPendingSave("dndMove");
      setDndNotice(null);
      setChangeReason("");
      setConfirmOpen(true);
    };

    // while dragging: disable selection
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });

    return () => {
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", onMove as any);
      window.removeEventListener("pointerup", onUp as any);
    };
  }, [dndActive, ptrDrag, ptrTarget, dndHoverKey, dndHoverBarIds, dndHoverIntent]);

  const addTowM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Сначала сохраните событие");
      if (!pendingTow || pendingTow.kind !== "add") throw new Error("Нет данных буксировки");
      return await apiPost(`/api/events/${draft.id}/tows`, {
        startAt: pendingTow.startAt,
        endAt: pendingTow.endAt,
        changeReason: changeReason.trim()
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId] });
      await qc.invalidateQueries({ queryKey: ["event-tows", draft?.id ?? ""] });
      await qc.invalidateQueries({ queryKey: ["event-history", draft?.id ?? ""] });
      setConfirmOpen(false);
      setPendingSave(null);
      setPendingTow(null);
      setChangeReason("");
    }
  });

  const delTowM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Нет события");
      if (!pendingTow || pendingTow.kind !== "del") throw new Error("Не выбрана буксировка");
      const cr = encodeURIComponent(changeReason.trim());
      return await apiDelete(`/api/events/${draft.id}/tows/${pendingTow.towId}?changeReason=${cr}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId] });
      await qc.invalidateQueries({ queryKey: ["event-tows", draft?.id ?? ""] });
      await qc.invalidateQueries({ queryKey: ["event-history", draft?.id ?? ""] });
      setConfirmOpen(false);
      setPendingSave(null);
      setPendingTow(null);
      setChangeReason("");
    }
  });

  const dndMoveM = useMutation({
    mutationFn: async () => {
      if (!pendingDnd) throw new Error("Нет данных переноса");
      const hasTime = (pendingDnd as any).startAt && (pendingDnd as any).endAt;
      const path = hasTime ? "/api/reservations/dnd-place" : "/api/reservations/dnd-move";
      return await apiPost<{ ok: boolean; bumpedEventIds: string[] }>(path, {
        ...pendingDnd,
        bumpOnConflict: pendingDnd.bumpOnConflict,
        changeReason: changeReason.trim()
      });
    },
    onSuccess: async (res: any) => {
      await qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId] });
      if (draft?.id) await qc.invalidateQueries({ queryKey: ["event-history", draft.id] });
      for (const id of res?.bumpedEventIds ?? []) {
        await qc.invalidateQueries({ queryKey: ["event-history", String(id)] });
      }
      setConfirmOpen(false);
      setPendingSave(null);
      setPendingDnd(null);
      setDraggingEventId(null);
      setDndHoverKey(null);
      setDndHoverBarIds([]);
      setDndHoverIntent(null);
      const bumped = (res?.bumpedEventIds ?? []).length;
      setDndNotice(bumped ? `Перенос выполнен. Вытеснено событий: ${bumped}.` : "Перенос выполнен.");
      setChangeReason("");
    }
  });

  // подсказка при активном pointer-drag
  useEffect(() => {
    if (!dndActive) return;
    if (!ptrDrag) return;
    setDraggingEventId(ptrDrag.eventId);
  }, [dndActive, ptrDrag]);

  // В режиме "Ангар/Место" строки строим ТОЛЬКО по фактическим событиям:
  // - "Без ангара/места" (если есть такие события)
  // - "<Ангар> / Без места" (если есть события с ангаром, но без резерва)
  // - "<Ангар> / <код места>" (если есть резервы на этом месте)
  const hangarStandRows = useMemo(() => {
    if (groupMode !== "HANGAR_STAND") return [];

    const getHangarId = (e: EventRow) => (e.hangar as any)?.id ?? (e.layout as any)?.hangarId ?? "";
    const getHangarName = (e: EventRow) => (e.hangar as any)?.name ?? "Ангар";
    const getStandId = (e: EventRow) => (e.reservation?.stand as any)?.id ?? "";
    const getStandCode = (e: EventRow) => (e.reservation?.stand as any)?.code ?? "";

    const inSelected = (e: EventRow) => {
      if (selectedHangarId === "ALL") return true;
      const hid = getHangarId(e);
      const isUnassigned = !hid && !e.reservation?.stand;
      return hid === selectedHangarId || isUnassigned;
    };

    const visible = events.filter(inSelected);

    const unassigned = visible.filter((e) => !getHangarId(e) && !e.reservation?.stand);

    const noStandByHangar = new Map<string, { hangarId: string; hangarName: string; events: EventRow[] }>();
    const byStandId = new Map<string, { standId: string; layoutId: string; hangarId: string; label: string; events: EventRow[] }>();

    for (const e of visible) {
      const hid = getHangarId(e);
      const hname = getHangarName(e);

      if (hid && !e.reservation?.stand) {
        const key = hid;
        const rec = noStandByHangar.get(key) ?? { hangarId: hid, hangarName: hname, events: [] as EventRow[] };
        rec.events.push(e);
        noStandByHangar.set(key, rec);
        continue;
      }

      const sid = getStandId(e);
      const scode = getStandCode(e);
      if (hid && sid) {
        const meta = dndStandById.get(sid);
        const layoutId = meta?.layoutId ?? String((e.layout as any)?.id ?? "");
        const hangarId = meta?.hangarId ?? hid;
        const label = meta ? `${meta.hangarName} / ${meta.code}` : `${hname} / ${scode}`;
        const rec = byStandId.get(sid) ?? { standId: sid, layoutId, hangarId, label, events: [] as EventRow[] };
        rec.events.push(e);
        byStandId.set(sid, rec);
      }
    }

    type Row = {
      key: string;
      label: string;
      kind: "unassigned" | "hangarNoStand" | "stand";
      hangarId?: string;
      layoutId?: string;
      standId?: string;
      events: EventRow[];
    };

    const rows: Row[] = [];

    if (unassigned.length > 0) {
      rows.push({ key: "unassigned", label: "Без ангара/места", kind: "unassigned", events: unassigned });
    }

    // Стабильная сортировка: по имени ангара, затем по коду места
    const hangarList = Array.from(noStandByHangar.entries())
      .map(([hid, v]) => ({ hid, hangarName: v.hangarName, events: v.events }))
      .sort((a, b) => a.hangarName.localeCompare(b.hangarName, "ru"));

    for (const h of hangarList) {
      rows.push({ key: `hangar:${h.hid}:no-stand`, label: `${h.hangarName} / Без места`, kind: "hangarNoStand", hangarId: h.hid, events: h.events });
    }

    // Добавим пустые стоянки как drop-зоны только в режиме DnD
    if (dndActive) {
      for (const s of dndStandsQ.data ?? []) {
        if (!byStandId.has(s.id)) {
          byStandId.set(s.id, {
            standId: s.id,
            layoutId: s.layoutId,
            hangarId: s.hangarId,
            label: `${s.hangarName} / ${s.code}`,
            events: []
          });
        }
      }
    }

    const standList = Array.from(byStandId.values()).sort((a, b) => a.label.localeCompare(b.label, "ru"));
    for (const s of standList) {
      rows.push({
        key: `stand:${s.hangarId}|${s.standId}`,
        label: s.label,
        kind: "stand",
        hangarId: s.hangarId,
        layoutId: s.layoutId,
        standId: s.standId,
        events: s.events
      });
    }

    const laneRows: Array<{ key: string; label: string; kind: Row["kind"]; hangarId?: string; layoutId?: string; standId?: string; events: PlacedEvent[] }> = [];
    for (const r of rows) {
      if (r.events.length === 0) {
        // пустая строка — drop-зона
        laneRows.push({ key: `${r.key}:lane:0`, label: r.label, kind: r.kind, hangarId: r.hangarId, layoutId: r.layoutId, standId: r.standId, events: [] });
      } else {
        const lanes = packOverlapsIntoLanes(r.events);
        for (let i = 0; i < lanes.length; i++) {
          const label = i === 0 ? r.label : `${r.label} (нахлёст)`;
          laneRows.push({ key: `${r.key}:lane:${i}`, label, kind: r.kind, hangarId: r.hangarId, layoutId: r.layoutId, standId: r.standId, events: lanes[i]! });
        }
      }
    }

    return laneRows;
  }, [groupMode, selectedHangarId, events, dndActive, dndStandsQ.data, dndStandById]);

  // чтобы DnD-логика могла читать строки без "used before declaration"
  useEffect(() => {
    hangarStandRowsRef.current = hangarStandRows as any[];
  }, [hangarStandRows]);

  const visibleEvents = useMemo(() => {
    if (selectedHangarId === "ALL") return events;
    const getHangarId = (e: EventRow) => (e.hangar as any)?.id ?? (e.layout as any)?.hangarId ?? "";
    // оставим "без ангара/места" даже при выборе ангара (как и в режиме Ангар/место)
    return events.filter((e) => {
      const hid = getHangarId(e);
      const isUnassigned = !hid;
      return hid === selectedHangarId || isUnassigned;
    });
  }, [events, selectedHangarId]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="row">
          <strong>План (диаграмма Гантта)</strong>
          <span className="muted">
            Период: {dayjs.utc(rangeFromApplied).format("DD.MM.YYYY")} – {dayjs.utc(rangeToApplied).format("DD.MM.YYYY")}
          </span>
          <span style={{ flex: "1 1 auto" }} />
          <button className="btn btnPrimary" onClick={openEditorForNew}>
            Создать событие
          </button>
        </div>

        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="row">
            <span className="muted">группировка</span>
            <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)}>
              <option value="AIRCRAFT">Борт / событие</option>
              <option value="HANGAR_STAND">Ангар / место</option>
            </select>
          </label>

          <label className="row">
            <span className="muted">ангар</span>
            <select value={selectedHangarId} onChange={(e) => setSelectedHangarId(e.target.value)}>
              <option value="ALL">все</option>
              {(hangarsQ.data ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>

          <label className="row" title={canDnd ? "Режим перетаскивания событий по стоянкам" : "Доступно только ADMIN/PLANNER"}>
            <span className="muted">drag&drop</span>
            <input
              type="checkbox"
              checked={dndEnabled}
              onChange={(e) => {
                const v = e.target.checked;
                setDndEnabled(v);
                // чтобы пользователю не казалось, что "ничего не произошло"
                if (v && groupMode !== "HANGAR_STAND") setGroupMode("HANGAR_STAND");
              }}
              disabled={!canDnd}
            />
          </label>

          <label className="row">
            <span className="muted">тип ВС</span>
            <select
              value={filterAircraftTypeId}
              onChange={(e) => {
                setFilterAircraftTypeId(e.target.value);
                setFilterAircraftId("");
              }}
              style={{ minWidth: 240 }}
            >
              <option value="">все</option>
              {(aircraftTypesQ.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.icaoType ? `${t.icaoType} • ${t.name}` : t.name}
                </option>
              ))}
            </select>
          </label>

          <label className="row">
            <span className="muted">борт</span>
            <select value={filterAircraftId} onChange={(e) => setFilterAircraftId(e.target.value)} style={{ minWidth: 190 }}>
              <option value="">все</option>
              {(aircraftQ.data ?? [])
                .filter((a: any) => (!filterAircraftTypeId ? true : String(a.typeId ?? "") === filterAircraftTypeId))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.tailNumber}
                  </option>
                ))}
            </select>
          </label>

          <label className="row">
            <span className="muted">c</span>
            <input
              type="date"
              value={rangeFromInput}
              onChange={(e) => {
                const v = e.target.value;
                setRangeFromInput(v);
                if (!isValidDateInput(v)) return;
                if (dayjs(v).isAfter(dayjs(rangeToApplied))) {
                  setRangeToInput(v);
                  setRangeToApplied(v);
                }
                setRangeFromApplied(v);
                setRangeError(null);
              }}
              style={{ width: 180 }}
            />
          </label>

          <label className="row">
            <span className="muted">по</span>
            <input
              type="date"
              value={rangeToInput}
              onChange={(e) => {
                const v = e.target.value;
                setRangeToInput(v);
                if (!isValidDateInput(v)) return;
                if (dayjs(v).isBefore(dayjs(rangeFromApplied))) {
                  setRangeFromInput(v);
                  setRangeFromApplied(v);
                }
                setRangeToApplied(v);
                setRangeError(null);
              }}
              style={{ width: 180 }}
            />
          </label>

          <button className="btn" onClick={resetFilters} title="Очистить фильтры и сбросить период">
            Сбросить фильтры
          </button>
        </div>

        {dndEnabled && !dndActive ? (
          <div className="muted" style={{ marginTop: 2 }}>
            Drag&Drop активируется только в режиме группировки <strong>«Ангар / место»</strong>. Переключаю автоматически при включении.
          </div>
        ) : null}
        {/* Убрали текстовую подсказку "перенос/вытеснение", чтобы не было прыжка UI во время DnD */}
        {dndNotice ? (
          <div className="muted" style={{ marginTop: 2 }}>
            {dndNotice}
          </div>
        ) : null}

        {rangeError ? (
          <div className="error" style={{ marginTop: 2 }}>
            {rangeError}
          </div>
        ) : null}
        {q.isFetching ? (
          <div className="muted" style={{ marginTop: 2 }}>
            Загрузка…
          </div>
        ) : null}
        {q.error ? (
          <div className="error" style={{ marginTop: 2 }}>
            {String(q.error.message || q.error)}
          </div>
        ) : null}

        <div className="row" style={{ gap: 14 }}>
          <span className="muted">Легенда:</span>
          <span className="row">
            <span
              className="legendBar"
              style={{ background: "#f59e0b", border: "1px solid rgba(15, 23, 42, 0.22)" }}
            />
            цвет — тип ВС (оператор+тип)
          </span>
          <span className="row">
            <span className="legendBar" style={{ background: "#f59e0b", border: "2px dashed rgba(15, 23, 42, 0.35)", opacity: 0.78 }} />
            черновик/запланировано (рамка)
          </span>
          <span className="row">
            <span className="legendBar" style={{ background: "#f59e0b", border: "1px solid rgba(15, 23, 42, 0.22)" }} />
            подтверждено/в работе
          </span>
          <span className="row">
            <span className="legendBar" style={{ background: "#f59e0b", border: "2px solid rgba(34, 197, 94, 0.95)" }} />
            завершено
          </span>
          <span className="row">
            <span className="legendBar" style={{ background: "rgba(148, 163, 184, 0.85)", border: "1px solid rgba(100, 116, 139, 0.9)" }} />
            отменено
          </span>
          <span className="row">
            <span className="legendBar" style={{ background: "rgba(220, 38, 38, 0.35)", borderRadius: 2, width: 10 }} />
            сегодня
          </span>
          <span className="row">
            <span className="legendBar" style={{ background: "rgba(239, 68, 68, 0.95)", border: "2px solid rgba(255,255,255,0.9)" }} />
            буксировка (разрыв)
          </span>
          <span className="row">
            <span
              className="legendBar"
              style={{
                backgroundColor: "rgba(220, 38, 38, 0.30)",
                backgroundImage:
                  "repeating-linear-gradient(135deg, rgba(220,38,38,0.55) 0px, rgba(220,38,38,0.55) 6px, rgba(220,38,38,0) 6px, rgba(220,38,38,0) 12px)"
              }}
            />
            нахлёст по месту/ангару
          </span>
        </div>
      </div>

      <div className="ganttGrid">
        <div className="ganttHeaderRow">
          <div className="ganttLabel">
            <strong>{groupMode === "AIRCRAFT" ? "Борт / событие" : "Ангар / место"}</strong>
          </div>
          <div className="ganttHeaderRightViewport" ref={headerViewportRef}>
            <div className="ganttCanvas" style={{ width: canvasWidth, height: 44 }}>
              <TodayLine from={from} to={to} canvasWidth={canvasWidth} />
              <div style={{ position: "absolute", inset: 0, display: "flex" }}>
                {Array.from({ length: days }).map((_, i) => {
                  const d = from.add(i, "day");
                  const isMonthStart = d.date() === 1;
                  const showYear = i === 0 || isMonthStart;
                  return (
                    <div
                      key={i}
                      style={{
                        width: dayWidth,
                        borderRight: "1px solid rgba(148,163,184,0.18)",
                        background: isMonthStart ? "rgba(37,99,235,0.06)" : "transparent",
                        padding: "2px 4px"
                      }}
                      title={d.format("DD.MM.YYYY")}
                    >
                      <div className="ganttDayCell">
                        <div className="ganttDayYear">{showYear ? d.format("YYYY") : ""}</div>
                        <div className="ganttDayMonth">{isMonthStart ? d.format("MMM") : ""}</div>
                        <div className="ganttDayNum">{d.format("D")}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="ganttBody">
          <div className="ganttLeftCol">
            {groupMode === "AIRCRAFT"
              ? visibleEvents.map((ev) => (
                  <div className="ganttLabel" key={ev.id}>
                    <div>
                      <strong>{ev.aircraft.tailNumber}</strong> <span className="muted">({ev.level})</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {formatRowLabel(ev) || ev.title}
                    </div>
                  </div>
                ))
              : hangarStandRows.map((r) => (
                  <div className="ganttLabel" key={r.key}>
                    <div>
                      <strong>{r.label}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }} />
                  </div>
                ))}
          </div>

          <div className="ganttRightCol">
            <div className="ganttRightScroll" ref={bodyScrollRef} onScroll={onBodyScroll}>
              <div className="ganttRightInner" style={{ width: canvasWidth }}>
                {groupMode === "AIRCRAFT"
                  ? visibleEvents.map((ev) => {
                      const g = calcBarXW({ startAt: ev.startAt, endAt: ev.endAt, from, dayWidth, canvasWidth });
                      if (!g) return null;
                      const { x, w } = g;
                      const color = aircraftTypeMarkColor(ev, aircraftPaletteMap);
                      const visual = barVisualStyle(ev.status, color);

                      return (
                        <div className="ganttCanvas" key={ev.id} style={{ width: canvasWidth }}>
                          <TodayLine from={from} to={to} canvasWidth={canvasWidth} />
                      <div
                        className="bar"
                        style={{
                          left: x,
                          width: w,
                          cursor: "pointer",
                          ...visual
                        }}
                        onClick={() => openEditorForExisting(ev)}
                        title={`${ev.title}\n${dayjs(ev.startAt).format("DD.MM.YYYY HH:mm")} – ${dayjs(ev.endAt).format(
                          "DD.MM.YYYY HH:mm"
                        )}\nНажмите, чтобы редактировать`}
                      >
                        {renderTowBreaks({ ev, barX: x, barW: w, from, dayWidth, canvasWidth })}
                        <span style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>{ev.title}</span>
                      </div>
                        </div>
                      );
                    })
                  : hangarStandRows.map((r) => (
                      <div
                        className="ganttCanvas"
                        key={r.key}
                        style={{
                          width: canvasWidth,
                          outline:
                            dndActive && dndHoverKey === r.key && dndHoverIntent === "move"
                              ? "2px solid rgba(37, 99, 235, 0.55)"
                              : undefined,
                          outlineOffset: -2
                        }}
                        data-dnd-drop={dndActive && r.kind === "stand" && r.standId && r.layoutId ? "1" : undefined}
                        data-row-key={r.key}
                        data-stand-id={r.standId ?? ""}
                        data-layout-id={r.layoutId ?? ""}
                      >
                        <TodayLine from={from} to={to} canvasWidth={canvasWidth} />
                        {dndActive && ptrPreview && ptrTarget?.rowKey === r.key ? (
                          <div
                            className="bar"
                            style={{
                              left: ptrPreview.x,
                              width: ptrPreview.w,
                              position: "absolute",
                              top: 6,
                              height: 32,
                              background: "rgba(37, 99, 235, 0.18)",
                              border: "2px dashed rgba(37, 99, 235, 0.65)",
                              boxSizing: "border-box",
                              pointerEvents: "none",
                              zIndex: 2
                            }}
                            title={`Предпросмотр: ${dayjs(ptrPreview.startAt).format("DD.MM.YYYY HH:mm")} – ${dayjs(ptrPreview.endAt).format(
                              "DD.MM.YYYY HH:mm"
                            )}`}
                          />
                        ) : null}
                        {r.events.map((p) => {
                          const ev = p.ev;
                          const g = calcBarXW({ startAt: ev.startAt, endAt: ev.endAt, from, dayWidth, canvasWidth });
                          if (!g) return null;
                          const { x, w } = g;
                          const color = aircraftTypeMarkColor(ev, aircraftPaletteMap);
                          const visual = barVisualStyle(ev.status, color);

                          let overlapOverlay: React.ReactNode = null;
                          if (p.overlapToMs) {
                            const oEnd = dayjs.utc(p.overlapToMs);
                            const overlapSeg = calcBarXW({
                              startAt: ev.startAt,
                              endAt: oEnd.toISOString(),
                              from,
                              dayWidth,
                              canvasWidth
                            });
                            const overlayLeft = overlapSeg ? clamp(overlapSeg.x - x, 0, w) : 0;
                            const rawOverlayWidth = overlapSeg ? overlapSeg.w : 0;
                            const overlayWidth = clamp(rawOverlayWidth, 0, w - overlayLeft);
                            if (overlayWidth > 0) {
                              overlapOverlay = (
                                <div
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    bottom: 0,
                                    left: overlayLeft,
                                    width: overlayWidth,
                                    backgroundColor: "rgba(220, 38, 38, 0.30)",
                                    backgroundImage:
                                      "repeating-linear-gradient(135deg, rgba(220,38,38,0.55) 0px, rgba(220,38,38,0.55) 6px, rgba(220,38,38,0) 6px, rgba(220,38,38,0) 12px)",
                                  zIndex: 0,
                                  pointerEvents: "none"
                                  }}
                                  title="Нахлёст"
                                />
                              );
                            }
                          }

                          return (
                            <div
                              key={ev.id}
                              className="bar"
                              style={{
                                left: x,
                                width: w,
                                cursor: dndActive ? "grab" : "pointer",
                                ...visual,
                                outline:
                                  dndActive && dndHoverBarIds.includes(ev.id) && dndHoverIntent === "bump"
                                    ? "2px solid rgba(239, 68, 68, 0.95)"
                                    : undefined,
                                outlineOffset: 0
                              }}
                              data-dnd-bar={dndActive ? "1" : undefined}
                              data-event-id={ev.id}
                              onPointerDown={(e) => {
                                if (!dndActive) return;
                                if (e.button !== 0) return;
                                e.preventDefault();
                                e.stopPropagation();
                                setPtrTarget(null);
                                setDndHoverKey(null);
                                setDndHoverBarIds([]);
                                setDndHoverIntent(null);
                                const right = bodyScrollRef.current;
                                const inner = right?.querySelector?.(".ganttRightInner") as HTMLElement | null;
                                const rect = inner?.getBoundingClientRect();
                                const scrollLeft = right ? right.scrollLeft : 0;
                                const px = rect ? e.clientX - rect.left + scrollLeft : x;

                                const barRect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                const offsetInBar = e.clientX - barRect.left;
                                const edgePx = 8;
                                const mode: "move" | "resizeL" | "resizeR" =
                                  offsetInBar <= edgePx ? "resizeL" : offsetInBar >= barRect.width - edgePx ? "resizeR" : "move";

                                ptrPreviewRef.current = null;
                                setPtrPreview(null);
                                setPtrDrag({
                                  eventId: ev.id,
                                  mode,
                                  started: false,
                                  startClientX: e.clientX,
                                  startClientY: e.clientY,
                                  grabOffsetPx: Math.max(0, px - x),
                                  origStartMs: dayjs(ev.startAt).valueOf(),
                                  origEndMs: dayjs(ev.endAt).valueOf()
                                });
                              }}
                              onClick={() => {
                                // В режиме DnD клик не должен открывать карточку
                                if (dndActive) return;
                                openEditorForExisting(ev);
                              }}
                              title={`${ev.aircraft.tailNumber} • ${ev.title}\n${dayjs(ev.startAt).format("DD.MM.YYYY HH:mm")} – ${dayjs(
                                ev.endAt
                              ).format("DD.MM.YYYY HH:mm")}\nНажмите, чтобы редактировать`}
                            >
                              {/* Ручки ресайза (чтобы "по краям" работало стабильно) */}
                              {dndActive ? (
                                <>
                                  <div
                                    style={{
                                      position: "absolute",
                                      left: 0,
                                      top: 0,
                                      bottom: 0,
                                      width: 10,
                                      cursor: "ew-resize",
                                      zIndex: 3,
                                      pointerEvents: "auto"
                                    }}
                                    onPointerDown={(e) => {
                                      if (e.button !== 0) return;
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setPtrTarget(null);
                                      setDndHoverKey(null);
                                      setDndHoverBarIds([]);
                                      setDndHoverIntent(null);
                                      const right = bodyScrollRef.current;
                                      const inner = right?.querySelector?.(".ganttRightInner") as HTMLElement | null;
                                      const rect = inner?.getBoundingClientRect();
                                      const scrollLeft = right ? right.scrollLeft : 0;
                                      const px = rect ? e.clientX - rect.left + scrollLeft : x;
                                      ptrPreviewRef.current = null;
                                      setPtrPreview(null);
                                      setPtrDrag({
                                        eventId: ev.id,
                                        mode: "resizeL",
                                        started: false,
                                        startClientX: e.clientX,
                                        startClientY: e.clientY,
                                        grabOffsetPx: Math.max(0, px - x),
                                        origStartMs: dayjs(ev.startAt).valueOf(),
                                        origEndMs: dayjs(ev.endAt).valueOf()
                                      });
                                    }}
                                    title="Потяните, чтобы изменить начало"
                                  />
                                  <div
                                    style={{
                                      position: "absolute",
                                      right: 0,
                                      top: 0,
                                      bottom: 0,
                                      width: 10,
                                      cursor: "ew-resize",
                                      zIndex: 3,
                                      pointerEvents: "auto"
                                    }}
                                    onPointerDown={(e) => {
                                      if (e.button !== 0) return;
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setPtrTarget(null);
                                      setDndHoverKey(null);
                                      setDndHoverBarIds([]);
                                      setDndHoverIntent(null);
                                      const right = bodyScrollRef.current;
                                      const inner = right?.querySelector?.(".ganttRightInner") as HTMLElement | null;
                                      const rect = inner?.getBoundingClientRect();
                                      const scrollLeft = right ? right.scrollLeft : 0;
                                      const px = rect ? e.clientX - rect.left + scrollLeft : x;
                                      ptrPreviewRef.current = null;
                                      setPtrPreview(null);
                                      setPtrDrag({
                                        eventId: ev.id,
                                        mode: "resizeR",
                                        started: false,
                                        startClientX: e.clientX,
                                        startClientY: e.clientY,
                                        grabOffsetPx: Math.max(0, px - x),
                                        origStartMs: dayjs(ev.startAt).valueOf(),
                                        origEndMs: dayjs(ev.endAt).valueOf()
                                      });
                                    }}
                                    title="Потяните, чтобы изменить конец"
                                  />
                                </>
                              ) : null}
                              {overlapOverlay}
                              {renderTowBreaks({ ev, barX: x, barW: w, from, dayWidth, canvasWidth })}
                              <span style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
                                {ev.aircraft.tailNumber} • {ev.title}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
              </div>
            </div>
          </div>
        </div>

        {q.isLoading ? (
          <div style={{ padding: 16 }} className="muted">
            Загрузка…
          </div>
        ) : null}
        {!q.isLoading && events.length === 0 ? (
          <div style={{ padding: 16 }} className="muted">
            Нет событий в выбранном диапазоне.
          </div>
        ) : null}
      </div>

      <Drawer
        open={editorOpen}
        title={draft?.id ? "Редактирование события" : "Новое событие"}
        onClose={() => setEditorOpen(false)}
      >
        {!draft ? (
          <div className="muted">Нет данных формы.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Название</span>
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Уровень</span>
                <select value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value as any })}>
                  <option value="OPERATIONAL">Оперативный</option>
                  <option value="STRATEGIC">Стратегический</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Статус</span>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as any })}>
                  <option value="DRAFT">Черновик</option>
                  <option value="PLANNED">Запланировано</option>
                  <option value="CONFIRMED">Подтверждено</option>
                  <option value="IN_PROGRESS">В работе</option>
                  <option value="DONE">Завершено</option>
                  <option value="CANCELLED">Отменено</option>
                </select>
              </label>
            </div>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                <span className="muted">Борт</span>
                <select value={draft.aircraftId} onChange={(e) => setDraft({ ...draft, aircraftId: e.target.value })}>
                  <option value="">— выберите —</option>
                  {(aircraftQ.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.tailNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                <span className="muted">Тип события</span>
                <select value={draft.eventTypeId} onChange={(e) => setDraft({ ...draft, eventTypeId: e.target.value })}>
                  <option value="">— выберите —</option>
                  {(eventTypesQ.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {draft.aircraftId ? (
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Оператор</span>
                  <input value={selectedAircraft?.operator?.name ?? "—"} readOnly />
                </label>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Тип ВС</span>
                  <input
                    value={
                      selectedAircraft?.type
                        ? `${selectedAircraft.type.icaoType ? `${selectedAircraft.type.icaoType} • ` : ""}${selectedAircraft.type.name}`
                        : "—"
                    }
                    readOnly
                  />
                </label>
              </div>
            ) : null}

            <div className="row" style={{ alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Начало (дата+время)</span>
                <input
                  type="datetime-local"
                  value={draft.startAtLocal}
                  onChange={(e) => setDraft({ ...draft, startAtLocal: e.target.value })}
                  style={{ width: 220 }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Окончание (дата+время)</span>
                <input
                  type="datetime-local"
                  value={draft.endAtLocal}
                  onChange={(e) => setDraft({ ...draft, endAtLocal: e.target.value })}
                  style={{ width: 220 }}
                />
              </label>
            </div>

            <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <strong>Ангар / место</strong>
                <span className="muted">Резервирование места делается отдельно (после сохранения события).</span>
              </div>

              <div className="row" style={{ alignItems: "flex-end" }}>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Ангар</span>
                  <select
                    value={draft.hangarId}
                    onChange={(e) => setDraft({ ...draft, hangarId: e.target.value, layoutId: "", standId: "" })}
                  >
                    <option value="">— не задан —</option>
                    {(hangarsQ.data ?? []).map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Вариант</span>
                  <select
                    value={draft.layoutId}
                    onChange={(e) => setDraft({ ...draft, layoutId: e.target.value, standId: "" })}
                    disabled={!draft.hangarId}
                  >
                    <option value="">— не задан —</option>
                    {(layoutsForEditorQ.data ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="row" style={{ alignItems: "flex-end", marginTop: 8 }}>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Место</span>
                  <select
                    value={draft.standId}
                    onChange={(e) => setDraft({ ...draft, standId: e.target.value })}
                    disabled={!draft.layoutId}
                  >
                    <option value="">— не выбрано —</option>
                    {(standsForEditorQ.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} • {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn"
                  onClick={() => unreserveM.mutate()}
                  disabled={!draft.id || !draft.standId || unreserveM.isPending}
                >
                  Снять резерв
                </button>
                <button
                  className="btn btnPrimary"
                  onClick={() => requestSaveWithReason("reserve")}
                  disabled={!draft.id || reserveM.isPending}
                >
                  Назначить место
                </button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <strong>Буксировки (закатка/выкатка)</strong>
                <span className="muted">Можно добавить несколько интервалов внутри события.</span>
              </div>

              {!draft.id ? (
                <div className="muted">Сначала сохраните событие, затем можно добавлять буксировки.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="row" style={{ alignItems: "flex-end" }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span className="muted">Начало буксировки</span>
                      <input type="datetime-local" value={towStartLocal} onChange={(e) => setTowStartLocal(e.target.value)} style={{ width: 220 }} />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span className="muted">Окончание буксировки</span>
                      <input type="datetime-local" value={towEndLocal} onChange={(e) => setTowEndLocal(e.target.value)} style={{ width: 220 }} />
                    </label>
                    <button className="btn btnPrimary" onClick={() => requestTowAddWithReason()} disabled={addTowM.isPending}>
                      Добавить
                    </button>
                    {addTowM.error ? <span className="error">{String((addTowM.error as any)?.message ?? addTowM.error)}</span> : null}
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    {(towsQ.data ?? []).length === 0 ? (
                      <div className="muted">Буксировок пока нет.</div>
                    ) : (
                      (towsQ.data ?? []).map((t) => (
                        <div
                          key={t.id}
                          className="row"
                          style={{
                            justifyContent: "space-between",
                            border: "1px solid rgba(148,163,184,0.35)",
                            borderRadius: 12,
                            padding: "8px 10px"
                          }}
                        >
                          <div>
                            <strong>{dayjs(t.startAt).format("DD.MM.YYYY HH:mm")}</strong> –{" "}
                            <strong>{dayjs(t.endAt).format("DD.MM.YYYY HH:mm")}</strong>
                          </div>
                          <button className="btn" onClick={() => requestTowDeleteWithReason(t.id)} disabled={delTowM.isPending}>
                            Удалить
                          </button>
                        </div>
                      ))
                    )}
                    {towsQ.isFetching ? <div className="muted">обновление…</div> : null}
                    {towsQ.error ? <div className="error">{String((towsQ.error as any)?.message ?? towsQ.error)}</div> : null}
                  </div>
                </div>
              )}
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Примечание</span>
              <textarea
                rows={4}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>

            <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
              {!draft.id ? (
                <div className="muted">Сначала сохраните событие — затем можно планировать ресурсы и вносить факт.</div>
              ) : (
                <EventResourcesPanel eventId={draft.id} />
              )}
            </div>

            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn btnPrimary" onClick={() => requestSaveWithReason("event")} disabled={saveEventM.isPending}>
                Сохранить событие
              </button>
              {saveEventM.error || reserveM.error || unreserveM.error ? (
                <span className="error">
                  {String((saveEventM.error ?? reserveM.error ?? unreserveM.error)?.message ?? "")}
                </span>
              ) : null}
              {saveEventM.isSuccess ? <span className="muted">Сохранено.</span> : null}
            </div>

            <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <strong>История изменений</strong>
                {historyQ.isFetching ? <span className="muted">обновление…</span> : null}
              </div>
              {historyQ.error ? <div className="error">{String(historyQ.error.message || historyQ.error)}</div> : null}
              {(historyQ.data ?? []).length === 0 ? <div className="muted">История пока пустая.</div> : null}
              <div style={{ display: "grid", gap: 8 }}>
                {(historyQ.data ?? []).map((h) => (
                  <div key={h.id} style={{ border: "1px solid rgba(148,163,184,0.35)", borderRadius: 12, padding: 10 }}>
                    <div className="row">
                      <strong>{h.action}</strong>
                      <span className="muted">{dayjs(h.createdAt).format("DD.MM.YYYY HH:mm")}</span>
                      <span className="muted">• {h.actor}</span>
                    </div>
                    {h.reason ? <div style={{ marginTop: 6 }}><strong>Причина:</strong> {h.reason}</div> : null}
                    {h.changes ? (
                      <div className="muted" style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                        {JSON.stringify(h.changes)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={confirmOpen}
        title="Подтверждение изменения"
        onClose={() => setConfirmOpen(false)}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div className="muted">Перед сохранением опишите, что изменилось и почему (перенос, причина, комментарий).</div>
          <textarea rows={4} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
          <div>
            <strong>Изменения:</strong>
            <div className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, marginTop: 6 }}>
              {JSON.stringify(computeDraftDiff(original, draft))}
            </div>
          </div>
          <div className="row">
            <button
              className="btn btnPrimary"
              disabled={!changeReason.trim()}
              onClick={() => {
                if (pendingSave === "event") saveEventM.mutate();
                if (pendingSave === "reserve") reserveM.mutate();
                if (pendingSave === "towAdd") addTowM.mutate();
                if (pendingSave === "towDel") delTowM.mutate();
                if (pendingSave === "dndMove") dndMoveM.mutate();
              }}
            >
              Сохранить
            </button>
            <button className="btn" onClick={() => setConfirmOpen(false)}>
              Отмена
            </button>
            {saveEventM.error || reserveM.error || addTowM.error || delTowM.error || dndMoveM.error ? (
              <span className="error">
                {String((saveEventM.error ?? reserveM.error ?? addTowM.error ?? delTowM.error ?? dndMoveM.error as any)?.message ?? "")}
              </span>
            ) : null}
          </div>
        </div>
      </Drawer>
    </div>
  );
}

