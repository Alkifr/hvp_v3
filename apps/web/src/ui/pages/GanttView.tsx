import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import * as XLSX from "xlsx";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import { authMe } from "../auth/authApi";
import { EventResourcesPanel } from "../components/EventResourcesPanel";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { useActiveSandbox } from "../components/SandboxSwitcher";

dayjs.extend(utc);

const GANTT_UI_LS_KEY = "hangarPlanning:ganttUi:v1";

const FIELD_LABEL: Record<string, string> = {
  title: "Название",
  level: "Уровень",
  status: "Статус",
  aircraftId: "Борт",
  eventTypeId: "Тип события",
  startAtLocal: "Начало",
  endAtLocal: "Окончание",
  notes: "Примечание",
  hangarId: "Ангар",
  layoutId: "Вариант размещения",
  standId: "Место"
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  PLANNED: "Запланировано",
  CONFIRMED: "Подтверждено",
  IN_PROGRESS: "В работе",
  DONE: "Завершено",
  CANCELLED: "Отменено"
};

const LEVEL_LABEL: Record<string, string> = {
  OPERATIONAL: "Оперативный",
  STRATEGIC: "Стратегический"
};

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
  towSegments?: Array<{ id: string; startAt: string; endAt: string }>;
};

function eventAircraftLabel(ev: EventRow): string {
  return ev.aircraft?.tailNumber ?? ev.virtualAircraft?.label ?? "—";
}

function eventOperatorLabel(ev: EventRow, operatorNameById?: Map<string, string>): string {
  const opId = ev.aircraft?.operatorId ?? ev.aircraft?.operator?.id ?? ev.virtualAircraft?.operatorId ?? "";
  return ev.aircraft?.operator?.name ?? (opId ? operatorNameById?.get(opId) : undefined) ?? "—";
}

function eventAircraftTypeLabel(ev: EventRow, aircraftTypeById?: Map<string, AircraftTypeRef>): string {
  const type = ev.aircraft?.type;
  if (type) return type.icaoType ? `${type.icaoType} • ${type.name}` : type.name;
  const typeId = ev.aircraft?.typeId ?? ev.virtualAircraft?.aircraftTypeId ?? "";
  const fromRef = typeId ? aircraftTypeById?.get(typeId) : null;
  return fromRef ? (fromRef.icaoType ? `${fromRef.icaoType} • ${fromRef.name}` : fromRef.name) : "—";
}

function formatExportDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = dayjs(v);
  return d.isValid() ? d.format("DD.MM.YYYY HH:mm") : "—";
}

