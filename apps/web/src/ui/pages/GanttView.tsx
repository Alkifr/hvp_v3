import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  standId: "Место"
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  PLANNED: "Запланировано",
  CONFIRMED: "Подтверждено",
  IN_PROGRESS: "В работе",
  DONE: "Завершено",
  CANCELLED: "Отменено",
  DELETED: "Удалено"
};

const LEVEL_LABEL: Record<string, string> = {
  OPERATIONAL: "Оперативный",
  STRATEGIC: "Стратегический"
};

const PLANNING_KIND_LABEL: Record<string, string> = {
  PLANNED: "Плановое",
  UNPLANNED: "Внеплановое"
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
  segmentKey?: string;
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
  towSegments?: Array<{ id: string; startAt: string; endAt: string }>;
};

type EventPlacementRow = {
  id: string;
  eventId: string;
  startAt: string;
  endAt: string;
  budgetStartAt?: string | null;
  budgetEndAt?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  hangarId?: string | null;
  layoutId?: string | null;
  standId?: string | null;
  sortOrder?: number;
  hangar?: { id?: string; name: string } | null;
  layout?: { id?: string; name: string; hangarId?: string } | null;
  stand?: { id?: string; code: string; name?: string } | null;
};

function eventAircraftLabel(ev: EventRow): string {
  return ev.aircraft?.tailNumber ?? ev.virtualAircraft?.label ?? "—";
}

function eventOperatorId(ev: EventRow): string {
  return ev.aircraft?.operatorId ?? ev.aircraft?.operator?.id ?? ev.virtualAircraft?.operatorId ?? "";
}

function eventAircraftTypeId(ev: EventRow): string {
  return String(
    (ev.aircraft as any)?.typeId ??
      (ev.aircraft as any)?.type?.id ??
      (ev.virtualAircraft as any)?.aircraftTypeId ??
      ""
  );
}

function eventAircraftId(ev: EventRow): string {
  return String((ev.aircraft as any)?.id ?? (ev as any).aircraftId ?? "");
}

function eventEventTypeId(ev: EventRow): string {
  return String((ev.eventType as any)?.id ?? (ev as any).eventTypeId ?? "");
}

function eventPrimaryHangarId(ev: EventRow): string {
  return String((ev.hangar as any)?.id ?? (ev.layout as any)?.hangarId ?? "");
}

function eventHangarIds(ev: EventRow): string[] {
  const ids = new Set<string>();
  const primary = eventPrimaryHangarId(ev);
  if (primary) ids.add(primary);
  for (const p of ev.placements ?? []) {
    const hid = String(p.hangarId ?? (p.hangar as any)?.id ?? "");
    if (hid) ids.add(hid);
  }
  return Array.from(ids);
}