function htmlEscape(v: unknown): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function openPrintableDocument(title: string, bodyHtml: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    alert("Не удалось подготовить документ для печати.");
    return;
  }

  doc.open();
  doc.write(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 6px; }
    .meta { color: #475569; font-size: 11px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 5px; vertical-align: top; }
    th { background: #f1f5f9; text-align: left; }
    tr:nth-child(even) td { background: #f8fafc; }
    .ganttSvg { width: 100%; height: auto; border: 1px solid #cbd5e1; border-radius: 8px; }
    .hint { color: #64748b; font-size: 10px; margin-top: 8px; }
  </style>
</head>
<body>
${bodyHtml}
<script>
  window.addEventListener("load", () => {
    setTimeout(() => window.print(), 150);
  });
</script>
</body>
</html>`);
  doc.close();

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 500);
    window.removeEventListener("focus", cleanup);
  };
  win.addEventListener("afterprint", () => iframe.remove(), { once: true });
  window.addEventListener("focus", cleanup);
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
type Layout = { id: string; name: string; hangarId: string; code?: string; capacitySummary?: string };
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

  // минимальная ширина для кликабельности, но без "вылета" за канвас;
  // на очень мелком зуме допускаем меньший минимум, чтобы не раздувать короткие события.
  const minBar = params.dayWidth < 2 ? 3 : 6;
  // визуальный зазор 1 px между примыкающими полосами, чтобы соседние события
  // не сливались (актуально на мелком зуме, где события могут идти встык).
  const desired = Math.max(minBar, visible > minBar ? visible - 1 : visible);
  const w = clamp(desired, minBar, Math.max(minBar, params.canvasWidth - x));
  return { x, w, leftRaw, rightRaw };
}

/** Подбор внутренних отступов .bar в зависимости от фактической ширины. */
function barPaddingStyle(w: number): React.CSSProperties {
  if (w < 12) return { padding: 0 };
  if (w < 36) return { paddingLeft: 2, paddingRight: 2 };
  return {};
}

/** Показывать ли подпись внутри полосы. На узких — только нативный title (tooltip). */
function canShowBarTitle(w: number) {
  return w >= 36;
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

// Образец бара статуса для легенды — использует тот же barVisualStyle,
// что и фактический рендер событий, поэтому легенда всегда синхронна с UI.
function LegendStatus(props: { status: string; baseColor: string; label: string }) {
  const visual = barVisualStyle(props.status, props.baseColor);
  return (
    <span className="ganttLegendItem">
      <span
        className="legendBar legendBarSample"
        aria-hidden="true"
        style={{
          ...visual,
          width: 56,
          height: 16,
          borderRadius: 6,
          boxSizing: "border-box"
        }}
      />
      <span>{props.label}</span>
    </span>
  );
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
  const opId = ev.aircraft?.operatorId ?? ev.aircraft?.operator?.id ?? ev.virtualAircraft?.operatorId ?? "";
  const typeId = ev.aircraft?.typeId ?? ev.aircraft?.type?.id ?? ev.virtualAircraft?.aircraftTypeId ?? "";
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

type ZoomLevel = "hour" | "day" | "week" | "month" | "quarter" | "year";

const ZOOM_ORDER: ZoomLevel[] = ["hour", "day", "week", "month", "quarter", "year"];

const ZOOM_LABEL: Record<ZoomLevel, string> = {
  hour: "час",
  day: "сутки",
  week: "неделя",
  month: "месяц",
  quarter: "квартал",
  year: "год"
};

// ширина "одного дня" в пикселях на разных уровнях зума.
// умный зум: чем крупнее группировка, тем меньше px приходится на 1 день,
// и тем короче общая горизонтальная полоса при том же диапазоне дат.
const ZOOM_PX_PER_DAY: Record<ZoomLevel, number> = {
  hour: 360,     // 15 px / час
  day: 24,
  week: 10,      // ~70 px / неделя
  month: 3,      // ~90 px / месяц
  quarter: 1.1,  // ~100 px / квартал
  year: 0.4      // ~146 px / год
};

type GanttTick = { at: dayjs.Dayjs; minorLabel: string; majorLabel: string | null };

function labelsFor(d: dayjs.Dayjs, zoom: ZoomLevel): { minorLabel: string; majorKey: string; majorLabel: string } {
  switch (zoom) {
    case "hour":
      return { minorLabel: d.format("HH"), majorKey: d.format("YYYY-MM-DD"), majorLabel: d.format("DD MMM YYYY") };
    case "day":
      return { minorLabel: d.format("D"), majorKey: d.format("YYYY-MM"), majorLabel: d.format("MMM YYYY") };
    case "week": {
      const end = d.add(6, "day");
      return {
        minorLabel: `${d.format("D")}–${end.format("D MMM")}`,
        majorKey: d.format("YYYY-MM"),
        majorLabel: d.format("MMM YYYY")
      };
    }
    case "month":
      return { minorLabel: d.format("MMM"), majorKey: d.format("YYYY"), majorLabel: d.format("YYYY") };
    case "quarter": {
      const q = Math.floor(d.month() / 3) + 1;
      return { minorLabel: `Q${q}`, majorKey: d.format("YYYY"), majorLabel: d.format("YYYY") };
    }
    case "year":
      return { minorLabel: d.format("YYYY"), majorKey: "", majorLabel: "" };
  }
}

function buildGanttTicks(from: dayjs.Dayjs, to: dayjs.Dayjs, zoom: ZoomLevel): GanttTick[] {
  const startOfUnit = (d: dayjs.Dayjs): dayjs.Dayjs => {
    switch (zoom) {
      case "hour":
        return d.startOf("hour");
      case "day":
        return d.startOf("day");
      case "week":
        return d.startOf("week");
      case "month":
        return d.startOf("month");
      case "quarter":
        return d.startOf("month").subtract(d.month() % 3, "month");
      case "year":
        return d.startOf("year");
    }
  };

  const out: GanttTick[] = [];
  let cur = startOfUnit(from);
  let lastMajorKey = "";
  const HARD_LIMIT = 5000;

  for (let i = 0; i < HARD_LIMIT && cur.valueOf() < to.valueOf(); i++) {
    const { minorLabel, majorKey, majorLabel } = labelsFor(cur, zoom);
    out.push({
      at: cur,
      minorLabel,
      majorLabel: majorKey !== "" && majorKey !== lastMajorKey ? majorLabel : null
    });
    lastMajorKey = majorKey;
    switch (zoom) {
      case "hour":
        cur = cur.add(1, "hour");
        break;
      case "day":
        cur = cur.add(1, "day");
        break;
      case "week":
        cur = cur.add(1, "week");
        break;
      case "month":
        cur = cur.add(1, "month");
        break;
      case "quarter":
        cur = cur.add(3, "month");
        break;
      case "year":
        cur = cur.add(1, "year");
        break;
    }
  }
  return out;
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

function Drawer(props: {
  open: boolean;
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div className="drawerBackdrop">
      <div className="drawer drawerV2" role="dialog" aria-modal="true" aria-label={props.title}>
        <header className="drawerHeader">
          <div className="drawerHeaderText">
            <div className="drawerTitle">{props.title}</div>
            {props.subtitle ? <div className="drawerSubtitle">{props.subtitle}</div> : null}
          </div>
          <button
            className="drawerCloseBtn"
            onClick={props.onClose}
            aria-label="Закрыть"
            title="Закрыть"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
            <span className="drawerCloseBtnLabel">Закрыть</span>
          </button>
        </header>
        <div className="drawerBody">{props.children}</div>
      </div>
    </div>
  );
}

export function GanttView() {
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => authMe(), retry: 0 });
  const { active: activeSandbox } = useActiveSandbox();
  const me = meQ.data && (meQ.data as any).ok ? (meQ.data as any).user : null;
  const canWriteSandbox = activeSandbox?.myRole === "OWNER" || activeSandbox?.myRole === "EDITOR";
  const canEditEvents = Boolean(me?.permissions?.includes("events:write") || canWriteSandbox);
  const canDnd = Boolean(canWriteSandbox || (me?.permissions?.includes("events:write") && (me?.roles?.includes("ADMIN") || me?.roles?.includes("PLANNER"))));

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
  const [zoom, setZoom] = useState<ZoomLevel>(() => {
    const z = savedUi?.zoom;
    return (ZOOM_ORDER as string[]).includes(String(z)) ? (z as ZoomLevel) : "day";
  });

  const [filterAircraftTypeIds, setFilterAircraftTypeIds] = useState<string[]>(() => {
    const arr = savedUi?.filterAircraftTypeIds;
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    const one = savedUi?.filterAircraftTypeId;
    return one ? [String(one)] : [];
  });
  const [filterAircraftIds, setFilterAircraftIds] = useState<string[]>(() => {
    const arr = savedUi?.filterAircraftIds;
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    const one = savedUi?.filterAircraftId;
    return one ? [String(one)] : [];
  });
  const [filterEventTypeIds, setFilterEventTypeIds] = useState<string[]>(() => {
    const arr = savedUi?.filterEventTypeIds;
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    return [];
  });

  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftTypeRef[]>("/api/ref/aircraft-types")
  });

  const q = useQuery({
    queryKey: ["events", from.toISOString(), to.toISOString()],
    queryFn: () =>
      apiGet<EventRow[]>(
        `/api/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
      ),
    // фильтры типа ВС / борта / ангара применяются на клиенте, т.к. поддерживается мультиселект
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

  // Реальные записи палитры «оператор × тип ВС» для легенды:
  // берём цвета из aircraftPaletteMap, подписи (оператор + тип) собираем из
  // справочников aircraftQ / aircraftTypesQ
  const legendPaletteEntries = useMemo(() => {
    const opNameById = new Map<string, string>();
    for (const a of aircraftQ.data ?? []) {
      if (a.operator?.id && !opNameById.has(a.operator.id)) {
        opNameById.set(a.operator.id, a.operator.name);
      }
    }
    const typeById = new Map<string, AircraftTypeRef>();
    for (const t of aircraftTypesQ.data ?? []) typeById.set(t.id, t);
    const out: Array<{ key: string; color: string; operator: string; type: string }> = [];
    for (const [key, color] of aircraftPaletteMap) {
      const [opId = "", typeId = ""] = key.split("|");
      const t = typeById.get(typeId);
      out.push({
        key,
        color,
        operator: opNameById.get(opId) || "—",
        type: t ? (t.icaoType ? `${t.icaoType} • ${t.name}` : t.name) : "—"
      });
    }
    out.sort((a, b) => `${a.operator} ${a.type}`.localeCompare(`${b.operator} ${b.type}`, "ru"));
    return out;
  }, [aircraftPaletteMap, aircraftQ.data, aircraftTypesQ.data]);

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
  const [selectedHangarIds, setSelectedHangarIds] = useState<string[]>(() => {
    const arr = savedUi?.selectedHangarIds;
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    const legacy = savedUi?.selectedHangarId;
    if (legacy && legacy !== "ALL") return [String(legacy)];
    return [];
  });
  const [dndEnabled, setDndEnabled] = useState<boolean>(() => Boolean(savedUi?.dndEnabled ?? false));

  const resetFilters = () => {
    const rf = dayjs().add(-20, "day").format("YYYY-MM-DD");
    const rt = dayjs().add(30, "day").format("YYYY-MM-DD");

    setFilterAircraftTypeIds([]);
    setFilterAircraftIds([]);
    setFilterEventTypeIds([]);
    setSelectedHangarIds([]);

    setRangeFromInput(rf);
    setRangeToInput(rt);
    setRangeFromApplied(rf);
    setRangeToApplied(rt);
    setRangeError(null);
  };

  const dndActive = dndEnabled && canDnd && groupMode === "HANGAR_STAND";

  const dndStandsQ = useQuery({
    queryKey: ["ref", "dnd-stands", selectedHangarIds.slice().sort().join(",")],
    enabled: dndActive,
    queryFn: async () => {
      // если выбран ровно один ангар — тянем стоянки по нему; иначе всё, а фильтрацию делаем клиентом
      const layouts = await apiGet<Layout[]>(
        selectedHangarIds.length === 1
          ? `/api/ref/layouts?hangarId=${encodeURIComponent(selectedHangarIds[0]!)}`
          : "/api/ref/layouts"
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
      selectedHangarIds,
      filterAircraftTypeIds,
      filterAircraftIds,
      filterEventTypeIds,
      dndEnabled,
      zoom
    });
  }, [
    rangeFromApplied,
    rangeToApplied,
    rangeFromInput,
    rangeToInput,
    groupMode,
    selectedHangarIds,
    filterAircraftTypeIds,
    filterAircraftIds,
    filterEventTypeIds,
    dndEnabled,
    zoom
  ]);

  const events = q.data ?? [];
  const dayWidth = ZOOM_PX_PER_DAY[zoom];
  const canvasWidth = Math.max(1, Math.round(days * dayWidth));
  const ticks = useMemo(() => buildGanttTicks(from, to, zoom), [from, to, zoom]);

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
  // режим копирования: когда включён, клик по событию открывает редактор с предзаполненной
  // копией, а сохранение создаёт НОВОЕ событие (draft.id остаётся пустым)
  const [copySelectMode, setCopySelectMode] = useState(false);
  const [copyFromTitle, setCopyFromTitle] = useState<string | null>(null);

  // ESC — отмена режима выбора копирования
  useEffect(() => {
    if (!copySelectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCopySelectMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelectMode]);

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
    setCopyFromTitle(null);
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
      aircraftId: (ev.aircraft as any)?.id ?? (ev as any).aircraftId ?? "",
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
    setCopyFromTitle(null);
    setEditorOpen(true);
  };

  // Открыть редактор в режиме копирования выбранного события:
  // все данные переносятся, id НЕ копируется (draft.id = undefined),
  // статус сбрасывается в PLANNED, к названию добавляется « (копия)»
  const openEditorForCopy = (ev: EventRow) => {
    const startAtLocal = dayjs(ev.startAt).format("YYYY-MM-DDTHH:mm");
    const endAtLocal = dayjs(ev.endAt).format("YYYY-MM-DDTHH:mm");
    const d: EditorDraft = {
      title: `${ev.title} (копия)`,
      level: ev.level,
      status: "PLANNED",
      aircraftId: (ev.aircraft as any)?.id ?? (ev as any).aircraftId ?? "",
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
    setCopyFromTitle(ev.title);
    setCopySelectMode(false);
    setEditorOpen(true);
  };

  // Унифицированный выбор события: в обычном режиме — редактирование,
  // в режиме копирования — открытие мастера копии.
  const pickEvent = (ev: EventRow) => {
    if (copySelectMode) openEditorForCopy(ev);
    else openEditorForExisting(ev);
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

      const reason = changeReason.trim();
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
        ...(reason ? { changeReason: reason } : {})
      };

      if (!draft.id) {
        const created = await apiPost<EventRow>("/api/events", payload);
        return created;
      }
      const updated = await apiPatch<EventRow>(`/api/events/${draft.id}`, payload);
      return updated;
    },
    onSuccess: (data) => {
      // сначала мгновенно закрываем подтверждение и актуализируем состояние,
      // чтобы у пользователя была быстрая обратная связь.
      const createdId = !draft?.id && (data as any)?.id ? String((data as any).id) : null;
      const nextDraft = createdId && draft ? { ...draft, id: createdId } : draft;
      if (createdId && nextDraft) setDraft(nextDraft);
      if (nextDraft) setOriginal(nextDraft);
      setConfirmOpen(false);
      setPendingSave(null);
      setChangeReason("");
      setCopyFromTitle(null);
      // инвалидируем фоном — не блокируем UI ожиданием рефетча
      void qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString()] });
      const histId = nextDraft?.id;
      if (histId) void qc.invalidateQueries({ queryKey: ["event-history", histId] });
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
    onSuccess: () => {
      setOriginal(draft);
      setConfirmOpen(false);
      setPendingSave(null);
      setChangeReason("");
      void qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString()] });
      if (draft?.id) void qc.invalidateQueries({ queryKey: ["event-history", draft.id] });
    }
  });

  const unreserveM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Нет события");
      return await apiDelete(`/api/reservations/by-event/${draft.id}`);
    },
    onSuccess: () => {
      setDraft((d) => (d ? { ...d, standId: "" } : d));
      setOriginal((o) => (o ? { ...o, standId: "" } : o));
      void qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString()] });
      if (draft?.id) void qc.invalidateQueries({ queryKey: ["event-history", draft.id] });
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
  const [, setDraggingEventId] = useState<string | null>(null);
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
    onSuccess: () => {
      setConfirmOpen(false);
      setPendingSave(null);
      setPendingTow(null);
      setChangeReason("");
      void qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString()] });
      if (draft?.id) {
        void qc.invalidateQueries({ queryKey: ["event-tows", draft.id] });
        void qc.invalidateQueries({ queryKey: ["event-history", draft.id] });
      }
    }
  });

  const delTowM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Нет события");
      if (!pendingTow || pendingTow.kind !== "del") throw new Error("Не выбрана буксировка");
      const cr = encodeURIComponent(changeReason.trim());
      return await apiDelete(`/api/events/${draft.id}/tows/${pendingTow.towId}?changeReason=${cr}`);
    },
    onSuccess: () => {
      setConfirmOpen(false);
      setPendingSave(null);
      setPendingTow(null);
      setChangeReason("");
      void qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString()] });
      if (draft?.id) {
        void qc.invalidateQueries({ queryKey: ["event-tows", draft.id] });
        void qc.invalidateQueries({ queryKey: ["event-history", draft.id] });
      }
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
    onSuccess: (res: any) => {
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
      void qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString()] });
      if (draft?.id) void qc.invalidateQueries({ queryKey: ["event-history", draft.id] });
      for (const id of res?.bumpedEventIds ?? []) {
        void qc.invalidateQueries({ queryKey: ["event-history", String(id)] });
      }
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
      if (selectedHangarIds.length === 0) return true;
      const hid = getHangarId(e);
      const isUnassigned = !hid && !e.reservation?.stand;
      return selectedHangarIds.includes(hid) || isUnassigned;
    };

    const byTypeFilter = (e: EventRow) => {
      if (filterAircraftTypeIds.length === 0) return true;
      const tid =
        (e.aircraft as any)?.typeId ??
        (e.aircraft as any)?.type?.id ??
        (e.virtualAircraft as any)?.aircraftTypeId ??
        "";
      return filterAircraftTypeIds.includes(String(tid));
    };
    const byAircraftFilter = (e: EventRow) => {
      if (filterAircraftIds.length === 0) return true;
      const aid = (e.aircraft as any)?.id ?? (e as any).aircraftId ?? "";
      return filterAircraftIds.includes(String(aid));
    };
    const byEventTypeFilter = (e: EventRow) => {
      if (filterEventTypeIds.length === 0) return true;
      const id = (e.eventType as any)?.id ?? (e as any).eventTypeId ?? "";
      return filterEventTypeIds.includes(String(id));
    };

    const visible = events.filter((e) => inSelected(e) && byTypeFilter(e) && byAircraftFilter(e) && byEventTypeFilter(e));
    const activeVisible = visible.filter((e) => e.status !== "CANCELLED");
    const cancelledVisible = visible.filter((e) => e.status === "CANCELLED");

    const unassigned = activeVisible.filter((e) => !getHangarId(e) && !e.reservation?.stand);

    const noStandByHangar = new Map<string, { hangarId: string; hangarName: string; events: EventRow[] }>();
    const byStandId = new Map<string, { standId: string; layoutId: string; hangarId: string; label: string; events: EventRow[] }>();

    for (const e of activeVisible) {
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
      kind: "unassigned" | "hangarNoStand" | "stand" | "cancelled";
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

    if (cancelledVisible.length > 0) {
      const cancelledLanes = packOverlapsIntoLanes(cancelledVisible);
      for (let i = 0; i < cancelledLanes.length; i++) {
        laneRows.push({
          key: `cancelled:lane:${i}`,
          label: i === 0 ? "Отменено" : "Отменено (нахлёст)",
          kind: "cancelled",
          events: cancelledLanes[i]!
        });
      }
    }

    return laneRows;
  }, [groupMode, selectedHangarIds, filterAircraftTypeIds, filterAircraftIds, filterEventTypeIds, events, dndActive, dndStandsQ.data, dndStandById]);

  // чтобы DnD-логика могла читать строки без "used before declaration"
  useEffect(() => {
    hangarStandRowsRef.current = hangarStandRows as any[];
  }, [hangarStandRows]);

  const exportEvents = useMemo(() => {
    const getHangarId = (e: EventRow) => (e.hangar as any)?.id ?? (e.layout as any)?.hangarId ?? "";
    return events.filter((e) => {
      const hid = getHangarId(e);
      const isUnassigned = !hid;
      const okHangar =
        selectedHangarIds.length === 0 || selectedHangarIds.includes(hid) || isUnassigned;
      const tid =
        (e.aircraft as any)?.typeId ??
        (e.aircraft as any)?.type?.id ??
        (e.virtualAircraft as any)?.aircraftTypeId ??
        "";
      const okType = filterAircraftTypeIds.length === 0 || filterAircraftTypeIds.includes(String(tid));
      const aid = (e.aircraft as any)?.id ?? (e as any).aircraftId ?? "";
      const okAcft = filterAircraftIds.length === 0 || filterAircraftIds.includes(String(aid));
      const eventTypeId = (e.eventType as any)?.id ?? (e as any).eventTypeId ?? "";
      const okEventType = filterEventTypeIds.length === 0 || filterEventTypeIds.includes(String(eventTypeId));
      return okHangar && okType && okAcft && okEventType;
    });
  }, [events, selectedHangarIds, filterAircraftTypeIds, filterAircraftIds, filterEventTypeIds]);

  const visibleEvents = useMemo(() => exportEvents.filter((e) => e.status !== "CANCELLED"), [exportEvents]);

  const cancelledAircraftRows = useMemo(() => {
    if (groupMode !== "AIRCRAFT") return [];
    const cancelled = exportEvents.filter((e) => e.status === "CANCELLED");
    return packOverlapsIntoLanes(cancelled).map((events, i) => ({
      key: `cancelled-aircraft:lane:${i}`,
      label: i === 0 ? "Отменено" : "Отменено (нахлёст)",
      subLabel: "Не участвует в рабочем размещении",
      events
    }));
  }, [groupMode, exportEvents]);

  const aircraftRows = useMemo(
    () => [
      ...visibleEvents.map((ev) => ({
        key: ev.id,
        label: eventAircraftLabel(ev),
        subLabel: formatRowLabel(ev) || ev.title,
        events: [{ ev, overlapToMs: null } as PlacedEvent]
      })),
      ...cancelledAircraftRows
    ],
    [visibleEvents, cancelledAircraftRows]
  );

  const aircraftTypeById = useMemo(() => {
    const m = new Map<string, AircraftTypeRef>();
    for (const t of aircraftTypesQ.data ?? []) m.set(t.id, t);
    return m;
  }, [aircraftTypesQ.data]);

  const operatorNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of aircraftQ.data ?? []) {
      if (a.operator?.id && !m.has(a.operator.id)) m.set(a.operator.id, a.operator.name);
    }
    return m;
  }, [aircraftQ.data]);

  const reportRows = useMemo(() => {
    return [...exportEvents]
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.title.localeCompare(b.title, "ru"))
      .map((ev) => {
        const start = dayjs(ev.startAt);
        const end = dayjs(ev.endAt);
        const durationHours = Math.max(0, end.diff(start, "minute")) / 60;
        const towSegments = ev.towSegments ?? [];
        return {
          "Название": ev.title,
          "Борт": eventAircraftLabel(ev),
          "Оператор": eventOperatorLabel(ev, operatorNameById),
          "Тип ВС": eventAircraftTypeLabel(ev, aircraftTypeById),
          "Тип события": ev.eventType?.name ?? "—",
          "Уровень": LEVEL_LABEL[ev.level] ?? ev.level,
          "Статус": STATUS_LABEL[ev.status] ?? ev.status,
          "Начало": formatExportDate(ev.startAt),
          "Окончание": formatExportDate(ev.endAt),
          "Длительность, часов": Number(durationHours.toFixed(2)),
          "Длительность, дней": Number((durationHours / 24).toFixed(2)),
          "Год начала": start.isValid() ? start.format("YYYY") : "—",
          "Квартал начала": start.isValid() ? `Q${Math.floor(start.month() / 3) + 1}` : "—",
          "Месяц начала": start.isValid() ? start.format("YYYY-MM") : "—",
          "Ангар": ev.hangar?.name ?? "—",
          "Вариант размещения": ev.layout?.name ?? "—",
          "Место": ev.reservation?.stand?.code ?? "—",
          "Есть резерв": ev.reservation?.stand ? "Да" : "Нет",
          "Буксировок": towSegments.length,
          "Интервалы буксировок": towSegments
            .map((t) => `${formatExportDate(t.startAt)} – ${formatExportDate(t.endAt)}`)
            .join("; "),
          "Примечание": String((ev as any).notes ?? ""),
          "ID события": ev.id
        };
      });
  }, [exportEvents, aircraftTypeById, operatorNameById]);

  const exportBaseName = `gantt-${rangeFromApplied}-${rangeToApplied}`;
  const reportMeta = [
    `Период: ${dayjs.utc(rangeFromApplied).format("DD.MM.YYYY")} – ${dayjs.utc(rangeToApplied).format("DD.MM.YYYY")}`,
    `Зум: ${ZOOM_LABEL[zoom]}`,
    `Группировка: ${groupMode === "AIRCRAFT" ? "Борт / событие" : "Ангар / место"}`,
    `Контур: ${activeSandbox ? `песочница «${activeSandbox.name}»` : "рабочий контур"}`,
    `Событий: ${reportRows.length}`
  ];

  const exportTableXlsx = () => {
    if (reportRows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(reportRows);
    ws["!cols"] = Object.keys(reportRows[0] ?? {}).map((key) => ({
      wch: Math.min(42, Math.max(12, key.length + 4))
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "События");
    XLSX.writeFile(wb, `${exportBaseName}-events.xlsx`);
  };

  const exportTablePdf = () => {
    if (reportRows.length === 0) return;
    const columns = Object.keys(reportRows[0] ?? {});
    const header = columns.map((c) => `<th>${htmlEscape(c)}</th>`).join("");
    const body = reportRows
      .map((row) => `<tr>${columns.map((c) => `<td>${htmlEscape((row as any)[c])}</td>`).join("")}</tr>`)
      .join("");
    openPrintableDocument(
      "Отчёт по событиям Гантта",
      `<h1>Отчёт по событиям Гантта</h1>
       <div class="meta">${reportMeta.map(htmlEscape).join(" · ")}</div>
       <table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
       <div class="hint">Для сохранения выберите в диалоге печати «Сохранить в PDF».</div>`
    );
  };

  const exportGanttPdf = () => {
    const rows = groupMode === "AIRCRAFT" ? aircraftRows : hangarStandRows;
    const rowsWithEvents = rows.filter((r) => r.events.length > 0);
    if (rowsWithEvents.length === 0) return;

    const labelW = 210;
    const chartW = 1180;
    const rowH = 30;
    const headerH = 58;
    const height = headerH + rowsWithEvents.length * rowH + 22;
    const width = labelW + chartW + 24;
    const rangeMs = Math.max(1, to.valueOf() - from.valueOf());
    const xFor = (v: string) => labelW + ((dayjs.utc(v).valueOf() - from.valueOf()) / rangeMs) * chartW;
    const tickStep = Math.max(1, Math.ceil(ticks.length / 18));

    const grid = ticks
      .filter((_t, idx) => idx % tickStep === 0)
      .map((t) => {
        const x = labelW + ((t.at.valueOf() - from.valueOf()) / rangeMs) * chartW;
        return `<line x1="${x.toFixed(1)}" y1="36" x2="${x.toFixed(1)}" y2="${height - 14}" stroke="#e2e8f0" />
          <text x="${(x + 3).toFixed(1)}" y="28" font-size="9" fill="#64748b">${htmlEscape(t.minorLabel)}</text>`;
      })
      .join("");

    const rowSvg = rowsWithEvents
      .map((r, idx) => {
        const y = headerH + idx * rowH;
        const bars = r.events
          .map(({ ev }) => {
            const x = clamp(xFor(ev.startAt), labelW, labelW + chartW);
            const right = clamp(xFor(ev.endAt), labelW, labelW + chartW);
            const w = Math.max(2, right - x);
            const fill = ev.status === "CANCELLED" ? "#94a3b8" : aircraftTypeMarkColor(ev, aircraftPaletteMap);
            const stroke = ev.status === "DONE" ? "#16a34a" : ev.status === "CANCELLED" ? "#64748b" : "#0f172a";
            const label = `${eventAircraftLabel(ev)} · ${ev.title}`;
            return `<rect x="${x.toFixed(1)}" y="${y + 6}" width="${w.toFixed(1)}" height="18" rx="5" fill="${htmlEscape(fill)}" stroke="${stroke}" stroke-width="1" opacity="${ev.status === "CANCELLED" ? "0.55" : "0.88"}" />
              ${w > 80 ? `<text x="${(x + 6).toFixed(1)}" y="${y + 19}" font-size="9" fill="#ffffff">${htmlEscape(label.slice(0, 58))}</text>` : ""}`;
          })
          .join("");
        const label = `${(r as any).label ?? "—"}${(r as any).subLabel ? ` · ${(r as any).subLabel}` : ""}`;
        return `<rect x="0" y="${y}" width="${width}" height="${rowH}" fill="${idx % 2 ? "#f8fafc" : "#ffffff"}" />
          <text x="10" y="${y + 19}" font-size="10" fill="#0f172a">${htmlEscape(label.slice(0, 42))}</text>
          <line x1="${labelW}" y1="${y}" x2="${labelW}" y2="${y + rowH}" stroke="#cbd5e1" />
          ${bars}`;
      })
      .join("");

    const svg = `<svg class="ganttSvg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#ffffff" />
      <text x="10" y="18" font-size="15" font-weight="700" fill="#0f172a">Диаграмма Гантта</text>
      <text x="10" y="36" font-size="10" fill="#475569">${htmlEscape(reportMeta.join(" · "))}</text>
      <line x1="${labelW}" y1="36" x2="${labelW + chartW}" y2="36" stroke="#cbd5e1" />
      ${grid}
      ${rowSvg}
    </svg>`;

    openPrintableDocument(
      "Диаграмма Гантта",
      `<h1>Диаграмма Гантта</h1>
       <div class="meta">${reportMeta.map(htmlEscape).join(" · ")}</div>
       ${svg}
       <div class="hint">Для сохранения выберите в диалоге печати «Сохранить в PDF».</div>`
    );
  };

  const applyRangePreset = (direction: "past" | "future", daysCount: number) => {
    const today = dayjs();
    const todayValue = today.format("YYYY-MM-DD");
    if (direction === "past") {
      const rf = today.subtract(daysCount, "day").format("YYYY-MM-DD");
      setRangeFromInput(rf);
      setRangeFromApplied(rf);
      if (dayjs(rangeToApplied).isBefore(dayjs(rf))) {
        setRangeToInput(todayValue);
        setRangeToApplied(todayValue);
      }
    } else {
      const rt = today.add(daysCount, "day").format("YYYY-MM-DD");
      setRangeToInput(rt);
      setRangeToApplied(rt);
      if (dayjs(rangeFromApplied).isAfter(dayjs(rt))) {
        setRangeFromInput(todayValue);
        setRangeFromApplied(todayValue);
      }
    }
    setRangeError(null);
  };

  const pastRangePresets = [
    { label: "-7 дн", days: 7 },
    { label: "-30 дн", days: 30 },
    { label: "-3 мес", days: 90 },
    { label: "-год", days: 365 }
  ];
  const futureRangePresets = [
    { label: "+7 дн", days: 7 },
    { label: "+30 дн", days: 30 },
    { label: "+3 мес", days: 90 },
    { label: "+год", days: 365 }
  ];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card ganttPanel">
        <div className="ganttPanelHeader">
          <div className="ganttPanelTitle">
            <strong>План</strong>
            <span className="muted ganttPanelPeriod">
              {dayjs.utc(rangeFromApplied).format("DD.MM.YYYY")} – {dayjs.utc(rangeToApplied).format("DD.MM.YYYY")}
              <span className="ganttPanelDot" aria-hidden="true">·</span>
              {ZOOM_LABEL[zoom]}
              <span className="ganttPanelDot" aria-hidden="true">·</span>
              {groupMode === "AIRCRAFT" ? "Борт / событие" : "Ангар / место"}
            </span>
          </div>
          <div className="ganttPanelActions">
            <button
              type="button"
              className="btn ganttIconBtn"
              onClick={exportTableXlsx}
              disabled={reportRows.length === 0}
              title="Скачать плоскую таблицу событий по текущим фильтрам в XLSX"
              aria-label="Скачать XLSX отчёт"
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
            <button
              type="button"
              className="btn ganttIconBtn"
              onClick={exportTablePdf}
              disabled={reportRows.length === 0}
              title="Открыть печатную версию плоской таблицы для сохранения в PDF"
              aria-label="Сохранить табличный отчёт в PDF"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 2h7l4 4v12H5z" />
                <path d="M12 2v4h4" />
                <path d="M7 10h2a1.5 1.5 0 0 1 0 3H7v-3z" />
                <path d="M11.5 13v-3h1.2a1.5 1.5 0 0 1 0 3h-1.2z" />
                <path d="M15 13v-3h2" />
                <path d="M15 11.5h1.5" />
              </svg>
            </button>
            <button
              type="button"
              className="btn ganttIconBtn"
              onClick={exportGanttPdf}
              disabled={reportRows.length === 0}
              title="Открыть печатную визуализацию диаграммы для сохранения в PDF"
              aria-label="Сохранить диаграмму Гантта в PDF"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 3v14h13" />
                <rect x="6" y="6" width="7" height="2.5" rx="1" />
                <rect x="9" y="10" width="7" height="2.5" rx="1" />
                <rect x="6" y="14" width="5" height="2.5" rx="1" />
              </svg>
            </button>
          </div>
        </div>

        <div className="ganttToolbar">
          <div className="ganttToolbarGroup ganttToolbarActionsGroup">
            <button
              className="btn ganttIconBtn"
              onClick={resetFilters}
              title="Очистить фильтры и сбросить период"
              aria-label="Сбросить фильтры и период"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 10a6 6 0 0 1 10.2-4.3" />
                <path d="M14 2v4h-4" />
                <path d="M16 10a6 6 0 0 1-10.2 4.3" />
                <path d="M6 18v-4h4" />
              </svg>
            </button>
            <button
              type="button"
              className={`btn ganttIconBtn${copySelectMode ? " btnCopyActive" : ""}`}
              onClick={() => setCopySelectMode((v) => !v)}
              disabled={!canEditEvents}
              title={
                !canEditEvents
                  ? "Просмотрщик может смотреть события, но не создавать копии"
                  : copySelectMode
                  ? "Нажмите на событие в диаграмме. Esc — отмена."
                  : "Выбрать существующее событие и создать его копию"
              }
              aria-pressed={copySelectMode}
              aria-label={copySelectMode ? "Отменить копирование события" : "Скопировать событие"}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="10" height="12" rx="2" />
                <path d="M7 17h8a2 2 0 0 0 2-2V7" />
              </svg>
            </button>
            <button
              className="btn btnPrimary ganttIconBtn"
              onClick={openEditorForNew}
              disabled={!canEditEvents}
              title={!canEditEvents ? "Недостаточно прав для создания события" : undefined}
              aria-label="Создать событие"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 4v12" />
                <path d="M4 10h12" />
              </svg>
            </button>
          </div>

          <div className="ganttToolbarGroup">
            <span className="tgLabel">Вид</span>
            <label className="tgField" title="Как группировать строки">
              <span className="tgFieldLabel">Группировка</span>
              <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)}>
                <option value="AIRCRAFT">Борт / событие</option>
                <option value="HANGAR_STAND">Ангар / место</option>
              </select>
            </label>
            <label className="tgField" title="Укрупнённый / детализированный зум шкалы">
              <span className="tgFieldLabel">Зум</span>
              <select value={zoom} onChange={(e) => setZoom(e.target.value as ZoomLevel)}>
                {ZOOM_ORDER.map((z) => (
                  <option key={z} value={z}>
                    {ZOOM_LABEL[z]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`tgLockBtn${dndEnabled ? " tgLockBtnActive" : ""}${!canDnd ? " tgLockBtnDisabled" : ""}`}
              aria-pressed={dndEnabled}
              aria-label={dndEnabled ? "Drag&Drop включён" : "Drag&Drop выключен"}
              title={
                !canDnd
                  ? activeSandbox
                    ? "Drag&Drop доступен владельцу или редактору песочницы"
                    : "Drag&Drop доступен только ADMIN / PLANNER"
                  : dndEnabled
                  ? "Drag&Drop включён — нажмите, чтобы заблокировать перетаскивание"
                  : "Перетаскивание заблокировано — нажмите, чтобы включить Drag&Drop"
              }
              disabled={!canDnd}
              onClick={() => {
                if (!canDnd) return;
                const v = !dndEnabled;
                setDndEnabled(v);
                if (v && groupMode !== "HANGAR_STAND") setGroupMode("HANGAR_STAND");
              }}
            >
              {dndEnabled ? (
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="10" width="12" height="8" rx="2" />
                  <path d="M7 10V7a3 3 0 0 1 6 0" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="10" width="12" height="8" rx="2" />
                  <path d="M7 10V7a3 3 0 0 1 6 0v3" />
                </svg>
              )}
            </button>
          </div>

          <div className="ganttToolbarGroup">
            <span className="tgLabel">Фильтры</span>
            <label className="tgField">
              <span className="tgFieldLabel">Ангар</span>
              <MultiSelectDropdown
                options={(hangarsQ.data ?? []).map((h) => ({ id: h.id, label: h.name }))}
                value={selectedHangarIds}
                onChange={setSelectedHangarIds}
                placeholder="все"
                width={200}
                maxHeight={260}
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Тип ВС</span>
              <MultiSelectDropdown
                options={(aircraftTypesQ.data ?? []).map((t) => ({
                  id: t.id,
                  label: t.icaoType ? `${t.icaoType} • ${t.name}` : t.name
                }))}
                value={filterAircraftTypeIds}
                onChange={(next) => {
                  setFilterAircraftTypeIds(next);
                  if (next.length > 0 && filterAircraftIds.length > 0) {
                    const allowed = new Set(
                      (aircraftQ.data ?? [])
                        .filter((a: any) => next.includes(String(a.typeId ?? "")))
                        .map((a) => String(a.id))
                    );
                    const pruned = filterAircraftIds.filter((id) => allowed.has(String(id)));
                    if (pruned.length !== filterAircraftIds.length) setFilterAircraftIds(pruned);
                  }
                }}
                placeholder="все"
                width={240}
                maxHeight={320}
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Борт</span>
              <MultiSelectDropdown
                options={(aircraftQ.data ?? [])
                  .filter((a: any) =>
                    filterAircraftTypeIds.length === 0
                      ? true
                      : filterAircraftTypeIds.includes(String(a.typeId ?? ""))
                  )
                  .map((a: any) => ({ id: a.id, label: a.tailNumber }))}
                value={filterAircraftIds}
                onChange={setFilterAircraftIds}
                placeholder="все"
                width={200}
                maxHeight={320}
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Тип события</span>
              <MultiSelectDropdown
                options={(eventTypesQ.data ?? []).map((t) => ({
                  id: t.id,
                  label: t.name
                }))}
                value={filterEventTypeIds}
                onChange={setFilterEventTypeIds}
                placeholder="все"
                width={200}
                maxHeight={260}
              />
            </label>
          </div>

          <div className="ganttToolbarGroup">
            <span className="tgLabel">Период</span>
            <div className="tgPresets" role="group" aria-label="Быстрый выбор прошедшего периода">
              {pastRangePresets.map((p) => (
                <button
                  key={p.label}
                  className="btn btnGhost"
                  type="button"
                  onClick={() => applyRangePreset("past", p.days)}
                  title={`${p.label} до сегодняшнего дня`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <label className="tgField">
              <span className="tgFieldLabel">c</span>
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
                style={{ width: 150 }}
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">по</span>
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
                style={{ width: 150 }}
              />
            </label>
            <div className="tgPresets tgPresetsFuture" role="group" aria-label="Быстрый выбор будущего периода">
              {futureRangePresets.map((p) => (
                <button
                  key={p.label}
                  className="btn btnGhost"
                  type="button"
                  onClick={() => applyRangePreset("future", p.days)}
                  title={`${p.label} от сегодняшнего дня`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {copySelectMode || (dndEnabled && !dndActive) || dndNotice || rangeError || q.isFetching || q.error ? (
          <div className="ganttNotices">
            {copySelectMode ? (
              <span className="gpChip gpChipCopy">
                Режим копирования: выберите событие на диаграмме. <kbd>Esc</kbd> — отмена.
              </span>
            ) : null}
            {q.isFetching ? <span className="gpChip gpChipInfo">Загрузка…</span> : null}
            {dndEnabled && !dndActive ? (
              <span className="gpChip">
                Drag&amp;Drop активен только в режиме «Ангар / место» — будет включён автоматически.
              </span>
            ) : null}
            {dndNotice ? <span className="gpChip">{dndNotice}</span> : null}
            {rangeError ? <span className="gpChip gpChipError">{rangeError}</span> : null}
            {q.error ? <span className="gpChip gpChipError">{String((q.error as any).message || q.error)}</span> : null}
          </div>
        ) : null}

        <details className="ganttLegendDetails">
          <summary>Легенда</summary>
          <div className="ganttLegendBody">
            <div className="legendSection">
              <div className="legendSectionTitle">Статусы событий</div>
              <div className="legendSectionGrid">
                <LegendStatus status="PLANNED" baseColor="#94a3b8" label="Черновик / Запланировано" />
                <LegendStatus status="CONFIRMED" baseColor="#94a3b8" label="Подтверждено / В работе" />
                <LegendStatus status="DONE" baseColor="#94a3b8" label="Завершено" />
                <LegendStatus status="CANCELLED" baseColor="#94a3b8" label="Отменено" />
              </div>
              <div className="legendHint muted">
                Заливка выше — нейтральный серый для наглядности. Реальный цвет бара определяется правилом «оператор × тип ВС» (см. ниже).
              </div>
            </div>

            <div className="legendSection">
              <div className="legendSectionTitle">Индикаторы</div>
              <div className="legendSectionGrid">
                <span className="ganttLegendItem">
                  <span className="legendOverlayBox" aria-hidden="true">
                    <span style={{ background: "#94a3b8", border: "1px solid rgba(15, 23, 42, 0.22)" }} />
                    <span
                      style={{
                        backgroundColor: "rgba(220, 38, 38, 0.30)",
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(220,38,38,0.55) 0px, rgba(220,38,38,0.55) 6px, rgba(220,38,38,0) 6px, rgba(220,38,38,0) 12px)"
                      }}
                    />
                  </span>
                  Нахлёст по месту / ангару
                </span>
                <span className="ganttLegendItem">
                  <span
                    className="legendBar"
                    style={{
                      background: "rgba(239, 68, 68, 0.95)",
                      borderLeft: "2px solid rgba(255,255,255,0.9)",
                      borderRight: "2px solid rgba(255,255,255,0.9)",
                      borderTop: "none",
                      borderBottom: "none"
                    }}
                  />
                  Буксировка (разрыв внутри события)
                </span>
                <span className="ganttLegendItem">
                  <span
                    className="legendBar"
                    style={{ background: "rgba(220, 38, 38, 0.35)", width: 4, borderRadius: 2 }}
                  />
                  Линия «сегодня»
                </span>
              </div>
            </div>

            <div className="legendSection">
              <div className="legendSectionTitle">
                Цвет бара — оператор × тип ВС
                <span className="muted legendSectionMeta">
                  {legendPaletteEntries.length > 0
                    ? `${legendPaletteEntries.length} записей в палитре`
                    : "палитра не настроена — используется запасная"}
                </span>
              </div>
              {legendPaletteEntries.length > 0 ? (
                <div className="legendPalette">
                  {legendPaletteEntries.slice(0, 24).map((p) => (
                    <span className="legendPaletteItem" key={p.key} title={`${p.operator} × ${p.type}`}>
                      <span className="legendPaletteSwatch" style={{ background: p.color }} />
                      <span className="legendPaletteLabel">
                        <span className="legendPaletteOperator">{p.operator}</span>
                        <span className="legendPaletteType">{p.type}</span>
                      </span>
                    </span>
                  ))}
                  {legendPaletteEntries.length > 24 ? (
                    <span className="legendPaletteMore muted">и ещё {legendPaletteEntries.length - 24}…</span>
                  ) : null}
                </div>
              ) : (
                <div className="legendPalette">
                  {AIRCRAFT_MARK_PALETTE.map((c, i) => (
                    <span className="legendPaletteItem" key={i} title={c}>
                      <span className="legendPaletteSwatch" style={{ background: c }} />
                    </span>
                  ))}
                  <span className="legendHint muted">
                    Настроить соответствие оператора и типа ВС можно в Справочниках → Палитра ВС.
                  </span>
                </div>
              )}
            </div>
          </div>
        </details>
      </div>

      <div className={`ganttGrid${copySelectMode ? " ganttPickMode" : ""}`}>
        <div className="ganttHeaderRow">
          <div className="ganttLabel">
            <strong>{groupMode === "AIRCRAFT" ? "Борт / событие" : "Ангар / место"}</strong>
          </div>
          <div className="ganttHeaderRightViewport" ref={headerViewportRef}>
            <div className="ganttCanvas" style={{ width: canvasWidth, height: 44 }}>
              <TodayLine from={from} to={to} canvasWidth={canvasWidth} />
              <div style={{ position: "absolute", inset: 0 }}>
                {ticks.map((t, i) => {
                  const nextAt = ticks[i + 1]?.at ?? to;
                  const leftRaw = t.at.diff(from, "day", true) * dayWidth;
                  const rightRaw = nextAt.diff(from, "day", true) * dayWidth;
                  const left = Math.max(0, leftRaw);
                  const width = Math.max(1, rightRaw - left);
                  const isMajor = t.majorLabel != null;
                  return (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left,
                        width,
                        top: 0,
                        bottom: 0,
                        borderRight: "1px solid rgba(148,163,184,0.18)",
                        background: isMajor ? "rgba(37,99,235,0.06)" : "transparent",
                        padding: "2px 4px",
                        overflow: "hidden",
                        boxSizing: "border-box"
                      }}
                      title={t.majorLabel ? `${t.majorLabel} • ${t.minorLabel}` : t.minorLabel}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          lineHeight: "12px",
                          color: "#334155",
                          whiteSpace: "nowrap",
                          visibility: isMajor ? "visible" : "hidden"
                        }}
                      >
                        {t.majorLabel ?? "·"}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          lineHeight: "14px",
                          color: "#64748b",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {t.minorLabel}
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
              ? aircraftRows.map((r) => (
                  <div className="ganttLabel" key={r.key}>
                    <div>
                      <strong>{r.label}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r.subLabel}
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
                  ? aircraftRows.map((r) => (
                      <div className="ganttCanvas" key={r.key} style={{ width: canvasWidth }}>
                        <TodayLine from={from} to={to} canvasWidth={canvasWidth} />
                        {r.events.map((p) => {
                          const ev = p.ev;
                          const g = calcBarXW({ startAt: ev.startAt, endAt: ev.endAt, from, dayWidth, canvasWidth });
                          if (!g) return null;
                          const { x, w } = g;
                          const color = aircraftTypeMarkColor(ev, aircraftPaletteMap);
                          const visual = barVisualStyle(ev.status, color);

                          return (
                            <div
                              key={ev.id}
                              className="bar"
                              style={{
                                left: x,
                                width: w,
                                cursor: "pointer",
                                ...visual,
                                ...barPaddingStyle(w)
                              }}
                              onClick={() => pickEvent(ev)}
                              title={`${ev.title}\n${dayjs(ev.startAt).format("DD.MM.YYYY HH:mm")} – ${dayjs(ev.endAt).format(
                                "DD.MM.YYYY HH:mm"
                              )}\n${copySelectMode ? "Нажмите, чтобы создать копию" : "Нажмите, чтобы редактировать"}`}
                            >
                              {renderTowBreaks({ ev, barX: x, barW: w, from, dayWidth, canvasWidth })}
                              {canShowBarTitle(w) ? (
                                <span style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>{ev.title}</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ))
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
                                ...barPaddingStyle(w),
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
                                pickEvent(ev);
                              }}
                              title={`${eventAircraftLabel(ev)} • ${ev.title}\n${dayjs(ev.startAt).format("DD.MM.YYYY HH:mm")} – ${dayjs(
                                ev.endAt
                              ).format("DD.MM.YYYY HH:mm")}\n${copySelectMode ? "Нажмите, чтобы создать копию" : "Нажмите, чтобы редактировать"}`}
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
                              {canShowBarTitle(w) ? (
                                <span style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
                                  {eventAircraftLabel(ev)} • {ev.title}
                                </span>
                              ) : null}
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
        title={draft?.id ? "Редактирование события" : copyFromTitle ? "Копия события" : "Новое событие"}
        onClose={() => {
          setEditorOpen(false);
          setCopyFromTitle(null);
        }}
      >
        {!draft ? (
          <div className="muted">Нет данных формы.</div>
        ) : (
          <div className="evEditor">
            {copyFromTitle ? (
              <div className="copyNotice" role="alert">
                <span className="copyNoticeDot" aria-hidden="true" />
                <div>
                  <strong>Режим копирования.</strong> Сохранение создаст <strong>новое событие</strong> на
                  основе «{copyFromTitle}». При необходимости измените дату, статус и параметры.
                </div>
              </div>
            ) : null}

            {!canEditEvents ? (
              <div className="contextNotice" role="status">
                <strong>Режим просмотра.</strong> У вашей роли нет прав на редактирование событий. Карточка доступна
                только для просмотра.
              </div>
            ) : null}

            <fieldset className="evReadonlyFieldset" disabled={!canEditEvents}>
            <section className="evCard">
              <header className="evCardHeader">
                <div className="evCardTitle">Основная информация</div>
                <div className="evCardHint">Название, уровень планирования, статус и связь с бортом.</div>
              </header>
              <div className="evCardBody">
                <div className="evForm">
                  <label className="evField evFieldWide">
                    <span className="evFieldLabel">Название</span>
                    <input
                      className="evInput"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      placeholder="Например: Техобслуживание А320"
                    />
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Уровень</span>
                    <select
                      className="evInput"
                      value={draft.level}
                      onChange={(e) => setDraft({ ...draft, level: e.target.value as any })}
                    >
                      <option value="OPERATIONAL">Оперативный</option>
                      <option value="STRATEGIC">Стратегический</option>
                    </select>
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Статус</span>
                    <select
                      className="evInput"
                      value={draft.status}
                      onChange={(e) => setDraft({ ...draft, status: e.target.value as any })}
                    >
                      <option value="DRAFT">Черновик</option>
                      <option value="PLANNED">Запланировано</option>
                      <option value="CONFIRMED">Подтверждено</option>
                      <option value="IN_PROGRESS">В работе</option>
                      <option value="DONE">Завершено</option>
                      <option value="CANCELLED">Отменено</option>
                    </select>
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Борт</span>
                    <select
                      className="evInput"
                      value={draft.aircraftId}
                      onChange={(e) => setDraft({ ...draft, aircraftId: e.target.value })}
                    >
                      <option value="">— выберите —</option>
                      {(aircraftQ.data ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.tailNumber}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Тип события</span>
                    <select
                      className="evInput"
                      value={draft.eventTypeId}
                      onChange={(e) => setDraft({ ...draft, eventTypeId: e.target.value })}
                    >
                      <option value="">— выберите —</option>
                      {(eventTypesQ.data ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.aircraftId ? (
                    <>
                      <label className="evField">
                        <span className="evFieldLabel">Оператор</span>
                        <input
                          className="evInput evInputReadonly"
                          value={selectedAircraft?.operator?.name ?? "—"}
                          readOnly
                        />
                      </label>
                      <label className="evField">
                        <span className="evFieldLabel">Тип ВС</span>
                        <input
                          className="evInput evInputReadonly"
                          value={
                            selectedAircraft?.type
                              ? `${selectedAircraft.type.icaoType ? `${selectedAircraft.type.icaoType} • ` : ""}${selectedAircraft.type.name}`
                              : "—"
                          }
                          readOnly
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="evCard">
              <header className="evCardHeader">
                <div className="evCardTitle">Период</div>
                <div className="evCardHint">Время начала и окончания события (локальное время).</div>
              </header>
              <div className="evCardBody">
                <div className="evForm">
                  <label className="evField">
                    <span className="evFieldLabel">Начало</span>
                    <input
                      className="evInput"
                      type="datetime-local"
                      value={draft.startAtLocal}
                      onChange={(e) => setDraft({ ...draft, startAtLocal: e.target.value })}
                    />
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Окончание</span>
                    <input
                      className="evInput"
                      type="datetime-local"
                      value={draft.endAtLocal}
                      onChange={(e) => setDraft({ ...draft, endAtLocal: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="evCard">
              <header className="evCardHeader">
                <div className="evCardTitle">Ангар и место</div>
                <div className="evCardHint">
                  Резервирование места выполняется отдельной операцией — кнопкой «Назначить место».
                </div>
              </header>
              <div className="evCardBody">
                <div className="evForm">
                  <label className="evField">
                    <span className="evFieldLabel">Ангар</span>
                    <select
                      className="evInput"
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
                  <label className="evField">
                    <span className="evFieldLabel">Вариант размещения</span>
                    <select
                      className="evInput"
                      value={draft.layoutId}
                      onChange={(e) => setDraft({ ...draft, layoutId: e.target.value, standId: "" })}
                      disabled={!draft.hangarId}
                    >
                      <option value="">— не задан —</option>
                      {(layoutsForEditorQ.data ?? []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                          {l.capacitySummary ? ` — ${l.capacitySummary}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="evField evFieldWide">
                    <span className="evFieldLabel">Место</span>
                    <select
                      className="evInput"
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
                </div>
                <div className="evInlineActions">
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
            </section>

            <section className="evCard">
              <header className="evCardHeader">
                <div className="evCardTitle">Буксировки</div>
                <div className="evCardHint">Закатка и выкатка — можно указать несколько интервалов внутри события.</div>
              </header>
              <div className="evCardBody">
                {!draft.id ? (
                  <div className="muted">Сначала сохраните событие, затем можно добавлять буксировки.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="evForm">
                      <label className="evField">
                        <span className="evFieldLabel">Начало буксировки</span>
                        <input
                          className="evInput"
                          type="datetime-local"
                          value={towStartLocal}
                          onChange={(e) => setTowStartLocal(e.target.value)}
                        />
                      </label>
                      <label className="evField">
                        <span className="evFieldLabel">Окончание буксировки</span>
                        <input
                          className="evInput"
                          type="datetime-local"
                          value={towEndLocal}
                          onChange={(e) => setTowEndLocal(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="evInlineActions">
                      <button
                        className="btn btnPrimary"
                        onClick={() => requestTowAddWithReason()}
                        disabled={addTowM.isPending}
                      >
                        Добавить интервал
                      </button>
                      {addTowM.error ? (
                        <span className="error">{String((addTowM.error as any)?.message ?? addTowM.error)}</span>
                      ) : null}
                    </div>

                    <div className="evTowList">
                      {(towsQ.data ?? []).length === 0 ? (
                        <div className="muted">Буксировок пока нет.</div>
                      ) : (
                        (towsQ.data ?? []).map((t) => (
                          <div key={t.id} className="evTowItem">
                            <div>
                              <strong>{dayjs(t.startAt).format("DD.MM.YYYY HH:mm")}</strong> –{" "}
                              <strong>{dayjs(t.endAt).format("DD.MM.YYYY HH:mm")}</strong>
                            </div>
                            <button
                              className="btn"
                              onClick={() => requestTowDeleteWithReason(t.id)}
                              disabled={delTowM.isPending}
                            >
                              Удалить
                            </button>
                          </div>
                        ))
                      )}
                      {towsQ.isFetching ? <div className="muted">обновление…</div> : null}
                      {towsQ.error ? (
                        <div className="error">{String((towsQ.error as any)?.message ?? towsQ.error)}</div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="evCard">
              <header className="evCardHeader">
                <div className="evCardTitle">Примечание</div>
                <div className="evCardHint">Комментарий к событию для команды.</div>
              </header>
              <div className="evCardBody">
                <textarea
                  className="evInput evTextarea"
                  rows={4}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Опишите контекст, особенности, внешние согласования…"
                />
              </div>
            </section>
            </fieldset>

            {draft.id ? (
              <details className="evCard evCardDetails">
                <summary className="evCardHeader evCardSummary">
                  <div>
                    <div className="evCardTitle">Ресурсы и факт</div>
                    <div className="evCardHint">
                      Планирование ресурсов, исполнителей и фактические показатели.
                    </div>
                  </div>
                  <span className="evCardChevron" aria-hidden="true" />
                </summary>
                <div className="evCardBody">
                  <EventResourcesPanel eventId={draft.id} />
                </div>
              </details>
            ) : null}

            <details className="evCard evCardDetails">
              <summary className="evCardHeader evCardSummary">
                <div>
                  <div className="evCardTitle">
                    История изменений{" "}
                    {draft.id && (historyQ.data ?? []).length > 0 ? (
                      <span className="evCardBadge">{(historyQ.data ?? []).length}</span>
                    ) : null}
                  </div>
                  <div className="evCardHint">
                    {!draft.id
                      ? "Будет доступна после сохранения события."
                      : historyQ.isFetching
                        ? "обновление…"
                        : "Все правки события с автором и причиной."}
                  </div>
                </div>
                <span className="evCardChevron" aria-hidden="true" />
              </summary>
              <div className="evCardBody">
                {!draft.id ? (
                  <div className="muted">История появится после сохранения события.</div>
                ) : historyQ.error ? (
                  <div className="error">{String(historyQ.error.message || historyQ.error)}</div>
                ) : (historyQ.data ?? []).length === 0 ? (
                  <div className="muted">История пока пустая.</div>
                ) : (
                  <div className="evHistoryList">
                    {(historyQ.data ?? []).map((h) => (
                      <div key={h.id} className="evHistoryItem">
                        <div className="evHistoryHead">
                          <strong>{h.action}</strong>
                          <span className="muted">{dayjs(h.createdAt).format("DD.MM.YYYY HH:mm")}</span>
                          <span className="muted">• {h.actor}</span>
                        </div>
                        {h.reason ? (
                          <div className="evHistoryReason">
                            <strong>Причина:</strong> {h.reason}
                          </div>
                        ) : null}
                        {h.changes ? (
                          <pre className="evHistoryChanges">{JSON.stringify(h.changes, null, 2)}</pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>

            <footer className="evFooter">
              <div className="evFooterInfo">
                {saveEventM.error || reserveM.error || unreserveM.error ? (
                  <span className="error">
                    {String((saveEventM.error ?? reserveM.error ?? unreserveM.error)?.message ?? "")}
                  </span>
                ) : saveEventM.isPending ? (
                  <span className="muted">Сохраняем…</span>
                ) : saveEventM.isSuccess && computeDraftDiff(original, draft).length === 0 ? (
                  <span className="muted">Сохранено.</span>
                ) : draft.id && computeDraftDiff(original, draft).length === 0 ? (
                  <span className="muted">Нет несохранённых изменений.</span>
                ) : draft.id ? (
                  <span className="muted">
                    Несохранённых изменений: {computeDraftDiff(original, draft).length}
                  </span>
                ) : (
                  <span className="muted">Новое событие будет создано после сохранения.</span>
                )}
              </div>
              <div className="evFooterActions">
                <button
                  className="btn"
                  onClick={() => {
                    setEditorOpen(false);
                    setCopyFromTitle(null);
                  }}
                  type="button"
                >
                  Отмена
                </button>
                <button
                  className="btn btnPrimary"
                  onClick={() => {
                    if (!draft.id) {
                      // новое событие — сохраняем без подтверждения
                      saveEventM.mutate();
                    } else {
                      requestSaveWithReason("event");
                    }
                  }}
                  disabled={
                    !canEditEvents ||
                    saveEventM.isPending ||
                    (!!draft.id && computeDraftDiff(original, draft).length === 0)
                  }
                  type="button"
                >
                  {draft.id ? "Сохранить изменения" : copyFromTitle ? "Создать копию" : "Создать событие"}
                </button>
              </div>
            </footer>
          </div>
        )}
      </Drawer>

      <Drawer
        open={confirmOpen}
        title="Подтверждение изменения"
        subtitle="Укажите причину — она попадёт в историю события."
        onClose={() => setConfirmOpen(false)}
      >
        <div className="evConfirm">
          <label className="evField">
            <span className="evFieldLabel">Причина изменения</span>
            <textarea
              className="evInput evTextarea"
              rows={3}
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="Например: перенос по запросу оператора, уточнение сроков…"
              autoFocus
            />
          </label>

          {(() => {
            const diffs =
              pendingSave === "event" || pendingSave === "reserve"
                ? computeDraftDiff(original, draft)
                : [];
            if (diffs.length === 0) return null;
            return (
              <div className="evDiff">
                <div className="evDiffTitle">Изменения</div>
                <div className="evDiffList">
                  {diffs.map((d) => (
                    <div key={d.field} className="evDiffItem">
                      <span className="evDiffField">{FIELD_LABEL[d.field] ?? d.field}</span>
                      <span className="evDiffValues">
                        <span className="evDiffFrom">{String(d.from || "—")}</span>
                        <span className="evDiffArrow" aria-hidden="true">→</span>
                        <span className="evDiffTo">{String(d.to || "—")}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {pendingSave === "towAdd" && pendingTow?.kind === "add" ? (
            <div className="evDiff">
              <div className="evDiffTitle">Новая буксировка</div>
              <div className="muted">
                {dayjs(pendingTow.startAt).format("DD.MM.YYYY HH:mm")} — {dayjs(pendingTow.endAt).format("DD.MM.YYYY HH:mm")}
              </div>
            </div>
          ) : null}
          {pendingSave === "towDel" ? (
            <div className="evDiff">
              <div className="evDiffTitle">Удаление буксировки</div>
              <div className="muted">Выбранный интервал будет удалён.</div>
            </div>
          ) : null}
          {pendingSave === "dndMove" ? (
            <div className="evDiff">
              <div className="evDiffTitle">Перенос события</div>
              <div className="muted">Размещение/время будут изменены согласно предпросмотру.</div>
            </div>
          ) : null}

          <footer className="evFooter">
            <div className="evFooterInfo">
              {saveEventM.error || reserveM.error || addTowM.error || delTowM.error || dndMoveM.error ? (
                <span className="error">
                  {String(
                    (saveEventM.error ?? reserveM.error ?? addTowM.error ?? delTowM.error ?? (dndMoveM.error as any))
                      ?.message ?? ""
                  )}
                </span>
              ) : saveEventM.isPending ||
                reserveM.isPending ||
                addTowM.isPending ||
                delTowM.isPending ||
                dndMoveM.isPending ? (
                <span className="muted">Сохраняем…</span>
              ) : (
                <span className="muted">Причина обязательна.</span>
              )}
            </div>
            <div className="evFooterActions">
              <button className="btn" onClick={() => setConfirmOpen(false)} type="button">
                Отмена
              </button>
              <button
                className="btn btnPrimary"
                disabled={
                  !changeReason.trim() ||
                  saveEventM.isPending ||
                  reserveM.isPending ||
                  addTowM.isPending ||
                  delTowM.isPending ||
                  dndMoveM.isPending
                }
                onClick={() => {
                  if (pendingSave === "event") saveEventM.mutate();
                  if (pendingSave === "reserve") reserveM.mutate();
                  if (pendingSave === "towAdd") addTowM.mutate();
                  if (pendingSave === "towDel") delTowM.mutate();
                  if (pendingSave === "dndMove") dndMoveM.mutate();
                }}
                type="button"
              >
                Подтвердить и сохранить
              </button>
            </div>
          </footer>
        </div>
      </Drawer>
    </div>
  );
}