function eventOperatorLabel(ev: EventRow, operatorNameById?: Map<string, string>): string {
  const opId = eventOperatorId(ev);
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

function toExcelDate(v: string | Date | null | undefined): Date | "" {
  if (!v) return "";
  const d = dayjs(v);
  return d.isValid() ? d.toDate() : "";
}

function formatReportCell(v: unknown): string {
  if (v instanceof Date) return formatExportDate(v);
  return String(v ?? "");
}

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

function placementDraftFromEvent(ev: EventRow): PlacementDraft[] {
  const rows = ev.placements?.length
    ? ev.placements
    : [
        {
          id: "legacy",
          eventId: ev.id,
          startAt: ev.startAt,
          endAt: ev.endAt,
          budgetStartAt: ev.budgetStartAt,
          budgetEndAt: ev.budgetEndAt,
          actualStartAt: ev.actualStartAt,
          actualEndAt: ev.actualEndAt,
          hangarId: (ev.hangar as any)?.id ?? (ev.layout as any)?.hangarId ?? "",
          layoutId: (ev.layout as any)?.id ?? "",
          standId: (ev.reservation?.stand as any)?.id ?? "",
          hangar: ev.hangar,
          layout: ev.layout,
          stand: ev.reservation?.stand ?? null
        } as EventPlacementRow
      ];
  return rows.map((p) => ({
    id: p.id === "legacy" ? undefined : p.id,
    startAtLocal: toInputLocal(p.startAt),
    endAtLocal: toInputLocal(p.endAt),
    budgetStartAtLocal: toInputLocal(p.budgetStartAt),
    budgetEndAtLocal: toInputLocal(p.budgetEndAt),
    actualStartAtLocal: toInputLocal(p.actualStartAt),
    actualEndAtLocal: toInputLocal(p.actualEndAt),
    hangarId: p.hangarId ?? (p.hangar as any)?.id ?? (p.layout as any)?.hangarId ?? "",
    layoutId: p.layoutId ?? (p.layout as any)?.id ?? "",
    standId: p.standId ?? (p.stand as any)?.id ?? ""
  }));
}

function placementApiPayload(placements: PlacementDraft[]) {
  return placements.map((p, idx) => {
    const startAt = dayjs(p.startAtLocal).second(0).millisecond(0);
    const endAt = dayjs(p.endAtLocal).second(0).millisecond(0);
    if (!startAt.isValid() || !endAt.isValid()) throw new Error("Заполните даты всех этапов размещения");
    if (endAt.valueOf() <= startAt.valueOf()) throw new Error("Окончание этапа должно быть позже начала");
    const budgetStartAt = fromInputLocalOptional(p.budgetStartAtLocal);
    const budgetEndAt = fromInputLocalOptional(p.budgetEndAtLocal);
    if ((budgetStartAt && !budgetEndAt) || (!budgetStartAt && budgetEndAt)) throw new Error("Заполните обе плановые даты этапа");
    if (budgetStartAt && budgetEndAt && dayjs(budgetEndAt).valueOf() <= dayjs(budgetStartAt).valueOf()) {
      throw new Error("Плановое окончание этапа должно быть позже начала");
    }
    const actualStartAt = fromInputLocalOptional(p.actualStartAtLocal);
    const actualEndAt = fromInputLocalOptional(p.actualEndAtLocal);
    if ((actualStartAt && !actualEndAt) || (!actualStartAt && actualEndAt)) throw new Error("Заполните обе фактические даты этапа");
    if (actualStartAt && actualEndAt && dayjs(actualEndAt).valueOf() <= dayjs(actualStartAt).valueOf()) {
      throw new Error("Фактическое окончание этапа должно быть позже начала");
    }
    return {
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      budgetStartAt,
      budgetEndAt,
      actualStartAt,
      actualEndAt,
      hangarId: p.hangarId || null,
      layoutId: p.layoutId || null,
      standId: p.standId || null,
      sortOrder: idx
    };
  });
}

function tatHours(start: string | Date | null | undefined, end: string | Date | null | undefined): number | null {
  if (!start || !end) return null;
  const s = dayjs(start);
  const e = dayjs(end);
  if (!s.isValid() || !e.isValid() || e.valueOf() <= s.valueOf()) return null;
  return Math.max(0, e.diff(s, "minute")) / 60;
}

function formatTat(start: string | Date | null | undefined, end: string | Date | null | undefined): string {
  const hours = tatHours(start, end);
  if (hours == null) return "—";
  const days = hours / 24;
  return String(Number(days.toFixed(days < 1 ? 1 : 0)));
}

function formatTatDetailed(start: string | Date | null | undefined, end: string | Date | null | undefined): string {
  const hours = tatHours(start, end);
  if (hours == null) return "—";
  return `${Number(hours.toFixed(1))} ч / ${Number((hours / 24).toFixed(2))} дн`;
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
type OperatorRef = { id: string; code?: string | null; name: string; isActive?: boolean };
type Hangar = { id: string; name: string };
type Layout = { id: string; name: string; hangarId: string; code?: string; capacitySummary?: string; isCompatible?: boolean };
type Stand = { id: string; layoutId: string; code: string; name: string; isActive?: boolean; isCompatible?: boolean };
type AircraftTypePaletteRow = { id: string; operatorId: string; aircraftTypeId: string; color: string; isActive: boolean };
type DndStand = Stand & { hangarId: string; hangarName: string; layoutName: string };

type GroupMode = "AIRCRAFT" | "HANGAR_STAND";
type GanttDisplayMode = "CURRENT" | "PLAN_FACT";
type TimelineTimeMode = "UTC" | "LOCAL";
type PlanningKindFilter = "ALL" | "PLANNED" | "UNPLANNED";

type GanttFilters = {
  hangarIds: string[];
  operatorIds: string[];
  aircraftTypeIds: string[];
  aircraftIds: string[];
  eventTypeIds: string[];
  planningKind: PlanningKindFilter;
};

type GanttFilterKey = keyof GanttFilters;

type TowSegment = { id: string; eventId: string; startAt: string; endAt: string };

type DndMoveRequest = { eventId: string; hangarId: string; bumpOnConflict: boolean; bumpedEventId?: string };
type DndPlaceRequest = DndMoveRequest & { startAt: string; endAt: string };

type EditorDraft = {
  id?: string;
  title: string;
  level: "STRATEGIC" | "OPERATIONAL";
  status: "DRAFT" | "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "DELETED";
  planningKind: "PLANNED" | "UNPLANNED";
  aircraftId: string;
  eventTypeId: string;
  startAtLocal: string; // YYYY-MM-DDTHH:mm
  endAtLocal: string; // YYYY-MM-DDTHH:mm
  budgetStartAtLocal: string;
  budgetEndAtLocal: string;
  actualStartAtLocal: string;
  actualEndAtLocal: string;
  notes: string;
  hangarId: string; // optional, "" means null
  layoutId: string; // optional, "" means null
  standId: string; // optional, "" means no reservation
  multiPlacement: boolean;
  placements: PlacementDraft[];
};

type PlacementDraft = {
  id?: string;
  startAtLocal: string;
  endAtLocal: string;
  budgetStartAtLocal: string;
  budgetEndAtLocal: string;
  actualStartAtLocal: string;
  actualEndAtLocal: string;
  hangarId: string;
  layoutId: string;
  standId: string;
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

function timelineDate(value: string | Date | number, mode: TimelineTimeMode): dayjs.Dayjs {
  return mode === "UTC" ? dayjs.utc(value) : dayjs(value);
}

function formatTimelineDate(value: string | Date | null | undefined, mode: TimelineTimeMode): string {
  if (!value) return "—";
  const d = timelineDate(value, mode);
  return d.isValid() ? d.format("DD.MM.YYYY HH:mm") : "—";
}

function calcBarXW(params: {
  startAt: string;
  endAt: string;
  from: dayjs.Dayjs;
  dayWidth: number;
  canvasWidth: number;
  timeMode?: TimelineTimeMode;
}): { x: number; w: number; leftRaw: number; rightRaw: number } | null {
  const mode = params.timeMode ?? "UTC";
  const s = timelineDate(params.startAt, mode);
  const e = timelineDate(params.endAt, mode);
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
  timeMode: TimelineTimeMode;
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
      canvasWidth: params.canvasWidth,
      timeMode: params.timeMode
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

function renderPlacementBreaks(params: {
  ev: EventRow;
  barX: number;
  barW: number;
  from: dayjs.Dayjs;
  dayWidth: number;
  canvasWidth: number;
  timeMode: TimelineTimeMode;
}) {
  const placements = params.ev.placements ?? [];
  if (placements.length < 2) return null;
  return placements
    .slice(1)
    .map((p, idx) => {
      const seg = calcBarXW({
        startAt: p.startAt,
        endAt: p.endAt,
        from: params.from,
        dayWidth: params.dayWidth,
        canvasWidth: params.canvasWidth,
        timeMode: params.timeMode
      });
      if (!seg) return null;
      const left = clamp(seg.x - params.barX, 0, params.barW);
      return (
        <div
          key={`placement-break:${p.id ?? idx}`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left,
            borderLeft: "2px dashed rgba(255,255,255,0.95)",
            zIndex: 1,
            pointerEvents: "none"
          }}
          title="Смена ангара"
        />
      );
    })
    .filter(Boolean);
}

function eventPlanningKind(ev: EventRow): "PLANNED" | "UNPLANNED" {
  if (ev.planningKind === "PLANNED" || ev.planningKind === "UNPLANNED") return ev.planningKind;
  return ev.budgetStartAt && ev.budgetEndAt ? "PLANNED" : "UNPLANNED";
}

function eventMatchesGanttFilters(ev: EventRow, filters: GanttFilters, skip?: GanttFilterKey): boolean {
  if (skip !== "hangarIds") {
    const hangarIds = eventHangarIds(ev);
    const isUnassigned = hangarIds.length === 0;
    const okHangar =
      filters.hangarIds.length === 0 ||
      hangarIds.some((id) => filters.hangarIds.includes(id)) ||
      isUnassigned;
    if (!okHangar) return false;
  }
  if (skip !== "aircraftTypeIds") {
    if (filters.aircraftTypeIds.length > 0 && !filters.aircraftTypeIds.includes(eventAircraftTypeId(ev))) return false;
  }
  if (skip !== "operatorIds") {
    if (filters.operatorIds.length > 0 && !filters.operatorIds.includes(String(eventOperatorId(ev)))) return false;
  }
  if (skip !== "aircraftIds") {
    if (filters.aircraftIds.length > 0 && !filters.aircraftIds.includes(eventAircraftId(ev))) return false;
  }
  if (skip !== "eventTypeIds") {
    if (filters.eventTypeIds.length > 0 && !filters.eventTypeIds.includes(eventEventTypeId(ev))) return false;
  }
  if (skip !== "planningKind") {
    if (filters.planningKind !== "ALL" && eventPlanningKind(ev) !== filters.planningKind) return false;
  }
  return true;
}

function displayPeriodForMode(ev: EventRow, mode: GanttDisplayMode): { startAt: string; endAt: string; source: "Опер." | "Факт" } {
  if (mode === "CURRENT" && ev.actualStartAt && ev.actualEndAt) {
    return { startAt: ev.actualStartAt, endAt: ev.actualEndAt, source: "Факт" };
  }
  return { startAt: ev.startAt, endAt: ev.endAt, source: "Опер." };
}

function displayTatForMode(ev: EventRow, mode: GanttDisplayMode): { label: string; source: "Опер." | "Факт" } {
  const period = displayPeriodForMode(ev, mode);
  return { label: formatTat(period.startAt, period.endAt), source: period.source };
}

function operationalTat(ev: EventRow) {
  return { label: formatTat(ev.startAt, ev.endAt), source: "Опер." };
}

function factTone(ev: EventRow): "good" | "warn" | "bad" {
  const actualHours = tatHours(ev.actualStartAt, ev.actualEndAt);
  const operationalHours = tatHours(ev.startAt, ev.endAt);
  if (actualHours == null || operationalHours == null || !ev.actualEndAt) return "warn";
  const endsLater = dayjs(ev.actualEndAt).valueOf() > dayjs(ev.endAt).valueOf();
  const tatLonger = actualHours > operationalHours;
  if (endsLater && tatLonger) return "bad";
  if (!endsLater && !tatLonger) return "good";
  return "warn";
}

function factToneLabel(tone: "good" | "warn" | "bad") {
  if (tone === "bad") return "Факт позже плана, TAT больше";
  if (tone === "good") return "Факт в срок, TAT не больше плана";
  return "Факт требует внимания";
}

const EXIT_TIME_LABEL_WIDTH = 42;
const EXIT_TIME_LABEL_GAP = 4;
const MIN_GANTT_LABEL_WIDTH = 160;
const MAX_GANTT_LABEL_WIDTH = 420;

function canShowExitTimeLabel(zoom: ZoomLevel) {
  return zoom === "hour" || zoom === "day";
}

function exitTimeLabel(ev: EventRow, mode: TimelineTimeMode) {
  return timelineDate(ev.actualEndAt ?? ev.endAt, mode).format("HH:mm");
}

function exitTimeTitle(ev: EventRow, mode: TimelineTimeMode) {
  return ev.actualEndAt
    ? `Фактическое время выхода: ${formatTimelineDate(ev.actualEndAt, mode)}`
    : `Плановое время выхода: ${formatTimelineDate(ev.endAt, mode)}`;
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
  return ev.eventType?.name ?? "";
}

function placementLabel(ev: EventRow) {
  return [ev.hangar?.name, ev.reservation?.stand?.code ?? ev.layout?.name].filter(Boolean).join(" / ") || "Без места";
}

function compactHangarLabel(name: string | null | undefined) {
  if (!name) return "";
  const n = String(name).trim();
  const digits = n.match(/\d+/)?.[0];
  if (digits) return `H-${digits}`;
  return n.replace(/^ангар\s*/i, "H-").replace(/\s+/g, "");
}

function hangarAxisLabel(name: string | null | undefined) {
  return String(name ?? "").trim() || "Ангар";
}

function compactStandLabel(code: string | null | undefined) {
  if (!code) return "";
  return String(code).trim().replace(/\s*-\s*/g, "-").replace(/\s+/g, "");
}

function compactBarLabel(ev: EventRow) {
  const type = ev.eventType?.name || ev.title;
  const hangar = compactHangarLabel(ev.hangar?.name);
  const stand = compactStandLabel(ev.reservation?.stand?.code);
  const place = [hangar, stand].filter(Boolean).join("-");
  return place ? `${type}/${place}` : type;
}

function hangarSummaryLabel(ev: EventRow) {
  const placements = ev.placements ?? [];
  const names = placements.length
    ? placements.map((p) => compactHangarLabel(p.hangar?.name ?? "") || compactHangarLabel((p.layout as any)?.hangar?.name ?? ""))
    : [compactHangarLabel(ev.hangar?.name)];
  return Array.from(new Set(names.filter(Boolean))).join(" → ");
}

function standSummaryLabel(ev: EventRow) {
  const placements = ev.placements ?? [];
  const names = placements.length
    ? placements.map((p) => compactStandLabel(p.stand?.code ?? ""))
    : [compactStandLabel(ev.reservation?.stand?.code)];
  return Array.from(new Set(names.filter(Boolean))).join(" → ");
}

function aircraftAxisSubLabel(ev: EventRow) {
  return [ev.eventType?.name, hangarSummaryLabel(ev), standSummaryLabel(ev)].filter(Boolean).join(" • ");
}

function shortEventName(ev: EventRow) {
  return ev.eventType?.name || ev.title;
}

function aircraftBarText(ev: EventRow, width: number, mode: GanttDisplayMode = "CURRENT") {
  const tat = mode === "PLAN_FACT" ? operationalTat(ev) : displayTatForMode(ev, mode);
  const showFull = width >= 80;
  return { tat, parts: [showFull ? ev.title : ""].filter(Boolean) };
}

function hangarBarText(ev: EventRow, width: number, mode: GanttDisplayMode = "CURRENT") {
  const tat = mode === "PLAN_FACT" ? operationalTat(ev) : displayTatForMode(ev, mode);
  const fullName = width >= 230 ? ev.title : "";
  return { tat, parts: [eventAircraftLabel(ev), shortEventName(ev), fullName].filter(Boolean) };
}

function BarLabel(props: { tat: { label: string; source: string }; parts: string[] }) {
  return (
    <span className="barLabel">
      <strong className="barTat" title={props.tat.source}>{props.tat.label}</strong>
      {props.parts.length ? <span className="barText">{props.parts.join(" • ")}</span> : null}
    </span>
  );
}

function eventTooltip(ev: EventRow, mode: TimelineTimeMode = "UTC") {
  const base = `${eventAircraftLabel(ev)} • ${ev.title}`;
  const period = `Опер.: ${formatTimelineDate(ev.startAt, mode)} – ${formatTimelineDate(ev.endAt, mode)}`;
  const place = placementLabel(ev);
  const plan = ev.budgetStartAt && ev.budgetEndAt ? `\nПлан: ${formatTimelineDate(ev.budgetStartAt, mode)} – ${formatTimelineDate(ev.budgetEndAt, mode)}` : "";
  const fact = ev.actualStartAt && ev.actualEndAt ? `\nФакт: ${formatTimelineDate(ev.actualStartAt, mode)} – ${formatTimelineDate(ev.actualEndAt, mode)}` : "";
  const planningKind = `\nТип: ${PLANNING_KIND_LABEL[eventPlanningKind(ev)]}`;
  const prefix = ev.segmentKey ? `Этап: ${place}\n` : "";
  return `${prefix}${base}\n${period}${planningKind}${plan}${fact}`;
}

function eventSegmentsForHangarRows(ev: EventRow): EventRow[] {
  if (!ev.placements?.length) return [ev];
  return ev.placements.map((p, idx) => ({
    ...ev,
    segmentKey: `${ev.id}:placement:${p.id ?? idx}`,
    startAt: p.startAt,
    endAt: p.endAt,
    budgetStartAt: p.budgetStartAt ?? null,
    budgetEndAt: p.budgetEndAt ?? null,
    actualStartAt: p.actualStartAt ?? null,
    actualEndAt: p.actualEndAt ?? null,
    placements: undefined,
    hangar: p.hangar ?? (p.hangarId ? ({ id: p.hangarId, name: ev.hangar?.name ?? "Ангар" } as any) : null),
    layout: p.layout ?? (p.layoutId ? ({ id: p.layoutId, name: ev.layout?.name ?? "Вариант", hangarId: p.hangarId ?? undefined } as any) : null),
    reservation: p.stand ? { stand: p.stand } : null
  }));
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

type TimeScale = "hour" | "day" | "week" | "month" | "quarter" | "year";
type ZoomLevel = TimeScale;

const ZOOM_ORDER: TimeScale[] = ["hour", "day", "week", "month", "quarter", "year"];

const ZOOM_LABEL: Record<TimeScale, string> = {
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
const ZOOM_PX_PER_DAY: Record<TimeScale, number> = {
  hour: 480,     // 20 px / час
  day: 24,
  week: 10,      // ~70 px / неделя
  month: 3,      // ~90 px / месяц
  quarter: 1.1,  // ~100 px / квартал
  year: 0.4      // ~146 px / год
};

type GanttTick = { at: dayjs.Dayjs; minorLabel: string; majorLabel: string | null; majorKey: string };

function startOfScale(d: dayjs.Dayjs, scale: TimeScale): dayjs.Dayjs {
  switch (scale) {
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
}

function addScale(d: dayjs.Dayjs, scale: TimeScale): dayjs.Dayjs {
  switch (scale) {
    case "hour":
      return d.add(1, "hour");
    case "day":
      return d.add(1, "day");
    case "week":
      return d.add(1, "week");
    case "month":
      return d.add(1, "month");
    case "quarter":
      return d.add(3, "month");
    case "year":
      return d.add(1, "year");
  }
}

function labelForScale(d: dayjs.Dayjs, scale: TimeScale) {
  switch (scale) {
    case "hour":
      return d.format("HH");
    case "day":
      return d.format("D");
    case "week": {
      const end = d.add(6, "day");
      return `${d.format("D")}–${end.format("D MMM")}`;
    }
    case "month":
      return d.format("MMM");
    case "quarter": {
      const q = Math.floor(d.month() / 3) + 1;
      return `Q${q}`;
    }
    case "year":
      return d.format("YYYY");
  }
}

function majorLabelForScale(d: dayjs.Dayjs, scale: TimeScale) {
  switch (scale) {
    case "hour":
      return d.format("DD.MM.YYYY HH:00");
    case "day":
      return d.format("DD.MM.YYYY");
    case "week": {
      const end = d.add(6, "day");
      return `${d.format("D MMM YYYY")}–${end.format("D MMM YYYY")}`;
    }
    case "month":
      return d.format("MMM YYYY");
    case "quarter": {
      const q = Math.floor(d.month() / 3) + 1;
      return `Q${q} ${d.format("YYYY")}`;
    }
    case "year":
      return d.format("YYYY");
  }
}

function histogramLabelForScale(d: dayjs.Dayjs, scale: TimeScale) {
  switch (scale) {
    case "hour":
      return d.format("DD.MM HH:00");
    case "day":
      return d.format("DD.MM");
    case "week":
      return `${d.format("DD.MM")}–${d.add(6, "day").format("DD.MM")}`;
    case "month":
      return d.format("MMM YYYY");
    case "quarter":
      return `Q${Math.floor(d.month() / 3) + 1} ${d.format("YYYY")}`;
    case "year":
      return d.format("YYYY");
  }
}

function majorKeyFor(d: dayjs.Dayjs, scale: TimeScale) {
  return startOfScale(d, scale).toISOString();
}

function buildGanttTicks(from: dayjs.Dayjs, to: dayjs.Dayjs, majorScale: TimeScale, minorScale: TimeScale): GanttTick[] {
  const out: GanttTick[] = [];
  let cur = startOfScale(from, minorScale);
  let lastMajorKey = "";
  const HARD_LIMIT = 5000;

  for (let i = 0; i < HARD_LIMIT && cur.valueOf() < to.valueOf(); i++) {
    const majorKey = majorKeyFor(cur, majorScale);
    out.push({
      at: cur,
      minorLabel: labelForScale(cur, minorScale),
      majorLabel: majorKey !== lastMajorKey ? labelForScale(startOfScale(cur, majorScale), majorScale) : null,
      majorKey
    });
    lastMajorKey = majorKey;
    cur = addScale(cur, minorScale);
  }
  return out;
}

function TodayLine(props: { from: dayjs.Dayjs; to: dayjs.Dayjs; canvasWidth: number; currentMinute: dayjs.Dayjs; timeMode: TimelineTimeMode }) {
  const now = props.currentMinute;
  if (now.valueOf() < props.from.valueOf() || now.valueOf() >= props.to.valueOf()) return null;
  const totalDays = Math.max(1 / 1440, props.to.diff(props.from, "day", true));
  const x = (now.diff(props.from, "day", true) / totalDays) * props.canvasWidth;
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
      title={`Текущее время (${props.timeMode}): ${now.format("DD.MM.YYYY HH:mm")}`}
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
  const histogramViewportRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);

  const ptrPreviewRef = useRef<null | { startAt: string; endAt: string; x: number; w: number }>(null);
  const ptrTargetRef = useRef<
    null | { hangarId: string; rowKey: string; intent: "move" | "bump"; bumpedEventId?: string }
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
  const [ganttLabelWidth, setGanttLabelWidth] = useState<number>(() => {
    const raw = Number(savedUi?.ganttLabelWidth);
    return Number.isFinite(raw) ? clamp(raw, MIN_GANTT_LABEL_WIDTH, MAX_GANTT_LABEL_WIDTH) : 220;
  });
  const [currentMinute, setCurrentMinute] = useState(() => dayjs().second(0).millisecond(0));
  const [timelineTimeMode, setTimelineTimeMode] = useState<TimelineTimeMode>(() =>
    savedUi?.timelineTimeMode === "LOCAL" ? "LOCAL" : "UTC"
  );

  const from = useMemo(() => timelineDate(rangeFromApplied, timelineTimeMode).startOf("day"), [rangeFromApplied, timelineTimeMode]);
  // полузакрытый интервал [from, to)
  const to = useMemo(() => timelineDate(rangeToApplied, timelineTimeMode).add(1, "day").startOf("day"), [rangeToApplied, timelineTimeMode]);
  const days = useMemo(() => {
    const d = to.diff(from, "day");
    if (!Number.isFinite(d) || d <= 0) return 1;
    return d;
  }, [from, to]);

  const [groupMode, setGroupMode] = useState<GroupMode>(() => (savedUi?.groupMode === "HANGAR_STAND" ? "HANGAR_STAND" : "AIRCRAFT"));
  const [ganttDisplayMode, setGanttDisplayMode] = useState<GanttDisplayMode>(() =>
    savedUi?.ganttDisplayMode === "PLAN_FACT" ? "PLAN_FACT" : "CURRENT"
  );
  const [majorScale, setMajorScale] = useState<TimeScale>(() => {
    const z = savedUi?.majorScale;
    if ((ZOOM_ORDER as string[]).includes(String(z))) return z as TimeScale;
    const legacy = savedUi?.zoom;
    if (legacy === "hour") return "day";
    if (legacy === "day") return "week";
    if (legacy === "week") return "month";
    if (legacy === "month" || legacy === "quarter") return "year";
    return "week";
  });
  const [minorScale, setMinorScale] = useState<TimeScale>(() => {
    const z = savedUi?.minorScale ?? savedUi?.zoom;
    return (ZOOM_ORDER as string[]).includes(String(z)) ? (z as ZoomLevel) : "day";
  });

  useEffect(() => {
    const minorIdx = ZOOM_ORDER.indexOf(minorScale);
    const majorIdx = ZOOM_ORDER.indexOf(majorScale);
    if (majorIdx > minorIdx || minorScale === "year") return;
    setMajorScale(ZOOM_ORDER[Math.min(minorIdx + 1, ZOOM_ORDER.length - 1)]!);
  }, [majorScale, minorScale]);

  const [filterAircraftTypeIds, setFilterAircraftTypeIds] = useState<string[]>(() => {
    const arr = savedUi?.filterAircraftTypeIds;
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    const one = savedUi?.filterAircraftTypeId;
    return one ? [String(one)] : [];
  });
  const [filterOperatorIds, setFilterOperatorIds] = useState<string[]>(() => {
    const arr = savedUi?.filterOperatorIds;
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    return [];
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
  const [filterPlanningKind, setFilterPlanningKind] = useState<PlanningKindFilter>(() =>
    savedUi?.filterPlanningKind === "PLANNED" || savedUi?.filterPlanningKind === "UNPLANNED" ? savedUi.filterPlanningKind : "ALL"
  );

  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftTypeRef[]>("/api/ref/aircraft-types")
  });

  const operatorsQ = useQuery({
    queryKey: ["ref", "operators"],
    queryFn: () => apiGet<OperatorRef[]>("/api/ref/operators")
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
    setFilterOperatorIds([]);
    setFilterAircraftIds([]);
    setFilterEventTypeIds([]);
    setFilterPlanningKind("ALL");
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
      let layouts: Layout[];
      if (selectedHangarIds.length === 0) {
        layouts = await apiGet<Layout[]>("/api/ref/layouts");
      } else {
        const chunks = await Promise.all(
          selectedHangarIds.map((hid) => apiGet<Layout[]>(`/api/ref/layouts?hangarId=${encodeURIComponent(hid)}`))
        );
        const layoutById = new Map<string, Layout>();
        for (const chunk of chunks) {
          for (const l of chunk) layoutById.set(l.id, l);
        }
        layouts = Array.from(layoutById.values());
      }
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
      ganttDisplayMode,
      majorScale,
      minorScale,
      timelineTimeMode,
      selectedHangarIds,
      filterAircraftTypeIds,
      filterOperatorIds,
      filterAircraftIds,
      filterEventTypeIds,
      filterPlanningKind,
      ganttLabelWidth,
      dndEnabled,
      zoom: minorScale
    });
  }, [
    rangeFromApplied,
    rangeToApplied,
    rangeFromInput,
    rangeToInput,
    groupMode,
    ganttDisplayMode,
    majorScale,
    minorScale,
    timelineTimeMode,
    selectedHangarIds,
    filterAircraftTypeIds,
    filterOperatorIds,
    filterAircraftIds,
    filterEventTypeIds,
    filterPlanningKind,
    ganttLabelWidth,
    dndEnabled,
  ]);

  const events = q.data ?? [];

  const ganttFilters = useMemo<GanttFilters>(
    () => ({
      hangarIds: selectedHangarIds,
      operatorIds: filterOperatorIds,
      aircraftTypeIds: filterAircraftTypeIds,
      aircraftIds: filterAircraftIds,
      eventTypeIds: filterEventTypeIds,
      planningKind: filterPlanningKind
    }),
    [selectedHangarIds, filterOperatorIds, filterAircraftTypeIds, filterAircraftIds, filterEventTypeIds, filterPlanningKind]
  );

  const smartFilterOptions = useMemo(() => {
    const hangarIdSet = new Set<string>();
    const operatorIdSet = new Set<string>();
    const aircraftTypeIdSet = new Set<string>();
    const aircraftIdSet = new Set<string>();
    const eventTypeIdSet = new Set<string>();
    const planningKindSet = new Set<"PLANNED" | "UNPLANNED">();

    for (const e of events) {
      if (eventMatchesGanttFilters(e, ganttFilters, "hangarIds")) {
        for (const id of eventHangarIds(e)) if (id) hangarIdSet.add(id);
      }
      if (eventMatchesGanttFilters(e, ganttFilters, "operatorIds")) {
        const opId = eventOperatorId(e);
        if (opId) operatorIdSet.add(String(opId));
      }
      if (eventMatchesGanttFilters(e, ganttFilters, "aircraftTypeIds")) {
        const tid = eventAircraftTypeId(e);
        if (tid) aircraftTypeIdSet.add(tid);
      }
      if (eventMatchesGanttFilters(e, ganttFilters, "aircraftIds")) {
        const aid = eventAircraftId(e);
        if (aid) aircraftIdSet.add(aid);
      }
      if (eventMatchesGanttFilters(e, ganttFilters, "eventTypeIds")) {
        const etid = eventEventTypeId(e);
        if (etid) eventTypeIdSet.add(etid);
      }
      if (eventMatchesGanttFilters(e, ganttFilters, "planningKind")) {
        planningKindSet.add(eventPlanningKind(e));
      }
    }

    const hangars = (hangarsQ.data ?? [])
      .filter((h) => events.length === 0 || hangarIdSet.has(h.id))
      .map((h) => ({ id: h.id, label: h.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const operators = (operatorsQ.data ?? [])
      .filter((o) => events.length === 0 || operatorIdSet.has(o.id))
      .map((o) => ({ id: o.id, label: o.code ? `${o.code} • ${o.name}` : o.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const aircraftTypes = (aircraftTypesQ.data ?? [])
      .filter((t) => events.length === 0 || aircraftTypeIdSet.has(t.id))
      .map((t) => ({ id: t.id, label: t.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const aircraft = (aircraftQ.data ?? [])
      .filter((a) => events.length === 0 || aircraftIdSet.has(String(a.id)))
      .map((a) => ({ id: a.id, label: a.tailNumber }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const eventTypes = (eventTypesQ.data ?? [])
      .filter((t) => events.length === 0 || eventTypeIdSet.has(t.id))
      .map((t) => ({ id: t.id, label: t.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    return { hangars, operators, aircraftTypes, aircraft, eventTypes, planningKinds: planningKindSet };
  }, [events, ganttFilters, hangarsQ.data, operatorsQ.data, aircraftTypesQ.data, aircraftQ.data, eventTypesQ.data]);

  useEffect(() => {
    if (events.length === 0) return;

    const prune = (selected: string[], available: Set<string>) => selected.filter((id) => available.has(id));
    const hangarAvail = new Set(smartFilterOptions.hangars.map((o) => o.id));
    const operatorAvail = new Set(smartFilterOptions.operators.map((o) => o.id));
    const typeAvail = new Set(smartFilterOptions.aircraftTypes.map((o) => o.id));
    const aircraftAvail = new Set(smartFilterOptions.aircraft.map((o) => o.id));
    const eventTypeAvail = new Set(smartFilterOptions.eventTypes.map((o) => o.id));

    const nextHangars = prune(selectedHangarIds, hangarAvail);
    if (nextHangars.length !== selectedHangarIds.length) setSelectedHangarIds(nextHangars);

    const nextOperators = prune(filterOperatorIds, operatorAvail);
    if (nextOperators.length !== filterOperatorIds.length) setFilterOperatorIds(nextOperators);

    const nextTypes = prune(filterAircraftTypeIds, typeAvail);
    if (nextTypes.length !== filterAircraftTypeIds.length) setFilterAircraftTypeIds(nextTypes);

    const nextAircraft = prune(filterAircraftIds, aircraftAvail);
    if (nextAircraft.length !== filterAircraftIds.length) setFilterAircraftIds(nextAircraft);

    const nextEventTypes = prune(filterEventTypeIds, eventTypeAvail);
    if (nextEventTypes.length !== filterEventTypeIds.length) setFilterEventTypeIds(nextEventTypes);

    if (filterPlanningKind !== "ALL" && !smartFilterOptions.planningKinds.has(filterPlanningKind)) {
      setFilterPlanningKind("ALL");
    }
  }, [
    smartFilterOptions,
    selectedHangarIds,
    filterOperatorIds,
    filterAircraftTypeIds,
    filterAircraftIds,
    filterEventTypeIds,
    filterPlanningKind
  ]);

  const dayWidth = ZOOM_PX_PER_DAY[minorScale];
  const canvasWidth = Math.max(1, Math.round(days * dayWidth));
  const ganttRowHeight = ganttDisplayMode === "PLAN_FACT" ? 56 : 44;
  const ticks = useMemo(() => buildGanttTicks(from, to, majorScale, minorScale), [from, to, majorScale, minorScale]);
  const showSlotHistogram = groupMode === "HANGAR_STAND";
  const ganttLabelColStyle = useMemo(() => ({ width: ganttLabelWidth, flexBasis: ganttLabelWidth }), [ganttLabelWidth]);
  const majorSegments = useMemo(() => {
    const out: Array<{ key: string; label: string; left: number; width: number; alt: boolean }> = [];
    for (let i = 0; i < ticks.length; i++) {
      const tick = ticks[i]!;
      if (out.some((s) => s.key === tick.majorKey)) continue;
      const start = startOfScale(tick.at, majorScale);
      const end = addScale(start, majorScale);
      const left = Math.max(0, start.diff(from, "day", true) * dayWidth);
      const right = Math.min(canvasWidth, end.diff(from, "day", true) * dayWidth);
      if (right <= 0 || left >= canvasWidth) continue;
      out.push({
        key: tick.majorKey,
        label: majorLabelForScale(start, majorScale),
        left,
        width: Math.max(1, right - left),
        alt: out.length % 2 === 1
      });
    }
    return out;
  }, [canvasWidth, dayWidth, from, majorScale, ticks]);

  const startGanttLabelResize = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = ganttLabelWidth;
    const onMove = (ev: PointerEvent) => {
      setGanttLabelWidth(clamp(startWidth + ev.clientX - startX, MIN_GANTT_LABEL_WIDTH, MAX_GANTT_LABEL_WIDTH));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [ganttLabelWidth]);

  useEffect(() => {
    const update = () => setCurrentMinute((timelineTimeMode === "UTC" ? dayjs.utc() : dayjs()).second(0).millisecond(0));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [timelineTimeMode]);

  useEffect(() => {
    // при изменении диапазона/ширины синхронизируем заголовок с текущим scrollLeft тела
    const h = headerViewportRef.current;
    const b = bodyScrollRef.current;
    const g = histogramViewportRef.current;
    const s = bottomScrollRef.current;
    if (!h || !b) return;
    h.scrollLeft = b.scrollLeft;
    if (g) g.scrollLeft = b.scrollLeft;
    if (s) s.scrollLeft = b.scrollLeft;
  }, [days, canvasWidth]);

  const syncGanttScrollLeft = useCallback((scrollLeft: number, source?: "body" | "bottom") => {
    const h = headerViewportRef.current;
    const b = bodyScrollRef.current;
    const g = histogramViewportRef.current;
    const s = bottomScrollRef.current;

    if (h && h.scrollLeft !== scrollLeft) h.scrollLeft = scrollLeft;
    if (b && source !== "body" && b.scrollLeft !== scrollLeft) b.scrollLeft = scrollLeft;
    if (g && g.scrollLeft !== scrollLeft) g.scrollLeft = scrollLeft;
    if (s && source !== "bottom" && s.scrollLeft !== scrollLeft) s.scrollLeft = scrollLeft;
  }, []);

  const onBodyScroll = () => {
    const b = bodyScrollRef.current;
    if (!b) return;
    syncGanttScrollLeft(b.scrollLeft, "body");
  };

  const onBottomScroll = () => {
    const s = bottomScrollRef.current;
    if (!s) return;
    syncGanttScrollLeft(s.scrollLeft, "bottom");
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
  const selectedAircraftTypeId = selectedAircraft?.typeId ?? "";

  // подтверждение изменения
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState<"event" | "reserve" | "towAdd" | "towDel" | "dndMove" | null>(null);
  const [changeReason, setChangeReason] = useState("");

  const openEditorForNew = () => {
    const defaultAircraft = aircraftQ.data?.[0]?.id ?? "";
    const defaultEventType = eventTypesQ.data?.[0]?.id ?? "";
    const defaultStart = dayjs().add(1, "day").hour(9).minute(0).second(0).format("YYYY-MM-DDTHH:mm");
    const defaultEnd = dayjs().add(3, "day").hour(18).minute(0).second(0).format("YYYY-MM-DDTHH:mm");
    const d: EditorDraft = {
      title: "ТО",
      level: "OPERATIONAL",
      status: "PLANNED",
      planningKind: "PLANNED",
      aircraftId: defaultAircraft,
      eventTypeId: defaultEventType,
      startAtLocal: defaultStart,
      endAtLocal: defaultEnd,
      budgetStartAtLocal: defaultStart,
      budgetEndAtLocal: defaultEnd,
      actualStartAtLocal: "",
      actualEndAtLocal: "",
      notes: "",
      hangarId: "",
      layoutId: "",
      standId: "",
      multiPlacement: false,
      placements: [
        {
          startAtLocal: defaultStart,
          endAtLocal: defaultEnd,
          budgetStartAtLocal: defaultStart,
          budgetEndAtLocal: defaultEnd,
          actualStartAtLocal: "",
          actualEndAtLocal: "",
          hangarId: "",
          layoutId: "",
          standId: ""
        }
      ]
    };
    setDraft(d);
    setOriginal(d);
    setChangeReason("");
    setCopyFromTitle(null);
    setEditorOpen(true);
  };

  const openEditorForExisting = (ev: EventRow) => {
    const startAtLocal = toInputLocal(ev.startAt);
    const endAtLocal = toInputLocal(ev.endAt);
    const placements = placementDraftFromEvent(ev);
    const d: EditorDraft = {
      id: ev.id,
      title: ev.title,
      level: ev.level,
      status: (ev.status as any) ?? "PLANNED",
      planningKind: eventPlanningKind(ev),
      aircraftId: (ev.aircraft as any)?.id ?? (ev as any).aircraftId ?? "",
      eventTypeId: (ev.eventType as any)?.id ?? (ev as any)?.eventTypeId ?? "",
      startAtLocal,
      endAtLocal,
      budgetStartAtLocal: toInputLocal(ev.budgetStartAt),
      budgetEndAtLocal: toInputLocal(ev.budgetEndAt),
      actualStartAtLocal: toInputLocal(ev.actualStartAt),
      actualEndAtLocal: toInputLocal(ev.actualEndAt),
      notes: (ev as any)?.notes ?? "",
      hangarId: (ev.hangar as any)?.id ?? "",
      layoutId: (ev.layout as any)?.id ?? "",
      standId: (ev.reservation?.stand as any)?.id ?? "",
      multiPlacement: placements.length > 1,
      placements
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
    const startAtLocal = toInputLocal(ev.startAt);
    const endAtLocal = toInputLocal(ev.endAt);
    const placements = placementDraftFromEvent(ev);
    const d: EditorDraft = {
      title: `${ev.title} (копия)`,
      level: ev.level,
      status: "PLANNED",
      planningKind: eventPlanningKind(ev),
      aircraftId: (ev.aircraft as any)?.id ?? (ev as any).aircraftId ?? "",
      eventTypeId: (ev.eventType as any)?.id ?? (ev as any)?.eventTypeId ?? "",
      startAtLocal,
      endAtLocal,
      budgetStartAtLocal: toInputLocal(ev.budgetStartAt),
      budgetEndAtLocal: toInputLocal(ev.budgetEndAt),
      actualStartAtLocal: "",
      actualEndAtLocal: "",
      notes: (ev as any)?.notes ?? "",
      hangarId: (ev.hangar as any)?.id ?? "",
      layoutId: (ev.layout as any)?.id ?? "",
      standId: (ev.reservation?.stand as any)?.id ?? "",
      multiPlacement: placements.length > 1,
      placements: placements.map((p) => ({ ...p, id: undefined, actualStartAtLocal: "", actualEndAtLocal: "" }))
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
    const fullEvent = events.find((candidate) => candidate.id === ev.id) ?? ev;
    if (copySelectMode) openEditorForCopy(fullEvent);
    else openEditorForExisting(fullEvent);
  };

  const layoutsForEditorQ = useQuery({
    queryKey: ["ref", "layouts", "editor", draft?.hangarId ?? "", selectedAircraftTypeId],
    queryFn: () =>
      apiGet<Layout[]>(
        `/api/ref/layouts?hangarId=${encodeURIComponent(draft!.hangarId)}&activeOnly=1${
          selectedAircraftTypeId ? `&aircraftTypeId=${encodeURIComponent(selectedAircraftTypeId)}` : ""
        }`
      ),
    enabled: !!draft?.hangarId
  });

  const allLayoutsQ = useQuery({
    queryKey: ["ref", "layouts", "all", selectedAircraftTypeId],
    queryFn: () =>
      apiGet<Layout[]>(
        `/api/ref/layouts?activeOnly=1${selectedAircraftTypeId ? `&aircraftTypeId=${encodeURIComponent(selectedAircraftTypeId)}` : ""}`
      )
  });

  const standsForEditorQ = useQuery({
    queryKey: ["ref", "stands", "editor", draft?.layoutId ?? "", selectedAircraftTypeId],
    queryFn: () =>
      apiGet<Stand[]>(
        `/api/ref/stands?layoutId=${encodeURIComponent(draft!.layoutId)}&activeOnly=1${
          selectedAircraftTypeId ? `&aircraftTypeId=${encodeURIComponent(selectedAircraftTypeId)}` : ""
        }`
      ),
    enabled: !!draft?.layoutId
  });

  const allStandsQ = useQuery({
    queryKey: ["ref", "stands", "all", selectedAircraftTypeId],
    queryFn: () =>
      apiGet<Stand[]>(
        `/api/ref/stands?activeOnly=1${selectedAircraftTypeId ? `&aircraftTypeId=${encodeURIComponent(selectedAircraftTypeId)}` : ""}`
      )
  });

  const historyQ = useQuery({
    queryKey: ["event-history", draft?.id ?? ""],
    queryFn: () => apiGet<EventAudit[]>(`/api/events/${draft!.id}/history`),
    enabled: !!draft?.id && editorOpen
  });

  const computeDraftDiff = (a: EditorDraft | null, b: EditorDraft | null) => {
    if (!a || !b) return [];
    const normalizePlacementsForDiff = (items: PlacementDraft[]) =>
      items.map((p) => ({
        startAtLocal: p.startAtLocal,
        endAtLocal: p.endAtLocal,
        budgetStartAtLocal: p.budgetStartAtLocal,
        budgetEndAtLocal: p.budgetEndAtLocal,
        actualStartAtLocal: p.actualStartAtLocal,
        actualEndAtLocal: p.actualEndAtLocal,
        hangarId: p.hangarId,
        layoutId: p.layoutId,
        standId: p.standId
      }));
    const keys: Array<keyof EditorDraft> = [
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
      "multiPlacement"
    ];
    const diffs = keys
      .filter((k) => (a[k] ?? "") !== (b[k] ?? ""))
      .map((k) => ({ field: String(k), from: a[k] ?? "", to: b[k] ?? "" }));
    if (JSON.stringify(normalizePlacementsForDiff(a.placements)) !== JSON.stringify(normalizePlacementsForDiff(b.placements))) {
      diffs.push({ field: "placements", from: "изменено", to: "изменено" });
    }
    return diffs;
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
      const budgetStartAt = fromInputLocalOptional(draft.budgetStartAtLocal);
      const budgetEndAt = fromInputLocalOptional(draft.budgetEndAtLocal);
      if ((budgetStartAt && !budgetEndAt) || (!budgetStartAt && budgetEndAt)) throw new Error("Заполните обе даты бюджетного периода");
      if (budgetStartAt && budgetEndAt && dayjs(budgetEndAt).valueOf() <= dayjs(budgetStartAt).valueOf()) {
        throw new Error("Окончание бюджетного периода должно быть позже начала");
      }
      const actualStartAt = fromInputLocalOptional(draft.actualStartAtLocal);
      const actualEndAt = fromInputLocalOptional(draft.actualEndAtLocal);
      if ((actualStartAt && !actualEndAt) || (!actualStartAt && actualEndAt)) throw new Error("Заполните обе даты фактического периода");
      if (actualStartAt && actualEndAt && dayjs(actualEndAt).valueOf() <= dayjs(actualStartAt).valueOf()) {
        throw new Error("Окончание фактического периода должно быть позже начала");
      }
      const normalizedBudgetStartAt = draft.planningKind === "UNPLANNED" ? null : budgetStartAt ?? startAt;
      const normalizedBudgetEndAt = draft.planningKind === "UNPLANNED" ? null : budgetEndAt ?? endAt;
      const placementsPayload = draft.multiPlacement
        ? placementApiPayload(
            draft.placements.map((p) =>
              draft.planningKind === "UNPLANNED"
                ? { ...p, budgetStartAtLocal: "", budgetEndAtLocal: "" }
                : {
                    ...p,
                    budgetStartAtLocal: p.budgetStartAtLocal || p.startAtLocal,
                    budgetEndAtLocal: p.budgetEndAtLocal || p.endAtLocal
                  }
            )
          )
        : placementApiPayload([
            {
              startAtLocal: draft.startAtLocal,
              endAtLocal: draft.endAtLocal,
              budgetStartAtLocal: normalizedBudgetStartAt ? draft.budgetStartAtLocal || draft.startAtLocal : "",
              budgetEndAtLocal: normalizedBudgetEndAt ? draft.budgetEndAtLocal || draft.endAtLocal : "",
              actualStartAtLocal: draft.actualStartAtLocal,
              actualEndAtLocal: draft.actualEndAtLocal,
              hangarId: draft.hangarId,
              layoutId: draft.layoutId,
              standId: draft.standId
            }
          ]);

      const reason = changeReason.trim();
      const payload = {
        level: draft.level,
        status: draft.status,
        planningKind: draft.planningKind,
        title: draft.title,
        aircraftId: draft.aircraftId,
        eventTypeId: draft.eventTypeId,
        startAt,
        endAt,
        budgetStartAt: normalizedBudgetStartAt,
        budgetEndAt: normalizedBudgetEndAt,
        actualStartAt,
        actualEndAt,
        hangarId: draft.hangarId || null,
        layoutId: draft.layoutId || null,
        placements: placementsPayload,
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
  const [dndBlockedReason, setDndBlockedReason] = useState<string | null>(null);

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
  const [ptrTarget, setPtrTarget] = useState<null | { hangarId: string; rowKey: string; intent: "move" | "bump"; bumpedEventId?: string }>(
    null
  );

  const findDndLayoutLock = useCallback((
    target: { hangarId: string; rowKey: string },
    eventId: string,
    startAt: string,
    endAt: string
  ) => {
    void target;
    void eventId;
    void startAt;
    void endAt;
    return null;
  }, []);

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
        | { hangarId: string; rowKey: string; intent: "move" | "bump"; bumpedEventId?: string } = null;

      // Цель (строка) берём по тому, где находится курсор, а вот "вытеснение" будем определять ОТ GHOST.
      // Поэтому здесь от barEl мы используем только rowKey/layout/stand (не bump).
      if (barEl) {
        const rowEl = (barEl.closest?.("[data-dnd-drop='1']") as HTMLElement | null) ?? null;
        const hangarId = rowEl?.dataset?.hangarId ?? "";
        const rowKey = rowEl?.dataset?.rowKey ?? "";
        if (hangarId && rowKey) {
          nextTarget = { hangarId, rowKey, intent: "move" };
        }
      }

      if (!nextTarget && dropEl) {
        const hangarId = dropEl.dataset?.hangarId ?? "";
        const rowKey = dropEl.dataset?.rowKey ?? "";
        if (hangarId && rowKey) {
          nextTarget = { hangarId, rowKey, intent: "move" };
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
            canvasWidth,
            timeMode: timelineTimeMode
          });
          if (g) {
            const pv = { startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(), x: g.x, w: g.w };

            if (dndBlockedReason) setDndBlockedReason(null);

            if (nextTarget.intent !== "move") {
              nextTarget = { ...nextTarget, intent: "move" };
              ptrTargetRef.current = nextTarget;
              setPtrTarget(nextTarget);
            }
            if (dndHoverIntent !== "move") setDndHoverIntent("move");
            if (dndHoverBarIds.length) setDndHoverBarIds([]);

            ptrPreviewRef.current = pv;
            setPtrPreview(pv);
            return;
          }
        }
      }
      ptrPreviewRef.current = null;
      setPtrPreview(null);
      if (dndBlockedReason) setDndBlockedReason(null);
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
      setDndBlockedReason(null);

      if (!d?.started) return;
      if (!t) return;
      if (!preview) return;

      // размещение с временем
      setPendingDnd({
        eventId: d.eventId,
        hangarId: t.hangarId,
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
  }, [dndActive, ptrDrag, ptrTarget, dndHoverKey, dndHoverBarIds, dndHoverIntent, dndBlockedReason, findDndLayoutLock, timelineTimeMode]);

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
      const path = hasTime ? "/api/reservations/dnd-place-hangar" : "/api/reservations/dnd-move";
      return await apiPost<{ ok: boolean; bumpedEventIds: string[]; placement?: { layoutName?: string; standCode?: string } }>(path, {
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
      const autoPlace = res?.placement ? ` Схема: ${res.placement.layoutName ?? "—"}, место: ${res.placement.standCode ?? "—"}.` : "";
      setDndNotice(bumped ? `Перенос выполнен. Вытеснено событий: ${bumped}.${autoPlace}` : `Перенос выполнен.${autoPlace}`);
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

    const getHangarId = (e: EventRow) => eventPrimaryHangarId(e);
    const getHangarName = (e: EventRow) => (e.hangar as any)?.name ?? "Ангар";
    const getStandId = (e: EventRow) => (e.reservation?.stand as any)?.id ?? "";
    const getStandCode = (e: EventRow) => (e.reservation?.stand as any)?.code ?? "";

    const visible = events
      .filter((e) => eventMatchesGanttFilters(e, ganttFilters))
      .flatMap(eventSegmentsForHangarRows);
    const activeVisible = visible.filter((e) => e.status !== "CANCELLED");
    const cancelledVisible = visible.filter((e) => e.status === "CANCELLED");

    const unassigned = activeVisible.filter((e) => !getHangarId(e) && !e.reservation?.stand);

    const noStandByHangar = new Map<string, { hangarId: string; hangarName: string; events: EventRow[] }>();
    const byStandId = new Map<string, { standId: string; layoutId: string; hangarId: string; label: string; subLabel?: string; events: EventRow[] }>();

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
        const label = meta
          ? `${hangarAxisLabel(meta.hangarName)} / ${compactStandLabel(meta.code)}`
          : `${hangarAxisLabel(hname)} / ${compactStandLabel(scode)}`;
        const subLabel = meta?.layoutName ?? String((e.layout as any)?.name ?? "");
        const rec = byStandId.get(sid) ?? { standId: sid, layoutId, hangarId, label, subLabel, events: [] as EventRow[] };
        rec.events.push(e);
        byStandId.set(sid, rec);
      }
    }

    type Row = {
      key: string;
      label: string;
      subLabel?: string;
      kind: "unassigned" | "hangarNoStand" | "hangar" | "stand" | "cancelled";
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
      rows.push({ key: `hangar:${h.hid}:no-stand`, label: `${hangarAxisLabel(h.hangarName)} / Без места`, kind: "hangarNoStand", hangarId: h.hid, events: h.events });
    }

    // Добавим пустые стоянки как drop-зоны только в режиме DnD
    if (dndActive) {
      for (const s of dndStandsQ.data ?? []) {
        if (selectedHangarIds.length > 0 && !selectedHangarIds.includes(s.hangarId)) continue;
        if (!byStandId.has(s.id)) {
          byStandId.set(s.id, {
            standId: s.id,
            layoutId: s.layoutId,
            hangarId: s.hangarId,
            label: `${hangarAxisLabel(s.hangarName)} / ${compactStandLabel(s.code)}`,
            subLabel: s.layoutName,
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
        subLabel: s.subLabel,
        kind: "stand",
        hangarId: s.hangarId,
        layoutId: s.layoutId,
        standId: s.standId,
        events: s.events
      });
    }

    const laneRows: Array<{ key: string; label: string; subLabel?: string; kind: Row["kind"]; hangarId?: string; layoutId?: string; standId?: string; events: PlacedEvent[] }> = [];
    for (const r of rows) {
      if (r.events.length === 0) {
        // пустая строка — drop-зона
        laneRows.push({ key: `${r.key}:lane:0`, label: r.label, subLabel: r.subLabel, kind: r.kind, hangarId: r.hangarId, layoutId: r.layoutId, standId: r.standId, events: [] });
      } else {
        const lanes = packOverlapsIntoLanes(r.events);
        for (let i = 0; i < lanes.length; i++) {
          const label = i === 0 ? r.label : `${r.label} (нахлёст)`;
          laneRows.push({ key: `${r.key}:lane:${i}`, label, subLabel: r.subLabel, kind: r.kind, hangarId: r.hangarId, layoutId: r.layoutId, standId: r.standId, events: lanes[i]! });
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
  }, [groupMode, ganttFilters, events, dndActive, dndStandsQ.data, dndStandById, selectedHangarIds, hangarsQ.data]);

  // чтобы DnD-логика могла читать строки без "used before declaration"
  useEffect(() => {
    hangarStandRowsRef.current = hangarStandRows as any[];
  }, [hangarStandRows]);

  const isHangarBoundaryRow = useCallback(
    (rowIdx: number) => {
      if (groupMode !== "HANGAR_STAND" || rowIdx <= 0) return false;
      const current = hangarStandRows[rowIdx] as any;
      const previous = hangarStandRows[rowIdx - 1] as any;
      const currentHangarId = String(current?.hangarId ?? "");
      const previousHangarId = String(previous?.hangarId ?? "");
      return Boolean(currentHangarId && currentHangarId !== previousHangarId);
    },
    [groupMode, hangarStandRows]
  );

  const placementLinks = useMemo(() => {
    if (groupMode !== "HANGAR_STAND") return [];
    const bySegmentKey = new Map<string, { rowIdx: number; ev: EventRow }>();
    hangarStandRows.forEach((row, rowIdx) => {
      row.events.forEach((p) => {
        if (p.ev.segmentKey) bySegmentKey.set(p.ev.segmentKey, { rowIdx, ev: p.ev });
      });
    });
    const links: Array<{ key: string; x1: number; y1: number; x2: number; y2: number; color: string }> = [];
    const rowH = ganttRowHeight;
    for (const ev of events) {
      const placements = ev.placements ?? [];
      if (placements.length < 2) continue;
      const sorted = [...placements].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || Date.parse(a.startAt) - Date.parse(b.startAt));
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        const ak = `${ev.id}:placement:${a.id ?? i}`;
        const bk = `${ev.id}:placement:${b.id ?? i + 1}`;
        const ar = bySegmentKey.get(ak);
        const br = bySegmentKey.get(bk);
        if (!ar || !br) continue;
        const ag = calcBarXW({ startAt: a.startAt, endAt: a.endAt, from, dayWidth, canvasWidth, timeMode: timelineTimeMode });
        const bg = calcBarXW({ startAt: b.startAt, endAt: b.endAt, from, dayWidth, canvasWidth, timeMode: timelineTimeMode });
        if (!ag || !bg) continue;
        links.push({
          key: `${ak}->${bk}`,
          x1: ag.x + ag.w,
          y1: ar.rowIdx * rowH + rowH / 2,
          x2: bg.x,
          y2: br.rowIdx * rowH + rowH / 2,
          color: aircraftTypeMarkColor(ev, aircraftPaletteMap)
        });
      }
    }
    return links;
  }, [groupMode, hangarStandRows, events, from, dayWidth, canvasWidth, aircraftPaletteMap, ganttRowHeight, timelineTimeMode]);

  const exportEvents = useMemo(() => {
    return events.filter((e) => eventMatchesGanttFilters(e, ganttFilters));
  }, [events, ganttFilters]);

  const visibleEvents = useMemo(() => exportEvents.filter((e) => e.status !== "CANCELLED"), [exportEvents]);

  const slotHistogram = useMemo(() => {
    if (groupMode !== "HANGAR_STAND") return [];

    const buckets: Array<{ key: string; label: string; left: number; width: number; occupied: number; start: dayjs.Dayjs; end: dayjs.Dayjs }> = [];
    let cursor = startOfScale(from, minorScale);
    const limit = to;

    while (cursor.valueOf() < limit.valueOf()) {
      const bucketStart = cursor;
      const bucketEnd = addScale(cursor, minorScale);
      const visibleStart = bucketStart.valueOf() < from.valueOf() ? from : bucketStart;
      const visibleEnd = bucketEnd.valueOf() > to.valueOf() ? to : bucketEnd;
      let occupied = 0;
      const bucketStartMs = visibleStart.valueOf();
      const bucketEndMs = visibleEnd.valueOf();

      for (const ev of visibleEvents) {
        const placements = ev.placements?.length
          ? ev.placements
          : [
              {
                startAt: ev.startAt,
                endAt: ev.endAt
              }
            ];
        const overlapsBucket = placements.some((p) => {
          const startMs = timelineDate(p.startAt, timelineTimeMode).valueOf();
          const endMs = timelineDate(p.endAt, timelineTimeMode).valueOf();
          return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < bucketEndMs && endMs > bucketStartMs;
        });
        if (overlapsBucket) occupied += 1;
      }

      const left = Math.max(0, visibleStart.diff(from, "day", true) * dayWidth);
      const width = Math.max(1, visibleEnd.diff(visibleStart, "day", true) * dayWidth);
      buckets.push({
        key: bucketStart.toISOString(),
        label: histogramLabelForScale(bucketStart, minorScale),
        left,
        width,
        occupied,
        start: bucketStart,
        end: bucketEnd
      });
      cursor = bucketEnd;
    }
    return buckets;
  }, [groupMode, minorScale, visibleEvents, from, to, dayWidth, timelineTimeMode]);

  const slotHistogramMaxOccupied = useMemo(
    () => Math.max(1, ...slotHistogram.map((bucket) => bucket.occupied)),
    [slotHistogram]
  );

  const hasExitLabelCollision = useCallback(
    (rowEvents: PlacedEvent[], current: EventRow, targetStartAt: string, targetEndAt: string, labelLeft: number, labelRight: number) => {
      for (const item of rowEvents) {
        const ev = item.ev;
        const displayPeriod = dndActive ? { startAt: ev.startAt, endAt: ev.endAt, source: "Опер." as const } : displayPeriodForMode(ev, ganttDisplayMode);
        const intervals = [displayPeriod];
        if (!dndActive && ganttDisplayMode === "PLAN_FACT" && ev.actualStartAt && ev.actualEndAt) {
          intervals.push({ startAt: ev.actualStartAt, endAt: ev.actualEndAt, source: "Факт" as const });
        }

        for (const interval of intervals) {
          const isTarget =
            (ev.segmentKey ?? ev.id) === (current.segmentKey ?? current.id) &&
            interval.startAt === targetStartAt &&
            interval.endAt === targetEndAt;
          if (isTarget) continue;
          const seg = calcBarXW({ startAt: interval.startAt, endAt: interval.endAt, from, dayWidth, canvasWidth, timeMode: timelineTimeMode });
          if (!seg) continue;
          if (labelRight > seg.x - 2 && labelLeft < seg.x + seg.w + 2) return true;
        }
      }
      return false;
    },
    [canvasWidth, dayWidth, dndActive, from, ganttDisplayMode, timelineTimeMode]
  );

  const renderExitTimeLabel = useCallback(
    (rowEvents: PlacedEvent[], ev: EventRow, seg: { x: number; w: number }, targetStartAt: string, targetEndAt: string, targetIsFact: boolean) => {
      if (!canShowExitTimeLabel(minorScale)) return null;
      const labelLeft = seg.x + seg.w + EXIT_TIME_LABEL_GAP;
      const labelRight = labelLeft + EXIT_TIME_LABEL_WIDTH;
      if (labelRight > canvasWidth - 2) return null;
      if (hasExitLabelCollision(rowEvents, ev, targetStartAt, targetEndAt, labelLeft, labelRight)) return null;
      const top = ganttDisplayMode === "PLAN_FACT" ? (targetIsFact ? 34 : 8) : 14;
      return (
        <span
          className={`exitTimeLabel${targetIsFact ? " exitTimeLabelFact" : ""}`}
          style={{ left: labelLeft, top, width: EXIT_TIME_LABEL_WIDTH }}
          title={exitTimeTitle(ev, timelineTimeMode)}
        >
          {exitTimeLabel(ev, timelineTimeMode)}
        </span>
      );
    },
    [canvasWidth, ganttDisplayMode, hasExitLabelCollision, minorScale, timelineTimeMode]
  );

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
      ...visibleEvents.map((ev) => {
        const segments = eventSegmentsForHangarRows(ev);
        return {
          key: ev.id,
          label: eventAircraftLabel(ev),
          subLabel: aircraftAxisSubLabel(ev) || formatRowLabel(ev) || ev.title,
          events: segments.map((segment) => ({ ev: segment, overlapToMs: null } as PlacedEvent))
        };
      }),
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
    for (const o of operatorsQ.data ?? []) {
      if (o.id && !m.has(o.id)) m.set(o.id, o.name);
    }
    for (const a of aircraftQ.data ?? []) {
      if (a.operator?.id && !m.has(a.operator.id)) m.set(a.operator.id, a.operator.name);
    }
    return m;
  }, [aircraftQ.data, operatorsQ.data]);

  const reportRows = useMemo(() => {
    return [...exportEvents]
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.title.localeCompare(b.title, "ru"))
      .map((ev) => {
        const start = dayjs(ev.startAt);
        const end = dayjs(ev.endAt);
        const durationHours = Math.max(0, end.diff(start, "minute")) / 60;
        const rangeStartMs = Math.max(start.valueOf(), from.valueOf());
        const rangeEndMs = Math.min(end.valueOf(), to.valueOf());
        const rangeDurationHours =
          start.isValid() && end.isValid() && rangeEndMs > rangeStartMs ? (rangeEndMs - rangeStartMs) / (60 * 60 * 1000) : 0;
        const rangeStart = dayjs(rangeStartMs);
        const rangeEnd = dayjs(rangeEndMs);
        const budgetHours = tatHours(ev.budgetStartAt, ev.budgetEndAt);
        const actualHours = tatHours(ev.actualStartAt, ev.actualEndAt);
        const towSegments = ev.towSegments ?? [];
        const placements = ev.placements ?? [];
        return {
          "Название": ev.title,
          "Борт": eventAircraftLabel(ev),
          "Оператор": eventOperatorLabel(ev, operatorNameById),
          "Тип ВС": eventAircraftTypeLabel(ev, aircraftTypeById),
          "Тип события": ev.eventType?.name ?? "—",
          "Уровень": LEVEL_LABEL[ev.level] ?? ev.level,
          "Статус": STATUS_LABEL[ev.status] ?? ev.status,
          "Тип планирования": PLANNING_KIND_LABEL[eventPlanningKind(ev)] ?? eventPlanningKind(ev),
          "Начало": toExcelDate(ev.startAt),
          "Окончание": toExcelDate(ev.endAt),
          "Оперативный TAT, часов": Number(durationHours.toFixed(2)),
          "Оперативный TAT, дней": Number((durationHours / 24).toFixed(2)),
          "Начало в выбранном периоде": rangeDurationHours > 0 ? rangeStart.toDate() : "",
          "Окончание в выбранном периоде": rangeDurationHours > 0 ? rangeEnd.toDate() : "",
          "TAT в выбранном периоде, часов": Number(rangeDurationHours.toFixed(2)),
          "TAT в выбранном периоде, дней": Number((rangeDurationHours / 24).toFixed(2)),
          "Бюджетное начало": toExcelDate(ev.budgetStartAt),
          "Бюджетное окончание": toExcelDate(ev.budgetEndAt),
          "Бюджетный TAT, часов": budgetHours == null ? "" : Number(budgetHours.toFixed(2)),
          "Фактическое начало": toExcelDate(ev.actualStartAt),
          "Фактическое окончание": toExcelDate(ev.actualEndAt),
          "Фактический TAT, часов": actualHours == null ? "" : Number(actualHours.toFixed(2)),
          "Отклонение факт/оператив, часов": actualHours == null ? "" : Number((actualHours - durationHours).toFixed(2)),
          "Отклонение факт/бюджет, часов": actualHours == null || budgetHours == null ? "" : Number((actualHours - budgetHours).toFixed(2)),
          "Год начала": start.isValid() ? start.format("YYYY") : "—",
          "Квартал начала": start.isValid() ? `Q${Math.floor(start.month() / 3) + 1}` : "—",
          "Месяц начала": start.isValid() ? start.format("YYYY-MM") : "—",
          "Ангар": ev.hangar?.name ?? "—",
          "Вариант размещения": ev.layout?.name ?? "—",
          "Место": ev.reservation?.stand?.code ?? "—",
          "Есть резерв": ev.reservation?.stand ? "Да" : "Нет",
          "Этапов размещения": placements.length || 1,
          "Интервалы размещения": placements
            .map((p, idx) => {
              const place = p.stand?.code ?? p.layout?.name ?? p.hangar?.name ?? "без места";
              return `${idx + 1}. ${formatExportDate(p.startAt)} – ${formatExportDate(p.endAt)} · ${place}`;
            })
            .join("; "),
          "Буксировок": towSegments.length,
          "Интервалы буксировок": towSegments
            .map((t) => `${formatExportDate(t.startAt)} – ${formatExportDate(t.endAt)}`)
            .join("; "),
          "Примечание": String((ev as any).notes ?? ""),
          "ID события": ev.id
        };
      });
  }, [exportEvents, aircraftTypeById, operatorNameById, from, to]);

  const exportBaseName = `gantt-${rangeFromApplied}-${rangeToApplied}`;
  const reportMeta = [
    `Период: ${timelineDate(rangeFromApplied, timelineTimeMode).format("DD.MM.YYYY")} – ${timelineDate(rangeToApplied, timelineTimeMode).format("DD.MM.YYYY")}`,
    `Шкала: ${ZOOM_LABEL[majorScale]} / ${ZOOM_LABEL[minorScale]}`,
    `Время: ${timelineTimeMode}`,
    `Вид: ${ganttDisplayMode === "CURRENT" ? "Текущий график" : "План-факт"}`,
    `Группировка: ${groupMode === "AIRCRAFT" ? "Борт / событие" : "Ангар / место"}`,
    `Контур: ${activeSandbox ? `песочница «${activeSandbox.name}»` : "рабочий контур"}`,
    `Событий: ${reportRows.length}`
  ];

  const exportTableXlsx = () => {
    if (reportRows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(reportRows, { cellDates: true });
    const columns = Object.keys(reportRows[0] ?? {});
    ws["!cols"] = columns.map((key) => ({
      wch: Math.min(42, Math.max(12, key.length + 4))
    }));
    const dateColumns = new Set([
      "Начало",
      "Окончание",
      "Начало в выбранном периоде",
      "Окончание в выбранном периоде",
      "Бюджетное начало",
      "Бюджетное окончание",
      "Фактическое начало",
      "Фактическое окончание"
    ]);
    const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
    if (range) {
      for (const [idx, key] of columns.entries()) {
        if (!dateColumns.has(key)) continue;
        for (let row = range.s.r + 1; row <= range.e.r; row++) {
          const cell = ws[XLSX.utils.encode_cell({ r: row, c: idx })];
          if (cell && cell.t === "d") cell.z = "dd.mm.yyyy hh:mm";
        }
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "События");
    XLSX.writeFile(wb, `${exportBaseName}-events.xlsx`);
  };

  const exportTablePdf = () => {
    if (reportRows.length === 0) return;
    const columns = Object.keys(reportRows[0] ?? {});
    const header = columns.map((c) => `<th>${htmlEscape(c)}</th>`).join("");
    const body = reportRows
      .map((row) => `<tr>${columns.map((c) => `<td>${htmlEscape(formatReportCell((row as any)[c]))}</td>`).join("")}</tr>`)
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
    const rowH = ganttDisplayMode === "PLAN_FACT" ? 58 : 30;
    const headerH = 58;
    const height = headerH + rowsWithEvents.length * rowH + 22;
    const width = labelW + chartW + 24;
    const rangeMs = Math.max(1, to.valueOf() - from.valueOf());
    const xFor = (v: string) => labelW + ((timelineDate(v, timelineTimeMode).valueOf() - from.valueOf()) / rangeMs) * chartW;
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
            const displayPeriod = displayPeriodForMode(ev, ganttDisplayMode);
            const x = clamp(xFor(displayPeriod.startAt), labelW, labelW + chartW);
            const right = clamp(xFor(displayPeriod.endAt), labelW, labelW + chartW);
            const w = Math.max(2, right - x);
            const fill = ev.status === "CANCELLED" ? "#94a3b8" : aircraftTypeMarkColor(ev, aircraftPaletteMap);
            const stroke = ev.status === "DONE" ? "#16a34a" : ev.status === "CANCELLED" ? "#64748b" : "#0f172a";
            const label = compactBarLabel(ev);
            const actualSvg =
              ganttDisplayMode === "PLAN_FACT" && ev.actualStartAt && ev.actualEndAt
                ? (() => {
                    const ax = clamp(xFor(ev.actualStartAt), labelW, labelW + chartW);
                    const ar = clamp(xFor(ev.actualEndAt), labelW, labelW + chartW);
                    const aw = Math.max(2, ar - ax);
                    const tone = factTone(ev);
                    const factFill = tone === "bad" ? "#dc2626" : tone === "warn" ? "#f97316" : "#16a34a";
                    return `<rect x="${ax.toFixed(1)}" y="${y + 29}" width="${aw.toFixed(1)}" height="22" rx="8" fill="${factFill}" opacity="0.95" />`;
                  })()
                : "";
            const barY = ganttDisplayMode === "PLAN_FACT" ? y + 5 : y + 6;
            const barH = ganttDisplayMode === "PLAN_FACT" ? 22 : 18;
            return `<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" rx="5" fill="${htmlEscape(fill)}" stroke="${stroke}" stroke-width="1" opacity="${ev.status === "CANCELLED" ? "0.55" : "0.88"}" />
              ${actualSvg}
              ${w > 80 ? `<text x="${(x + 6).toFixed(1)}" y="${ganttDisplayMode === "PLAN_FACT" ? y + 15 : y + 19}" font-size="9" fill="#ffffff">${htmlEscape(label.slice(0, 58))}</text>` : ""}`;
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

  const applyManualRange = () => {
    if (!isValidDateInput(rangeFromInput) || !isValidDateInput(rangeToInput)) {
      setRangeError("Укажите корректный период.");
      return;
    }
    if (dayjs(rangeFromInput).isAfter(dayjs(rangeToInput))) {
      setRangeError("Дата начала не может быть позже даты окончания.");
      return;
    }
    setRangeFromApplied(rangeFromInput);
    setRangeToApplied(rangeToInput);
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

  const layoutsByHangar = useMemo(() => {
    const m = new Map<string, Layout[]>();
    for (const l of allLayoutsQ.data ?? []) {
      const arr = m.get(l.hangarId) ?? [];
      arr.push(l);
      m.set(l.hangarId, arr);
    }
    return m;
  }, [allLayoutsQ.data]);

  const standsByLayout = useMemo(() => {
    const m = new Map<string, Stand[]>();
    for (const s of allStandsQ.data ?? []) {
      const arr = m.get(s.layoutId) ?? [];
      arr.push(s);
      m.set(s.layoutId, arr);
    }
    return m;
  }, [allStandsQ.data]);

  const setDraftPlacement = (idx: number, patch: Partial<PlacementDraft>) => {
    setDraft((d) => {
      if (!d) return d;
      const next = d.placements.map((p, i) => (i === idx ? { ...p, ...patch } : p));
      return { ...d, placements: next };
    });
  };

  const setMultiPlacementMode = (enabled: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      if (enabled) {
        const first = d.placements[0] ?? {
          startAtLocal: d.startAtLocal,
          endAtLocal: d.endAtLocal,
              budgetStartAtLocal: d.budgetStartAtLocal,
              budgetEndAtLocal: d.budgetEndAtLocal,
              actualStartAtLocal: d.actualStartAtLocal,
              actualEndAtLocal: d.actualEndAtLocal,
          hangarId: d.hangarId,
          layoutId: d.layoutId,
          standId: d.standId
        };
        return {
          ...d,
          multiPlacement: true,
          placements: [{
            ...first,
            startAtLocal: d.startAtLocal,
            endAtLocal: d.endAtLocal,
            budgetStartAtLocal: d.budgetStartAtLocal,
            budgetEndAtLocal: d.budgetEndAtLocal,
            actualStartAtLocal: d.actualStartAtLocal,
            actualEndAtLocal: d.actualEndAtLocal
          }]
        };
      }
      const first = d.placements[0];
      return {
        ...d,
        multiPlacement: false,
        hangarId: first?.hangarId ?? d.hangarId,
        layoutId: first?.layoutId ?? d.layoutId,
        standId: first?.standId ?? d.standId,
        placements: [
          {
            startAtLocal: d.startAtLocal,
            endAtLocal: d.endAtLocal,
            budgetStartAtLocal: first?.budgetStartAtLocal ?? d.budgetStartAtLocal,
            budgetEndAtLocal: first?.budgetEndAtLocal ?? d.budgetEndAtLocal,
            actualStartAtLocal: first?.actualStartAtLocal ?? d.actualStartAtLocal,
            actualEndAtLocal: first?.actualEndAtLocal ?? d.actualEndAtLocal,
            hangarId: first?.hangarId ?? d.hangarId,
            layoutId: first?.layoutId ?? d.layoutId,
            standId: first?.standId ?? d.standId
          }
        ]
      };
    });
  };

  const addPlacementDraft = () => {
    setDraft((d) => {
      if (!d) return d;
      const prev = d.placements[d.placements.length - 1];
      const startAtLocal = prev?.endAtLocal || d.startAtLocal;
      const endAtLocal = dayjs(startAtLocal).add(12, "hour").format("YYYY-MM-DDTHH:mm");
      return {
        ...d,
        multiPlacement: true,
        placements: [...d.placements, {
          startAtLocal,
          endAtLocal,
          budgetStartAtLocal: "",
          budgetEndAtLocal: "",
          actualStartAtLocal: "",
          actualEndAtLocal: "",
          hangarId: "",
          layoutId: "",
          standId: ""
        }]
      };
    });
  };

  const removePlacementDraft = (idx: number) => {
    setDraft((d) => {
      if (!d) return d;
      const next = d.placements.filter((_p, i) => i !== idx);
      return { ...d, placements: next.length ? next : d.placements };
    });
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card ganttPanel">
        <div className="ganttPanelHeader">
          <div className="ganttPanelTitle">
            <strong>План</strong>
            <span className="muted ganttPanelPeriod">
              {dayjs.utc(rangeFromApplied).format("DD.MM.YYYY")} – {dayjs.utc(rangeToApplied).format("DD.MM.YYYY")}
              <span className="ganttPanelDot" aria-hidden="true">·</span>
              {ZOOM_LABEL[majorScale]} / {ZOOM_LABEL[minorScale]}
              <span className="ganttPanelDot" aria-hidden="true">·</span>
              {ganttDisplayMode === "CURRENT" ? "Текущий график" : "План-факт"}
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
            <label className="tgField" title="Текущий график показывает факт вместо плана, когда факт заполнен; План-факт показывает два бара">
              <span className="tgFieldLabel">Отображение</span>
              <select value={ganttDisplayMode} onChange={(e) => setGanttDisplayMode(e.target.value as GanttDisplayMode)}>
                <option value="CURRENT">Текущий график</option>
                <option value="PLAN_FACT">План-факт</option>
              </select>
            </label>
            <label className="tgField" title="Крупные блоки шкалы времени">
              <span className="tgFieldLabel">Major</span>
              <select value={majorScale} onChange={(e) => setMajorScale(e.target.value as TimeScale)}>
                {ZOOM_ORDER.filter((z) => ZOOM_ORDER.indexOf(z) > ZOOM_ORDER.indexOf(minorScale) || (minorScale === "year" && z === "year")).map((z) => (
                  <option key={z} value={z}>
                    {ZOOM_LABEL[z]}
                  </option>
                ))}
              </select>
            </label>
            <label className="tgField" title="Мелкие деления сетки, ширина канваса и шаг гистограммы">
              <span className="tgFieldLabel">Minor</span>
              <select
                value={minorScale}
                onChange={(e) => {
                  const next = e.target.value as TimeScale;
                  setMinorScale(next);
                  const nextIdx = ZOOM_ORDER.indexOf(next);
                  const majorIdx = ZOOM_ORDER.indexOf(majorScale);
                  if (majorIdx <= nextIdx && next !== "year") {
                    setMajorScale(ZOOM_ORDER[Math.min(nextIdx + 1, ZOOM_ORDER.length - 1)]!);
                  }
                }}
              >
                {ZOOM_ORDER.map((z) => (
                  <option key={z} value={z}>
                    {ZOOM_LABEL[z]}
                  </option>
                ))}
              </select>
            </label>
            <label className="tgField" title="Часовой режим отображения таймлайна">
              <span className="tgFieldLabel">Время</span>
              <select value={timelineTimeMode} onChange={(e) => setTimelineTimeMode(e.target.value as TimelineTimeMode)}>
                <option value="UTC">UTC</option>
                <option value="LOCAL">Local</option>
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
                options={smartFilterOptions.hangars}
                value={selectedHangarIds}
                onChange={setSelectedHangarIds}
                placeholder="все"
                width={150}
                maxHeight={320}
                searchable
                searchPlaceholder="Найти ангар"
                compact
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Оператор</span>
              <MultiSelectDropdown
                options={smartFilterOptions.operators}
                value={filterOperatorIds}
                onChange={setFilterOperatorIds}
                placeholder="все"
                width={160}
                maxHeight={360}
                searchable
                searchPlaceholder="Найти оператора"
                compact
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Тип ВС</span>
              <MultiSelectDropdown
                options={smartFilterOptions.aircraftTypes}
                value={filterAircraftTypeIds}
                onChange={setFilterAircraftTypeIds}
                placeholder="все"
                width={150}
                maxHeight={360}
                searchable
                searchPlaceholder="Найти тип ВС"
                compact
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Борт</span>
              <MultiSelectDropdown
                options={smartFilterOptions.aircraft}
                value={filterAircraftIds}
                onChange={setFilterAircraftIds}
                placeholder="все"
                width={140}
                maxHeight={360}
                searchable
                searchPlaceholder="Найти борт"
                compact
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Тип события</span>
              <MultiSelectDropdown
                options={smartFilterOptions.eventTypes}
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
            <label className="tgField">
              <span className="tgFieldLabel">Планирование</span>
              <select value={filterPlanningKind} onChange={(e) => setFilterPlanningKind(e.target.value as PlanningKindFilter)}>
                <option value="ALL">все</option>
                <option value="PLANNED" disabled={events.length > 0 && !smartFilterOptions.planningKinds.has("PLANNED")}>
                  плановые
                </option>
                <option value="UNPLANNED" disabled={events.length > 0 && !smartFilterOptions.planningKinds.has("UNPLANNED")}>
                  внеплановые
                </option>
              </select>
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
                onChange={(e) => setRangeFromInput(e.target.value)}
                onBlur={applyManualRange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyManualRange();
                }}
                style={{ width: 150 }}
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">по</span>
              <input
                type="date"
                value={rangeToInput}
                onChange={(e) => setRangeToInput(e.target.value)}
                onBlur={applyManualRange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyManualRange();
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

        {copySelectMode || (dndEnabled && !dndActive) || dndNotice || dndBlockedReason || rangeError || q.isFetching || q.error ? (
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
            {dndBlockedReason ? <span className="gpChip gpChipError">{dndBlockedReason}</span> : null}
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
                <span className="ganttLegendItem">
                  <span className="legendBar legendPlanFactSample" aria-hidden="true">
                    <span className="legendPlanFactPlan" />
                    <span className="legendPlanFactActual legendPlanFactActualGood" />
                  </span>
                  План-факт: верхний — оперативный план, нижний — факт
                </span>
                <span className="ganttLegendItem">
                  <span className="legendBar legendFactGood" aria-hidden="true" />
                  Факт в срок, TAT не больше плана
                </span>
                <span className="ganttLegendItem">
                  <span className="legendBar legendFactWarn" aria-hidden="true" />
                  Факт требует внимания
                </span>
                <span className="ganttLegendItem">
                  <span className="legendBar legendFactBad" aria-hidden="true" />
                  Факт позже плана, TAT больше
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
          <div className="ganttLabel ganttAxisLabel" style={ganttLabelColStyle}>
            <strong>{groupMode === "AIRCRAFT" ? "Борт / событие" : "Ангар / место"}</strong>
            <button
              type="button"
              className="ganttAxisResizeHandle"
              onPointerDown={startGanttLabelResize}
              title="Потяните, чтобы изменить ширину левой оси"
              aria-label="Изменить ширину левой оси"
            />
          </div>
          <div className="ganttHeaderRightViewport" ref={headerViewportRef}>
            <div className="ganttCanvas" style={{ width: canvasWidth, height: 44 }}>
              <TodayLine from={from} to={to} canvasWidth={canvasWidth} currentMinute={currentMinute} timeMode={timelineTimeMode} />
              <div className="ganttTimelineMinorRow">
                {ticks.map((t, i) => {
                  const nextAt = ticks[i + 1]?.at ?? to;
                  const leftRaw = t.at.diff(from, "day", true) * dayWidth;
                  const rightRaw = nextAt.diff(from, "day", true) * dayWidth;
                  const left = Math.max(0, leftRaw);
                  const width = Math.max(1, rightRaw - left);
                  const majorIdx = majorSegments.findIndex((candidate) => candidate.key === t.majorKey);
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
                        background: majorIdx % 2 ? "rgba(148, 163, 184, 0.08)" : "transparent",
                        padding: minorScale === "hour" ? "2px 1px" : "2px 4px",
                        overflow: "hidden",
                        boxSizing: "border-box"
                      }}
                      title={`${majorLabelForScale(startOfScale(t.at, majorScale), majorScale)} • ${t.minorLabel}`}
                    >
                      <div
                        style={{
                          fontSize: minorScale === "hour" ? 10 : 12,
                          lineHeight: "18px",
                          color: "#64748b",
                          whiteSpace: "nowrap",
                          textAlign: minorScale === "hour" ? "center" : "left"
                        }}
                      >
                        {t.minorLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="ganttTimelineMajorRow">
                {majorSegments.map((m) => (
                  <div
                    key={m.key}
                    className={`ganttTimelineMajorCell${m.alt ? " ganttTimelineMajorCellAlt" : ""}`}
                    style={{ left: m.left, width: m.width }}
                    title={m.label}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="ganttBody">
          <div className="ganttLeftCol" style={ganttLabelColStyle}>
            {groupMode === "AIRCRAFT"
              ? aircraftRows.map((r, rowIdx) => (
                  <div className={`ganttLabel${rowIdx % 2 ? " ganttRowAlt" : ""}`} key={r.key} style={{ height: ganttRowHeight }}>
                    <div>
                      <strong>{r.label}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r.subLabel}
                    </div>
                  </div>
                ))
              : hangarStandRows.map((r, rowIdx) => (
                  <div
                    className={`ganttLabel${rowIdx % 2 ? " ganttRowAlt" : ""}${isHangarBoundaryRow(rowIdx) ? " ganttHangarBoundary" : ""}`}
                    key={r.key}
                    style={{ height: ganttRowHeight }}
                  >
                    <div>
                      <strong>{r.label}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {(r as any).subLabel ?? ""}
                    </div>
                  </div>
                ))}
          </div>

          <div className="ganttRightCol">
            <div className="ganttRightScroll" ref={bodyScrollRef} onScroll={onBodyScroll}>
              <div className="ganttRightInner" style={{ width: canvasWidth }}>
                {groupMode === "HANGAR_STAND" && placementLinks.length > 0 ? (
                  <svg
                    className="placementLinkLayer"
                    width={canvasWidth}
                    height={Math.max(ganttRowHeight, hangarStandRows.length * ganttRowHeight)}
                    aria-hidden="true"
                  >
                    {placementLinks.map((l) => (
                      <line
                        key={l.key}
                        x1={l.x1}
                        y1={l.y1}
                        x2={l.x2}
                        y2={l.y2}
                        stroke={l.color}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        opacity={0.75}
                      />
                    ))}
                  </svg>
                ) : null}
                {groupMode === "AIRCRAFT"
                  ? aircraftRows.map((r, rowIdx) => (
                      <div className={`ganttCanvas${rowIdx % 2 ? " ganttRowAlt" : ""}`} key={r.key} style={{ width: canvasWidth, minHeight: ganttRowHeight }}>
                        <TodayLine from={from} to={to} canvasWidth={canvasWidth} currentMinute={currentMinute} timeMode={timelineTimeMode} />
                        {r.events.map((p) => {
                          const ev = p.ev;
                          const displayPeriod = dndActive ? { startAt: ev.startAt, endAt: ev.endAt, source: "Опер." as const } : displayPeriodForMode(ev, ganttDisplayMode);
                          const g = calcBarXW({ startAt: displayPeriod.startAt, endAt: displayPeriod.endAt, from, dayWidth, canvasWidth, timeMode: timelineTimeMode });
                          if (!g) return null;
                          const { x, w } = g;
                          const color = aircraftTypeMarkColor(ev, aircraftPaletteMap);
                          const visual = barVisualStyle(ev.status, color);
                          const actualSeg =
                            ganttDisplayMode === "PLAN_FACT" && ev.actualStartAt && ev.actualEndAt
                              ? calcBarXW({ startAt: ev.actualStartAt, endAt: ev.actualEndAt, from, dayWidth, canvasWidth, timeMode: timelineTimeMode })
                              : null;
                          const actualTone = factTone(ev);
                          const exitTargetIsFact = Boolean(actualSeg) || displayPeriod.source === "Факт";
                          const exitTargetSeg = actualSeg ?? g;
                          const exitTargetStartAt = exitTargetIsFact && ev.actualStartAt ? ev.actualStartAt : displayPeriod.startAt;
                          const exitTargetEndAt = exitTargetIsFact && ev.actualEndAt ? ev.actualEndAt : displayPeriod.endAt;

                          return (
                            <Fragment key={ev.segmentKey ?? ev.id}>
                              <div
                                className={`bar${ganttDisplayMode === "PLAN_FACT" ? " barPlanFactPlan" : ""}${displayPeriod.source === "Факт" ? " barCurrentFact" : ""}`}
                                style={{
                                  left: x,
                                  width: w,
                                  cursor: "pointer",
                                  ...visual,
                                  ...barPaddingStyle(w)
                                }}
                                onClick={() => pickEvent(ev)}
                                title={`${eventTooltip(ev, timelineTimeMode)}\n${copySelectMode ? "Нажмите, чтобы создать копию" : "Нажмите, чтобы редактировать"}`}
                              >
                                {displayPeriod.source === "Опер." ? renderTowBreaks({ ev, barX: x, barW: w, from, dayWidth, canvasWidth, timeMode: timelineTimeMode }) : null}
                                {displayPeriod.source === "Опер." ? renderPlacementBreaks({ ev, barX: x, barW: w, from, dayWidth, canvasWidth, timeMode: timelineTimeMode }) : null}
                                {canShowBarTitle(w) ? (
                                  <span style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
                                    <BarLabel {...aircraftBarText(ev, w, ganttDisplayMode)} />
                                  </span>
                                ) : null}
                              </div>
                              {actualSeg ? (
                                <div
                                  className={`factBar factBar${actualTone[0].toUpperCase()}${actualTone.slice(1)}`}
                                  style={{ left: actualSeg.x, width: actualSeg.w }}
                                  title={`${factToneLabel(actualTone)}: ${formatTimelineDate(ev.actualStartAt, timelineTimeMode)} – ${formatTimelineDate(ev.actualEndAt, timelineTimeMode)}`}
                                />
                              ) : null}
                              {renderExitTimeLabel(r.events, ev, exitTargetSeg, exitTargetStartAt, exitTargetEndAt, exitTargetIsFact)}
                            </Fragment>
                          );
                        })}
                      </div>
                    ))
                  : hangarStandRows.map((r, rowIdx) => (
                      <div
                        className={`ganttCanvas${rowIdx % 2 ? " ganttRowAlt" : ""}${isHangarBoundaryRow(rowIdx) ? " ganttHangarBoundary" : ""}`}
                        key={r.key}
                        style={{
                          width: canvasWidth,
                          minHeight: ganttRowHeight,
                          outline:
                            dndActive && dndHoverKey === r.key && dndHoverIntent === "move"
                              ? "2px solid rgba(37, 99, 235, 0.55)"
                              : undefined,
                          outlineOffset: -2
                        }}
                        data-dnd-drop={dndActive && r.kind === "stand" && r.hangarId ? "1" : undefined}
                        data-row-key={r.key}
                        data-hangar-id={r.hangarId ?? ""}
                      >
                        <TodayLine from={from} to={to} canvasWidth={canvasWidth} currentMinute={currentMinute} timeMode={timelineTimeMode} />
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
                          const displayPeriod = dndActive ? { startAt: ev.startAt, endAt: ev.endAt, source: "Опер." as const } : displayPeriodForMode(ev, ganttDisplayMode);
                          const g = calcBarXW({ startAt: displayPeriod.startAt, endAt: displayPeriod.endAt, from, dayWidth, canvasWidth, timeMode: timelineTimeMode });
                          if (!g) return null;
                          const { x, w } = g;
                          const color = aircraftTypeMarkColor(ev, aircraftPaletteMap);
                          const visual = barVisualStyle(ev.status, color);
                          const actualSeg =
                            ganttDisplayMode === "PLAN_FACT" && ev.actualStartAt && ev.actualEndAt
                              ? calcBarXW({ startAt: ev.actualStartAt, endAt: ev.actualEndAt, from, dayWidth, canvasWidth, timeMode: timelineTimeMode })
                              : null;
                          const actualTone = factTone(ev);
                          const exitTargetIsFact = Boolean(actualSeg) || displayPeriod.source === "Факт";
                          const exitTargetSeg = actualSeg ?? g;
                          const exitTargetStartAt = exitTargetIsFact && ev.actualStartAt ? ev.actualStartAt : displayPeriod.startAt;
                          const exitTargetEndAt = exitTargetIsFact && ev.actualEndAt ? ev.actualEndAt : displayPeriod.endAt;

                          return (
                            <Fragment key={ev.id}>
                              <div
                              className={`bar${ganttDisplayMode === "PLAN_FACT" ? " barPlanFactPlan" : ""}${displayPeriod.source === "Факт" ? " barCurrentFact" : ""}`}
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
                              title={`${eventTooltip(ev, timelineTimeMode)}\n${copySelectMode ? "Нажмите, чтобы создать копию" : "Нажмите, чтобы редактировать"}`}
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
                              {displayPeriod.source === "Опер." ? renderTowBreaks({ ev, barX: x, barW: w, from, dayWidth, canvasWidth, timeMode: timelineTimeMode }) : null}
                              {canShowBarTitle(w) ? (
                                <span style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
                                  <BarLabel {...hangarBarText(ev, w, ganttDisplayMode)} />
                                </span>
                              ) : null}
                              </div>
                            {actualSeg ? (
                              <div
                                className={`factBar factBar${actualTone[0].toUpperCase()}${actualTone.slice(1)}`}
                                style={{ left: actualSeg.x, width: actualSeg.w }}
                                title={`${factToneLabel(actualTone)}: ${formatTimelineDate(ev.actualStartAt, timelineTimeMode)} – ${formatTimelineDate(ev.actualEndAt, timelineTimeMode)}`}
                              />
                            ) : null}
                            {renderExitTimeLabel(r.events, ev, exitTargetSeg, exitTargetStartAt, exitTargetEndAt, exitTargetIsFact)}
                            </Fragment>
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
        <div className="ganttStickyFooter" aria-label="Нижняя панель диаграммы">
          <div className="ganttBottomScrollRow" aria-hidden="true">
            <div className="ganttBottomScrollSpacer" style={ganttLabelColStyle} />
            <div className="ganttBottomScrollViewport" ref={bottomScrollRef} onScroll={onBottomScroll}>
              <div className="ganttBottomScrollInner" style={{ width: canvasWidth }} />
            </div>
          </div>
          {showSlotHistogram ? (
            <div className="ganttSlotHistogramRow">
              <div className="ganttSlotHistogramLabel" style={ganttLabelColStyle}>
                <strong>События</strong>
                <span>кол-во в периоде</span>
              </div>
              <div className="ganttSlotHistogramViewport" ref={histogramViewportRef}>
                <div className="ganttSlotHistogramCanvas" style={{ width: canvasWidth }}>
                  {slotHistogram.length > 0 ? (
                    slotHistogram.map((b) => {
                      const occupiedPct = b.occupied > 0 ? (b.occupied / slotHistogramMaxOccupied) * 100 : 0;
                      return (
                        <div
                          className="slotBucket"
                          key={b.key}
                          style={{ left: b.left, width: Math.max(2, b.width - 1) }}
                          title={`${b.label}: событий ${b.occupied}`}
                        >
                          <div className="slotBucketOccupied" style={{ height: `${occupiedPct}%` }} />
                          {b.occupied > 0 && b.width >= 22 ? (
                            <span className="slotBucketValue" style={{ bottom: `calc(${occupiedPct}% + 3px)` }}>
                              {b.occupied}
                            </span>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                  <div className="slotHistogramEmpty">Нет событий в выбранном диапазоне</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
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
                  <label className="evField">
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
                    <span className="evFieldLabel">Тип планирования</span>
                    <select
                      className="evInput"
                      value={draft.planningKind}
                      onChange={(e) => {
                        const planningKind = e.target.value as EditorDraft["planningKind"];
                        setDraft({
                          ...draft,
                          planningKind,
                          budgetStartAtLocal: planningKind === "PLANNED" ? draft.budgetStartAtLocal || draft.startAtLocal : "",
                          budgetEndAtLocal: planningKind === "PLANNED" ? draft.budgetEndAtLocal || draft.endAtLocal : "",
                          placements: draft.placements.map((p) =>
                            planningKind === "PLANNED"
                              ? {
                                  ...p,
                                  budgetStartAtLocal: p.budgetStartAtLocal || p.startAtLocal,
                                  budgetEndAtLocal: p.budgetEndAtLocal || p.endAtLocal
                                }
                              : { ...p, budgetStartAtLocal: "", budgetEndAtLocal: "" }
                          )
                        });
                      }}
                    >
                      <option value="PLANNED">Плановое</option>
                      <option value="UNPLANNED">Внеплановое</option>
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
                <div className="evCardTitle">Периоды и TAT</div>
                <div className="evCardHint">Оперативный период управляет Ганттом и размещением. Бюджетный и фактический нужны для сравнения TAT.</div>
              </header>
              <div className="evCardBody">
                <div className="evPeriodGrid">
                  <div className="evPeriodName">Оперативный</div>
                  <label className="evField">
                    <span className="evFieldLabel">Дата начала</span>
                    <input
                      className="evInput"
                      type="datetime-local"
                      value={draft.startAtLocal}
                      onChange={(e) => setDraft({ ...draft, startAtLocal: e.target.value })}
                    />
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Дата окончания</span>
                    <input
                      className="evInput"
                      type="datetime-local"
                      value={draft.endAtLocal}
                      onChange={(e) => setDraft({ ...draft, endAtLocal: e.target.value })}
                    />
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">TAT</span>
                    <input className="evInput evInputReadonly" value={formatTatDetailed(draft.startAtLocal, draft.endAtLocal)} readOnly />
                  </label>

                  <div className="evPeriodName">Бюджетный</div>
                  <label className="evField">
                    <span className="evFieldLabel">Дата начала</span>
                    <input
                      className="evInput"
                      type="datetime-local"
                      value={draft.budgetStartAtLocal}
                      onChange={(e) => setDraft({ ...draft, budgetStartAtLocal: e.target.value })}
                      disabled={draft.planningKind === "UNPLANNED"}
                    />
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Дата окончания</span>
                    <input
                      className="evInput"
                      type="datetime-local"
                      value={draft.budgetEndAtLocal}
                      onChange={(e) => setDraft({ ...draft, budgetEndAtLocal: e.target.value })}
                      disabled={draft.planningKind === "UNPLANNED"}
                    />
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">TAT</span>
                    <input className="evInput evInputReadonly" value={formatTatDetailed(draft.budgetStartAtLocal, draft.budgetEndAtLocal)} readOnly />
                  </label>

                  <div className="evPeriodName">Фактический</div>
                  <label className="evField">
                    <span className="evFieldLabel">Дата начала</span>
                    <input
                      className="evInput"
                      type="datetime-local"
                      value={draft.actualStartAtLocal}
                      onChange={(e) => setDraft({ ...draft, actualStartAtLocal: e.target.value })}
                    />
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Дата окончания</span>
                    <input
                      className="evInput"
                      type="datetime-local"
                      value={draft.actualEndAtLocal}
                      onChange={(e) => setDraft({ ...draft, actualEndAtLocal: e.target.value })}
                    />
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">TAT</span>
                    <input className="evInput evInputReadonly" value={formatTatDetailed(draft.actualStartAtLocal, draft.actualEndAtLocal)} readOnly />
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
                <div className="evLocationGrid">
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
                        <option key={l.id} value={l.id} disabled={l.isCompatible === false}>
                          {l.name}
                          {l.capacitySummary ? ` — ${l.capacitySummary}` : ""}
                          {l.isCompatible === false ? " — недоступно для типа ВС" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Место</span>
                    <select
                      className="evInput"
                      value={draft.standId}
                      onChange={(e) => setDraft({ ...draft, standId: e.target.value })}
                      disabled={!draft.layoutId}
                    >
                      <option value="">— не выбрано —</option>
                      {(standsForEditorQ.data ?? []).map((s) => (
                        <option key={s.id} value={s.id} disabled={s.isCompatible === false}>
                          {s.code} • {s.name}
                          {s.isCompatible === false ? " — недоступно для типа ВС" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="evCheckRow">
                  <input
                    type="checkbox"
                    checked={draft.multiPlacement}
                    onChange={(e) => setMultiPlacementMode(e.target.checked)}
                  />
                  <span>Событие в нескольких ангарах</span>
                </label>
                {draft.multiPlacement ? (
                  <div className="evPlacementList">
                    {draft.placements.map((p, idx) => {
                      const layoutOptions = p.hangarId ? layoutsByHangar.get(p.hangarId) ?? [] : [];
                      const standOptions = p.layoutId ? standsByLayout.get(p.layoutId) ?? [] : [];
                      const prev = draft.placements[idx - 1];
                      const towHours =
                        prev && dayjs(p.startAtLocal).isValid() && dayjs(prev.endAtLocal).isValid()
                          ? Math.max(0, dayjs(p.startAtLocal).diff(dayjs(prev.endAtLocal), "minute")) / 60
                          : null;
                      return (
                        <div className="evPlacementItem" key={p.id ?? idx}>
                          <div className="evPlacementHead">
                            <strong>Этап {idx + 1}</strong>
                            {towHours != null && idx > 0 ? <span className="muted">Буксировка: {Number(towHours.toFixed(1))} ч</span> : null}
                            <button className="btn" type="button" onClick={() => removePlacementDraft(idx)} disabled={draft.placements.length <= 1}>
                              Удалить
                            </button>
                          </div>
                          <div className="evPlacementBody">
                            <div className="evPeriodGrid">
                              <div className="evPeriodName">Оперативный</div>
                              <label className="evField">
                                <span className="evFieldLabel">Дата начала</span>
                                <input className="evInput" type="datetime-local" value={p.startAtLocal} onChange={(e) => setDraftPlacement(idx, { startAtLocal: e.target.value })} />
                              </label>
                              <label className="evField">
                                <span className="evFieldLabel">Дата окончания</span>
                                <input className="evInput" type="datetime-local" value={p.endAtLocal} onChange={(e) => setDraftPlacement(idx, { endAtLocal: e.target.value })} />
                              </label>
                              <label className="evField">
                                <span className="evFieldLabel">TAT</span>
                                <input className="evInput evInputReadonly" value={formatTatDetailed(p.startAtLocal, p.endAtLocal)} readOnly />
                              </label>

                              <div className="evPeriodName">Бюджетный</div>
                              <label className="evField">
                                <span className="evFieldLabel">Дата начала</span>
                                <input className="evInput" type="datetime-local" value={p.budgetStartAtLocal} onChange={(e) => setDraftPlacement(idx, { budgetStartAtLocal: e.target.value })} disabled={draft.planningKind === "UNPLANNED"} />
                              </label>
                              <label className="evField">
                                <span className="evFieldLabel">Дата окончания</span>
                                <input className="evInput" type="datetime-local" value={p.budgetEndAtLocal} onChange={(e) => setDraftPlacement(idx, { budgetEndAtLocal: e.target.value })} disabled={draft.planningKind === "UNPLANNED"} />
                              </label>
                              <label className="evField">
                                <span className="evFieldLabel">TAT</span>
                                <input className="evInput evInputReadonly" value={formatTatDetailed(p.budgetStartAtLocal, p.budgetEndAtLocal)} readOnly />
                              </label>

                              <div className="evPeriodName">Фактический</div>
                              <label className="evField">
                                <span className="evFieldLabel">Дата начала</span>
                                <input className="evInput" type="datetime-local" value={p.actualStartAtLocal} onChange={(e) => setDraftPlacement(idx, { actualStartAtLocal: e.target.value })} />
                              </label>
                              <label className="evField">
                                <span className="evFieldLabel">Дата окончания</span>
                                <input className="evInput" type="datetime-local" value={p.actualEndAtLocal} onChange={(e) => setDraftPlacement(idx, { actualEndAtLocal: e.target.value })} />
                              </label>
                              <label className="evField">
                                <span className="evFieldLabel">TAT</span>
                                <input className="evInput evInputReadonly" value={formatTatDetailed(p.actualStartAtLocal, p.actualEndAtLocal)} readOnly />
                              </label>
                            </div>
                            <div className="evLocationGrid">
                            <label className="evField">
                              <span className="evFieldLabel">Ангар</span>
                              <select
                                className="evInput"
                                value={p.hangarId}
                                onChange={(e) => setDraftPlacement(idx, { hangarId: e.target.value, layoutId: "", standId: "" })}
                              >
                                <option value="">— не задан —</option>
                                {(hangarsQ.data ?? []).map((h) => (
                                  <option key={h.id} value={h.id}>{h.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="evField">
                              <span className="evFieldLabel">Вариант</span>
                              <select
                                className="evInput"
                                value={p.layoutId}
                                onChange={(e) => setDraftPlacement(idx, { layoutId: e.target.value, standId: "" })}
                                disabled={!p.hangarId}
                              >
                                <option value="">— не задан —</option>
                                {layoutOptions.map((l) => (
                                  <option key={l.id} value={l.id} disabled={l.isCompatible === false}>
                                    {l.name}
                                    {l.capacitySummary ? ` — ${l.capacitySummary}` : ""}
                                    {l.isCompatible === false ? " — недоступно для типа ВС" : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="evField">
                              <span className="evFieldLabel">Место</span>
                              <select
                                className="evInput"
                                value={p.standId}
                                onChange={(e) => setDraftPlacement(idx, { standId: e.target.value })}
                                disabled={!p.layoutId}
                              >
                                <option value="">— не выбрано —</option>
                                {standOptions.map((s) => (
                                  <option key={s.id} value={s.id} disabled={s.isCompatible === false}>
                                    {s.code} • {s.name}
                                    {s.isCompatible === false ? " — недоступно для типа ВС" : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <button className="btn" type="button" onClick={addPlacementDraft}>
                      Добавить этап
                    </button>
                    <div className="muted small">Сохраните событие, чтобы применить этапы и пересчитать резервы мест.</div>
                  </div>
                ) : null}
                <div className="evInlineActions">
                  <button
                    className="btn"
                    onClick={() => unreserveM.mutate()}
                    disabled={!draft.id || !draft.standId || draft.multiPlacement || unreserveM.isPending}
                  >
                    Снять резерв
                  </button>
                  <button
                    className="btn btnPrimary"
                    onClick={() => requestSaveWithReason("reserve")}
                    disabled={!draft.id || draft.multiPlacement || reserveM.isPending}
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
                {draft.id ? (
                  <button
                    className="btn"
                    onClick={() => {
                      localStorage.setItem("hangarPlanning:itpSelectedEventId", draft.id!);
                      setEditorOpen(false);
                      setCopyFromTitle(null);
                      location.hash = "itp";
                    }}
                    type="button"
                  >
                    Открыть в РМ ИТП
                  </button>
                ) : null}
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

