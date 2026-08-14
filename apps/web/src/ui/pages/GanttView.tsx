import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import * as XLSX from "xlsx";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import { isValidDateInput, isValidDateTimeLocal } from "../../lib/dateInput";
import {
  ensurePlacementClientKey,
  manualPlacements,
  placementWarnings,
  type PlacementDraft
} from "../../lib/placementDraft";
import { buildEventShareUrl, copyTextToClipboard } from "../../lib/eventDeepLink";
import {
  extractDiffEntries,
  formatActionLabel,
  formatHistoryActor,
  resolveHistoryValue,
  type HistoryRefMaps
} from "../../lib/eventHistoryFormat";
import {
  AIRCRAFT_EDITABLE_STATUSES,
  DEFAULT_EVENT_STATUS,
  ganttStatusStripeColor,
  isPendingApprovalStatus,
  overlayStatusCatalog,
  statusCatalogLabel,
  type EventStatusCatalogItem,
  type EventStatusCode
} from "../../lib/eventStatusCatalog";
import { MSK_OFFSET_MINUTES, startOfMskDayIso } from "../../lib/localDate";
import { authMe } from "../auth/authApi";
import { EventPlacementsEditor } from "../components/EventPlacementsEditor";
import { EventResourcesPanel } from "../components/EventResourcesPanel";
import { GanttEventsTable } from "../components/GanttEventsTable";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { SingleSelectDropdown } from "../components/SingleSelectDropdown";
import { useActiveSandbox } from "../components/SandboxSwitcher";
import { ToolbarPopover } from "../components/ToolbarPopover";
import { SwitchToggle } from "../components/SwitchToggle";
import { useIsMobile } from "../hooks/useIsMobile";

dayjs.extend(utc);

const GANTT_UI_LS_KEY = "hangarPlanning:ganttUi:v1";
const BULK_STATUS_MAX = 1000;
const BULK_STATUS_TERMINAL = new Set(["DONE", "CANCELLED", "DELETED"]);

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
  workshopId: "Цех",
  layoutId: "Вариант размещения",
  standId: "Место",
  multiPlacement: "Несколько ангаров",
  autoFillGapPlacements: "Автозаполнение разрывов",
  placements: "Размещения",
  allowOverlap: "Разрешить нахлёст"
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
  placementCount?: number;
  placementOrigin?: "MANUAL" | "AUTO_GAP";
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
  towSegments?: Array<{ id: string; startAt: string; endAt: string }>;
};

type EventPlacementRow = {
  id: string;
  eventId: string;
  origin?: "MANUAL" | "AUTO_GAP";
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

function eventWorkshopId(ev: EventRow): string {
  return String((ev.workshop as any)?.id ?? (ev as any).workshopId ?? "");
}

function eventStatusId(ev: EventRow): string {
  return String(ev.status ?? "");
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
    ? ev.placements.filter((p) => (p.origin ?? "MANUAL") !== "AUTO_GAP")
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
  return rows.map((p) =>
    ensurePlacementClientKey({
      id: p.id === "legacy" ? undefined : p.id,
      origin: "MANUAL",
      startAtLocal: toInputLocal(p.startAt),
      endAtLocal: toInputLocal(p.endAt),
      budgetStartAtLocal: toInputLocal(p.budgetStartAt),
      budgetEndAtLocal: toInputLocal(p.budgetEndAt),
      actualStartAtLocal: toInputLocal(p.actualStartAt),
      actualEndAtLocal: toInputLocal(p.actualEndAt),
      hangarId: p.hangarId ?? (p.hangar as any)?.id ?? (p.layout as any)?.hangarId ?? "",
      layoutId: p.layoutId ?? (p.layout as any)?.id ?? "",
      standId: p.standId ?? (p.stand as any)?.id ?? ""
    })
  );
}

function normalizePlacementDraftGaps(placements: PlacementDraft[], enabled: boolean): PlacementDraft[] {
  const manual = manualPlacements(placements).filter(
    (placement) => isValidDateTimeLocal(placement.startAtLocal) && isValidDateTimeLocal(placement.endAtLocal)
  );
  if (!enabled || manual.length < 2) return manual;

  const result: PlacementDraft[] = [];
  for (const placement of manual) {
    const previous = result[result.length - 1];
    if (previous) {
      const gapMinutes = dayjs(placement.startAtLocal).diff(dayjs(previous.endAtLocal), "minute");
      if (gapMinutes >= 1) {
        result.push(
          ensurePlacementClientKey({
            id: `auto-gap:${previous.clientKey}:${placement.clientKey}`,
            origin: "AUTO_GAP",
            startAtLocal: previous.endAtLocal,
            endAtLocal: placement.startAtLocal,
            budgetStartAtLocal: "",
            budgetEndAtLocal: "",
            actualStartAtLocal: "",
            actualEndAtLocal: "",
            hangarId: "",
            layoutId: "",
            standId: ""
          })
        );
      }
    }
    result.push(placement);
  }
  return result;
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
      origin: p.origin ?? "MANUAL",
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

/** Компактно: <24ч → «12ч», иначе → «2дн». */
function formatHoursDaysCompact(hours: number): string {
  if (hours < 24) return `${Number(hours.toFixed(1))}ч`;
  return `${Number((hours / 24).toFixed(1))}дн`;
}

/** Дельта: <24ч → «+12ч»/«−12ч», иначе → «+2дн»/«−2дн». */
function formatHoursDaysDelta(hours: number): string {
  const abs = Math.abs(hours);
  const sign = hours < 0 ? "−" : "+";
  if (abs < 24) return `${sign}${Number(abs.toFixed(1))}ч`;
  return `${sign}${Number((abs / 24).toFixed(1))}дн`;
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
type Hangar = { id: string; name: string; code?: string; isPhysical?: boolean };
type Layout = { id: string; name: string; hangarId: string; code?: string; capacitySummary?: string; standsSummary?: string; isCompatible?: boolean };
type Stand = { id: string; layoutId: string; code: string; name: string; isActive?: boolean; isCompatible?: boolean };
type AircraftTypePaletteRow = { id: string; operatorId: string; aircraftTypeId: string; color: string; isActive: boolean };
type DndStand = Stand & { hangarId: string; hangarName: string; hangarCode?: string; layoutName: string; layoutCode?: string };

type GroupMode = "AIRCRAFT" | "HANGAR_STAND";
type GanttDisplayMode = "CURRENT" | "PLAN_FACT";
type TimelineTimeMode = "UTC" | "LOCAL";
type PlanningKindFilter = "ALL" | "PLANNED" | "UNPLANNED";
type GanttPanelView = "DIAGRAM" | "TABLE";

type GanttFilters = {
  hangarIds: string[];
  operatorIds: string[];
  aircraftTypeIds: string[];
  aircraftIds: string[];
  eventTypeIds: string[];
  workshopIds: string[];
  statusIds: string[];
  planningKind: PlanningKindFilter;
};

type GanttFilterKey = keyof GanttFilters;

type TowSegment = { id: string; eventId: string; startAt: string; endAt: string };

type DndMoveRequest = { eventId: string; hangarId: string; bumpOnConflict: boolean; bumpedEventId?: string };
type DndPlaceRequest = DndMoveRequest & { startAt: string; endAt: string };
type DndBatchPlaceRequest = {
  eventIds: string[];
  hangarId: string;
  startAt: string;
  endAt: string;
};

type DndDragItem = { eventId: string; origStartMs: number; origEndMs: number };

type DndPtrDrag = {
  eventId: string;
  eventIds: string[];
  mode: "move";
  started: boolean;
  startClientX: number;
  startClientY: number;
  grabOffsetPx: number;
  origStartMs: number;
  origEndMs: number;
  originHangarId: string;
  originRowKey: string;
  items: DndDragItem[];
};

type DndPreviewBar = { startAt: string; endAt: string; x: number; w: number };

type DndPtrPreview = DndPreviewBar & {
  envelopeStartAt: string;
  envelopeEndAt: string;
  envelopeX: number;
  envelopeW: number;
  bars: DndPreviewBar[];
};

type EditorDraft = {
  id?: string;
  title: string;
  level: "STRATEGIC" | "OPERATIONAL";
  status: EventStatusCode | string;
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
  workshopId: string; // optional, "" means null
  layoutId: string; // optional, "" means null
  standId: string; // optional, "" means no reservation
  allowOverlap: boolean;
  multiPlacement: boolean;
  autoFillGapPlacements: boolean;
  placements: PlacementDraft[];
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
  if (mode === "UTC") return dayjs.utc(value);
  // Date-only (календарный день с type=date) → полночь MSK
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const iso = startOfMskDayIso(value);
    return dayjs(iso ?? value).utcOffset(MSK_OFFSET_MINUTES);
  }
  // Абсолютный инстант → показать wall clock MSK
  return dayjs(value).utcOffset(MSK_OFFSET_MINUTES);
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
  const mode = params.timeMode ?? "LOCAL";
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

function dndPreviewBarGeom(params: {
  startMs: number;
  endMs: number;
  from: dayjs.Dayjs;
  dayWidth: number;
  canvasWidth: number;
  timeMode: TimelineTimeMode;
}): DndPreviewBar {
  const startAt = new Date(params.startMs).toISOString();
  const endAt = new Date(params.endMs).toISOString();
  const g = calcBarXW({
    startAt,
    endAt,
    from: params.from,
    dayWidth: params.dayWidth,
    canvasWidth: params.canvasWidth,
    timeMode: params.timeMode
  });
  if (g) return { startAt, endAt, x: g.x, w: g.w };
  const leftRaw = ((params.startMs - params.from.valueOf()) / (24 * 60 * 60 * 1000)) * params.dayWidth;
  const rightRaw = ((params.endMs - params.from.valueOf()) / (24 * 60 * 60 * 1000)) * params.dayWidth;
  const x = clamp(leftRaw, 0, params.canvasWidth);
  const r = clamp(rightRaw, 0, params.canvasWidth);
  return { startAt, endAt, x, w: Math.max(6, r - x) };
}

function dndItemsForSelection(selectedIds: string[], grabbed: EventRow, allEvents: EventRow[]): DndDragItem[] {
  const byId = new Map<string, EventRow>();
  byId.set(grabbed.id, grabbed);
  for (const e of allEvents) if (!byId.has(e.id)) byId.set(e.id, e);
  const items: DndDragItem[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = byId.get(id);
    if (!e) continue;
    const origStartMs = dayjs(e.startAt).valueOf();
    const origEndMs = dayjs(e.endAt).valueOf();
    if (!Number.isFinite(origStartMs) || !Number.isFinite(origEndMs) || origEndMs <= origStartMs) continue;
    items.push({ eventId: id, origStartMs, origEndMs });
  }
  if (items.length > 0) return items;
  return [
    {
      eventId: grabbed.id,
      origStartMs: dayjs(grabbed.startAt).valueOf(),
      origEndMs: dayjs(grabbed.endAt).valueOf()
    }
  ];
}

function formatDndRangeLabel(startAt: string, endAt: string, mode: TimelineTimeMode): string {
  return `${formatTimelineDate(startAt, mode)} → ${formatTimelineDate(endAt, mode)}`;
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
    if (filters.hangarIds.length > 0) {
      const hangarIds = eventHangarIds(ev);
      // События без ангара/места не проходят фильтр по ангару — иначе в каскаде
      // типов ВС/бортов появляются значения из неразмещённых событий.
      if (!hangarIds.some((id) => filters.hangarIds.includes(id))) return false;
    }
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
  if (skip !== "workshopIds") {
    if (filters.workshopIds.length > 0 && !filters.workshopIds.includes(eventWorkshopId(ev))) return false;
  }
  if (skip !== "statusIds") {
    if (filters.statusIds.length > 0 && !filters.statusIds.includes(eventStatusId(ev))) return false;
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

/** Интервал для раскладки строк: должен совпадать с тем, что реально рисуется на Гантте. */
function eventPackRangeMs(ev: EventRow, mode: GanttDisplayMode): { startMs: number; endMs: number } {
  if (mode === "PLAN_FACT") {
    const starts = [ev.startAt, ev.actualStartAt]
      .filter(Boolean)
      .map((d) => Date.parse(String(d)))
      .filter((n) => Number.isFinite(n));
    const ends = [ev.endAt, ev.actualEndAt]
      .filter(Boolean)
      .map((d) => Date.parse(String(d)))
      .filter((n) => Number.isFinite(n));
    if (starts.length && ends.length) {
      return { startMs: Math.min(...starts), endMs: Math.max(...ends) };
    }
  }
  const period = displayPeriodForMode(ev, mode);
  return { startMs: Date.parse(period.startAt), endMs: Date.parse(period.endAt) };
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

/** Факт TAT и дельта к оперативному плану: «2дн (+12ч)» / «18ч (−3ч)». */
function factTatLabel(ev: EventRow): string | null {
  const actualHours = tatHours(ev.actualStartAt, ev.actualEndAt);
  const operationalHours = tatHours(ev.startAt, ev.endAt);
  if (actualHours == null || operationalHours == null) return null;
  return `${formatHoursDaysCompact(actualHours)} (${formatHoursDaysDelta(actualHours - operationalHours)})`;
}

const EXIT_TIME_LABEL_WIDTH = 42;
const EXIT_TIME_LABEL_GAP = 4;
const ENTRY_TIME_LABEL_WIDTH = 42;
const ENTRY_TIME_LABEL_GAP = 4;
const MIN_GANTT_LABEL_WIDTH = 160;
const MAX_GANTT_LABEL_WIDTH = 720;
/** Ниже порога левая ось показывает коды вместо наименований. */
const AXIS_CODES_BELOW_WIDTH = 210;
const MIN_FIT_DAY_WIDTH = 0.25;

function canShowBarEdgeTimeLabel(zoom: ZoomLevel) {
  return zoom === "hour" || zoom === "day";
}

function exitTimeLabel(ev: EventRow, mode: TimelineTimeMode) {
  return timelineDate(ev.actualEndAt ?? ev.endAt, mode).format("HH:mm");
}

function exitTimeTitle(ev: EventRow, mode: TimelineTimeMode) {
  return ev.actualEndAt
    ? `Фактическое время окончания: ${formatTimelineDate(ev.actualEndAt, mode)}`
    : `Плановое время окончания: ${formatTimelineDate(ev.endAt, mode)}`;
}

function entryTimeLabel(ev: EventRow, mode: TimelineTimeMode) {
  return timelineDate(ev.actualStartAt ?? ev.startAt, mode).format("HH:mm");
}

function entryTimeTitle(ev: EventRow, mode: TimelineTimeMode) {
  return ev.actualStartAt
    ? `Фактическое время начала: ${formatTimelineDate(ev.actualStartAt, mode)}`
    : `Плановое время начала: ${formatTimelineDate(ev.startAt, mode)}`;
}

function BarStatusStripe(props: { status: string; catalog?: EventStatusCatalogItem[] }) {
  const color = ganttStatusStripeColor(props.status, props.catalog);
  if (!color) return null;
  return <span className="barStatusStripe" style={{ background: color }} aria-hidden="true" />;
}

// Образец бара статуса для легенды — использует тот же barVisualStyle,
// что и фактический рендер событий, поэтому легенда всегда синхронна с UI.
function LegendStatus(props: { status: string; baseColor: string; label: string; catalog?: EventStatusCatalogItem[] }) {
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
      >
        <BarStatusStripe status={props.status} catalog={props.catalog} />
      </span>
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

function hangarAxisLabel(
  hangar: { name?: string | null; code?: string | null } | string | null | undefined,
  preferCode = false
) {
  if (hangar == null) return "Ангар";
  if (typeof hangar === "string") {
    const name = hangar.trim();
    return preferCode ? compactHangarLabel(name) || name || "Ангар" : name || "Ангар";
  }
  const name = String(hangar.name ?? "").trim();
  const code = String(hangar.code ?? "").trim();
  if (preferCode) return code || compactHangarLabel(name) || name || "Ангар";
  return name || code || "Ангар";
}

function layoutAxisLabel(
  layout: { name?: string | null; code?: string | null } | string | null | undefined,
  preferCode = false
) {
  if (layout == null) return "";
  if (typeof layout === "string") return layout.trim();
  const name = String(layout.name ?? "").trim();
  const code = String(layout.code ?? "").trim();
  if (preferCode) return code || name;
  return name || code;
}

function compactStandLabel(code: string | null | undefined) {
  if (!code) return "";
  return String(code).trim().replace(/\s*-\s*/g, "-").replace(/\s+/g, "");
}

function formatHangarStandAxisLabel(hangarLabel: string, standCode: string) {
  const stand = compactStandLabel(standCode);
  return stand ? `${hangarLabel} / ${stand}` : hangarLabel;
}

/** Доп. полоса нахлёста на оси: «· 2»; в title — «· Нахлёст 2». */
function overlapLaneAxisLabel(base: string, laneIndex: number): string {
  if (laneIndex <= 0) return base;
  return `${base} · ${laneIndex + 1}`;
}

function overlapLaneAxisTitle(base: string, laneIndex: number): string {
  if (laneIndex <= 0) return base;
  return `${base} · Нахлёст ${laneIndex + 1}`;
}

function compactBarLabel(ev: EventRow) {
  const type = ev.eventType?.name || ev.title;
  const hangar = compactHangarLabel(ev.hangar?.name);
  const stand = compactStandLabel(ev.reservation?.stand?.code);
  const place = [hangar, stand].filter(Boolean).join("-");
  return place ? `${type}/${place}` : type;
}

function hangarSummaryLabel(
  ev: EventRow,
  preferCode = false,
  hangarById?: Map<string, { name: string; code: string }>
) {
  const placements = ev.placements ?? [];
  const resolve = (hangarId: string | null | undefined, fallbackName: string | null | undefined) => {
    const meta = hangarId ? hangarById?.get(hangarId) : undefined;
    return hangarAxisLabel(
      { name: meta?.name ?? fallbackName, code: meta?.code },
      preferCode
    );
  };
  const names = placements.length
    ? placements.map((p) =>
        resolve(
          p.hangar?.id ?? (p.layout as any)?.hangar?.id,
          p.hangar?.name ?? (p.layout as any)?.hangar?.name ?? ""
        )
      )
    : [resolve(ev.hangar?.id, ev.hangar?.name ?? null)];
  return Array.from(new Set(names.filter(Boolean))).join(" → ");
}

function standSummaryLabel(ev: EventRow) {
  const placements = ev.placements ?? [];
  const names = placements.length
    ? placements.map((p) => compactStandLabel(p.stand?.code ?? ""))
    : [compactStandLabel(ev.reservation?.stand?.code)];
  return Array.from(new Set(names.filter(Boolean))).join(" → ");
}

function aircraftAxisSubLabel(
  ev: EventRow,
  preferCode = false,
  hangarById?: Map<string, { name: string; code: string }>
) {
  return [ev.eventType?.name, hangarSummaryLabel(ev, preferCode, hangarById), standSummaryLabel(ev)]
    .filter(Boolean)
    .join(" • ");
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

function eventTooltip(ev: EventRow, mode: TimelineTimeMode = "LOCAL", catalog?: EventStatusCatalogItem[]) {
  const base = `${eventAircraftLabel(ev)} • ${ev.title}`;
  const period = `Опер.: ${formatTimelineDate(ev.startAt, mode)} – ${formatTimelineDate(ev.endAt, mode)}`;
  const place = placementLabel(ev);
  const plan = ev.budgetStartAt && ev.budgetEndAt ? `\nПлан: ${formatTimelineDate(ev.budgetStartAt, mode)} – ${formatTimelineDate(ev.budgetEndAt, mode)}` : "";
  const fact = ev.actualStartAt && ev.actualEndAt ? `\nФакт: ${formatTimelineDate(ev.actualStartAt, mode)} – ${formatTimelineDate(ev.actualEndAt, mode)}` : "";
  const planningKind = `\nТип: ${PLANNING_KIND_LABEL[eventPlanningKind(ev)]}`;
  const status = `\nСтатус: ${statusCatalogLabel(ev.status, catalog)}`;
  const prefix = ev.placementOrigin === "AUTO_GAP" ? "Автоматический этап: без ангара\n" : ev.segmentKey ? `Этап: ${place}\n` : "";
  return `${prefix}${base}\n${period}${planningKind}${status}${plan}${fact}`;
}

function eventSegmentsForHangarRows(ev: EventRow): EventRow[] {
  if (!ev.placements?.length) return [ev];
  const sorted = sortEventPlacements(ev.placements);
  return sorted.map((p, idx) => ({
    ...ev,
    segmentKey: placementSegmentKey(ev.id, p, idx),
    placementCount: sorted.length,
    placementOrigin: p.origin ?? "MANUAL",
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

function barVisualStyle(status: string, baseColor: string) {
  // Базовая логика:
  // - основной цвет = тип ВС (в связке с оператором)
  // - статус согласования — узкая полоска внизу бара (BarStatusStripe)
  // - «на согласовании» дополнительно пунктирной рамкой (слот ещё можно менять)
  // - CANCELLED всегда серый
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
      border: "none",
      color: textColor
    } as const;
  }

  if (isPendingApprovalStatus(status)) {
    return {
      background: baseColor,
      opacity: 0.78,
      border: "2px dashed rgba(15, 23, 42, 0.35)",
      color: textColor
    } as const;
  }

  // APPROVED_* / IN_PROGRESS (и прочие) — обычная заливка и рамка
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

/** Цвет соединителя между placements: затемняем светлые оттенки, чтобы линия не терялась. */
function placementLinkColor(baseColor: string): string {
  const m = String(baseColor ?? "").trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return "#475569";
  const hex = m[1]!;
  let r = parseInt(hex.slice(0, 2), 16);
  let g = parseInt(hex.slice(2, 4), 16);
  let b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  // Слишком светлый — тянем к slate; иначе слегка затемняем.
  if (yiq >= 150) {
    const t = 0.55;
    r = Math.round(r * (1 - t) + 51 * t); // #334155
    g = Math.round(g * (1 - t) + 65 * t);
    b = Math.round(b * (1 - t) + 85 * t);
  } else {
    r = Math.round(r * 0.72);
    g = Math.round(g * 0.72);
    b = Math.round(b * 0.72);
  }
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Плавная S-кривая между краями соседних сегментов (горизонтальные касательные). */
function placementLinkPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  // Меньший tension → более спрямлённая кривая.
  const tension = Math.max(12, Math.abs(dx) * 0.28);
  const c1x = x1 + tension;
  const c2x = x2 - tension;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1x.toFixed(1)} ${y1.toFixed(1)}, ${c2x.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function sortEventPlacements(placements: EventPlacementRow[]): EventPlacementRow[] {
  return [...placements].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || Date.parse(a.startAt) - Date.parse(b.startAt)
  );
}

function placementSegmentKey(eventId: string, placement: EventPlacementRow, sortedIndex: number): string {
  return `${eventId}:placement:${placement.id ?? sortedIndex}`;
}

function formatPlacementBridgeLabel(
  p: EventPlacementRow,
  hangarById: Map<string, { name: string; code: string }>
): string {
  const hid = String(p.hangarId ?? p.hangar?.id ?? "").trim();
  const stand = compactStandLabel(p.stand?.code);
  const hasHangar = Boolean(hid || String(p.hangar?.name ?? "").trim());
  if (p.origin === "AUTO_GAP" || (!hasHangar && !stand)) return "Без ангара/места";
  const meta = hid ? hangarById.get(hid) : undefined;
  const hangar = hangarAxisLabel({ name: meta?.name ?? p.hangar?.name, code: meta?.code }, true);
  if (!stand) return `${hangar} / Без места`;
  return `${hangar} / ${stand}`;
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

type PlacedEvent = { ev: EventRow };

function packOverlapsIntoLanes(
  events: EventRow[],
  getRange: (ev: EventRow) => { startMs: number; endMs: number } = (ev) => ({
    startMs: Date.parse(ev.startAt),
    endMs: Date.parse(ev.endAt)
  })
): PlacedEvent[][] {
  const sorted = [...events].sort((a, b) => {
    const ar = getRange(a);
    const br = getRange(b);
    if (ar.startMs !== br.startMs) return ar.startMs - br.startMs;
    return ar.endMs - br.endMs;
  });

  const lanes: Array<{ items: PlacedEvent[]; lastEndMs: number }> = [];

  for (const ev of sorted) {
    const { startMs, endMs } = getRange(ev);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      lanes.push({ items: [{ ev }], lastEndMs: Number.isFinite(endMs) ? endMs : startMs });
      continue;
    }

    if (lanes.length === 0) {
      lanes.push({ items: [{ ev }], lastEndMs: endMs });
      continue;
    }

    const laneIdx = lanes.findIndex((l) => l.lastEndMs <= startMs);
    if (laneIdx >= 0) {
      lanes[laneIdx]!.items.push({ ev });
      lanes[laneIdx]!.lastEndMs = Math.max(lanes[laneIdx]!.lastEndMs, endMs);
      continue;
    }

    lanes.push({ items: [{ ev }], lastEndMs: endMs });
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

/** Модальный drawer (легенда, подтверждения) — portal на body, всегда поверх карточки события. */
function Drawer(props: {
  open: boolean;
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!props.open) return null;
  return createPortal(
    <div className="drawerBackdrop drawerBackdropElevated" style={{ zIndex: 12000 }}>
      <div className="drawer drawerV2" role="dialog" aria-modal="true" aria-label={props.title}>
        <header className="drawerHeader">
          <div className="drawerHeaderText">
            <div className="drawerTitle">{props.title}</div>
            {props.subtitle ? <div className="drawerSubtitle">{props.subtitle}</div> : null}
          </div>
          <div className="drawerHeaderActions">
            {props.headerActions}
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
          </div>
        </header>
        <div className="drawerBody">{props.children}</div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Плавающая карточка события (VS Code tool window / Chakra FloatingPanel):
 * — modeless: план остаётся доступен;
 * — drag за заголовок;
 * — свернуть → компактная полоса в правой половине экрана;
 * — один экземпляр: при свёрнутом новая карточка не открывается.
 */
function FloatingEditorPanel(props: {
  open: boolean;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  title: string;
  summary: string;
  onClose: () => void;
  headerActions?: React.ReactNode;
  /** Когда поверх открыт модальный диалог (причина изменения и т.п.) */
  beneathModal?: boolean;
  /** На мобиле отключаем перетаскивание панели */
  disableDrag?: boolean;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | { pointerId: number; offsetX: number; offsetY: number }>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!props.open) {
      setPos(null);
    }
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !props.collapsed) props.onCollapsedChange(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.collapsed, props.onCollapsedChange]);

  const clampPos = useCallback((x: number, y: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - Math.min(rect.width, window.innerWidth - 8));
    const maxY = Math.max(8, window.innerHeight - 48);
    return {
      x: Math.min(maxX, Math.max(8, x)),
      y: Math.min(maxY, Math.max(8, y))
    };
  }, []);

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (props.disableDrag || props.collapsed) return;
    if (e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("button, a, input, select, textarea, label")) return;
    const el = panelRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top
    };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
  };

  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const el = panelRef.current;
    if (!el) return;
    setPos(clampPos(e.clientX - d.offsetX, e.clientY - d.offsetY, el));
  };

  const onHeaderPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
  };

  if (!props.open) return null;

  if (props.collapsed) {
    return createPortal(
      <div
        className={`floatingEditor floatingEditorCollapsed${props.beneathModal ? " floatingEditorBeneathModal" : ""}`}
        role="dialog"
        aria-label={props.summary}
        style={props.beneathModal ? { zIndex: 40 } : undefined}
      >
        <button
          type="button"
          className="floatingEditorCollapsedMain"
          onClick={() => props.onCollapsedChange(false)}
          title="Развернуть карточку"
        >
          <span className="floatingEditorCollapsedTitle">{props.summary}</span>
        </button>
        <div className="floatingEditorCollapsedActions">
          <button
            type="button"
            className="drawerCloseBtn"
            onClick={() => props.onCollapsedChange(false)}
            aria-label="Развернуть"
            title="Развернуть"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 12l6-6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            className="drawerCloseBtn"
            onClick={props.onClose}
            aria-label="Закрыть"
            title="Закрыть"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      className={`floatingEditor floatingEditorExpanded drawer drawerV2${props.beneathModal ? " floatingEditorBeneathModal" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-label={props.title}
      style={{
        ...(pos ? { left: pos.x, top: pos.y, transform: "none" } : null),
        ...(props.beneathModal ? { zIndex: 40 } : null)
      }}
    >
      <header
        className="drawerHeader floatingEditorHeader"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <div className="drawerHeaderText">
          <div className="drawerTitle">{props.title}</div>
          <div className="drawerSubtitle floatingEditorSummary">{props.summary}</div>
        </div>
        <div className="drawerHeaderActions">
          {props.headerActions}
          <button
            type="button"
            className="drawerCloseBtn drawerCloseBtnIcon"
            onClick={() => props.onCollapsedChange(true)}
            aria-label="Свернуть"
            title="Свернуть"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5 10h10" />
            </svg>
          </button>
          <button
            type="button"
            className="drawerCloseBtn"
            onClick={props.onClose}
            aria-label="Закрыть"
            title="Закрыть"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
            <span className="drawerCloseBtnLabel">Закрыть</span>
          </button>
        </div>
      </header>
      <div className="drawerBody">{props.children}</div>
    </div>,
    document.body
  );
}

/** Подсказка блока карточки: «?» рядом с заголовком; панель через portal, чтобы не обрезалась overflow. */
function EvCardHelp(props: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxWidth: number;
  } | null>(null);

  const syncPanelPos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const maxWidth = Math.min(340, window.innerWidth - 24);
    let left = rect.left;
    if (left + maxWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - maxWidth - 12);
    }
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const openUp = spaceBelow < 160 && rect.top > spaceBelow;
    if (openUp) {
      setPanelPos({ bottom: window.innerHeight - rect.top + 6, left, maxWidth });
    } else {
      setPanelPos({ top: rect.bottom + 6, left, maxWidth });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    syncPanelPos();
  }, [open, syncPanelPos]);

  useEffect(() => {
    if (!open) return;
    const onWin = () => syncPanelPos();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open, syncPanelPos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            className="evCardHelpPanel evCardHelpPanelPortal"
            role="dialog"
            aria-label={`Справка: ${props.label}`}
            style={{
              position: "fixed",
              top: panelPos.top,
              bottom: panelPos.bottom,
              left: panelPos.left,
              maxWidth: panelPos.maxWidth,
              zIndex: 1400
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="evCardHelpPanelTitle">{props.label}</div>
            <div className="evCardHelpPanelBody">{props.children}</div>
          </div>,
          document.body
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`evCardHelp${open ? " evCardHelpOpen" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span
        ref={btnRef}
        role="button"
        tabIndex={0}
        className="evCardHelpBtn"
        aria-label={`Справка: ${props.label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Справка по блоку"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }
        }}
      >
        ?
      </span>
      {panel}
    </div>
  );
}

function EvToggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <SwitchToggle
      checked={props.checked}
      onChange={props.onChange}
      label={props.label}
      hint={props.hint}
      disabled={props.disabled}
    />
  );
}

function EvCardTitle(props: { children: React.ReactNode; helpLabel: string; help: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="evCardTitleRow">
      <div className="evCardTitle">
        {props.children}
        {props.badge}
      </div>
      <EvCardHelp label={props.helpLabel}>{props.help}</EvCardHelp>
    </div>
  );
}

export function GanttView() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => authMe(), retry: 0 });
  const { active: activeSandbox, activeId: activeSandboxId } = useActiveSandbox();
  const me = meQ.data && (meQ.data as any).ok ? (meQ.data as any).user : null;
  const canWriteSandbox = activeSandbox?.myRole === "OWNER" || activeSandbox?.myRole === "EDITOR";
  const canEditEvents = Boolean(me?.permissions?.includes("events:write") || canWriteSandbox);
  const canEditEventsEffective = canEditEvents && !isMobile;
  const canDnd = Boolean(
    !isMobile &&
      (canWriteSandbox ||
        (me?.permissions?.includes("events:write") && (me?.roles?.includes("ADMIN") || me?.roles?.includes("PLANNER"))))
  );
  const mobileUiAppliedRef = useRef(false);

  const headerViewportRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const histogramViewportRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const ganttFiltersStickyRef = useRef<HTMLDivElement | null>(null);
  const ganttPageMainRef = useRef<HTMLDivElement | null>(null);

  const ptrPreviewRef = useRef<null | DndPtrPreview>(null);
  const ptrTargetRef = useRef<
    null | { hangarId: string; rowKey: string; intent: "move" | "bump"; bumpedEventId?: string }
  >(null);
  const ptrDragRef = useRef<null | DndPtrDrag>(null);
  const hangarStandRowsRef = useRef<any[]>([]);
  const autoScrollRafRef = useRef<number | null>(null);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
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
  const [timelineTimeMode, setTimelineTimeMode] = useState<TimelineTimeMode>(() => {
    // Ранее дефолт был UTC; с v2 дефолт — LOCAL (MSK). Явный выбор UTC сохраняем только после миграции.
    if (savedUi?.timeModeMigratedToLocalDefault) {
      return savedUi.timelineTimeMode === "UTC" ? "UTC" : "LOCAL";
    }
    return "LOCAL";
  });

  const from = useMemo(() => timelineDate(rangeFromApplied, timelineTimeMode).startOf("day"), [rangeFromApplied, timelineTimeMode]);
  // полузакрытый интервал [from, to)
  const to = useMemo(() => timelineDate(rangeToApplied, timelineTimeMode).add(1, "day").startOf("day"), [rangeToApplied, timelineTimeMode]);
  const days = useMemo(() => {
    const d = to.diff(from, "day");
    if (!Number.isFinite(d) || d <= 0) return 1;
    return d;
  }, [from, to]);

  const [groupMode, setGroupMode] = useState<GroupMode>(() => (savedUi?.groupMode === "HANGAR_STAND" ? "HANGAR_STAND" : "AIRCRAFT"));
  const [panelView, setPanelView] = useState<GanttPanelView>(() =>
    savedUi?.panelView === "TABLE" ? "TABLE" : "DIAGRAM"
  );
  const [tableSettingsOpen, setTableSettingsOpen] = useState(false);
  const [selectedTableEventIds, setSelectedTableEventIds] = useState<string[]>([]);
  const [bulkStatusPanelOpen, setBulkStatusPanelOpen] = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState<EventStatusCode>(DEFAULT_EVENT_STATUS);
  const [bulkStatusNotice, setBulkStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    if (panelView !== "TABLE") {
      setTableSettingsOpen(false);
      setSelectedTableEventIds([]);
      setBulkStatusPanelOpen(false);
    }
  }, [panelView]);
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
  const [fitWidth, setFitWidth] = useState<boolean>(() => Boolean(savedUi?.fitWidth ?? false));
  const [showAllPlacementLinks, setShowAllPlacementLinks] = useState<boolean>(() =>
    Boolean(savedUi?.showAllPlacementLinks ?? false)
  );
  const [ganttToolbarOpen, setGanttToolbarOpen] = useState<boolean>(
    () => savedUi?.ganttToolbarOpen !== false && savedUi?.ganttFiltersOpen !== false
  );
  const [timelineViewportWidth, setTimelineViewportWidth] = useState<number>(0);
  const [timelineScaleMenu, setTimelineScaleMenu] = useState<null | { x: number; y: number }>(null);
  const timelineScaleMenuRef = useRef<HTMLDivElement | null>(null);

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
  const [filterWorkshopIds, setFilterWorkshopIds] = useState<string[]>(() => {
    const arr = savedUi?.filterWorkshopIds;
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    return [];
  });
  const [filterStatusIds, setFilterStatusIds] = useState<string[]>(() => {
    const arr = savedUi?.filterStatusIds;
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

  const eventStatusesQ = useQuery({
    queryKey: ["ref", "event-statuses"],
    queryFn: () => apiGet<EventStatusCatalogItem[]>("/api/ref/event-statuses"),
    staleTime: 60_000
  });
  const statusCatalog = useMemo(() => overlayStatusCatalog(eventStatusesQ.data), [eventStatusesQ.data]);
  const selectableStatusOptions = useMemo(
    () => statusCatalog.filter((s) => s.selectable).map((s) => ({ id: s.code, label: s.name })),
    [statusCatalog]
  );

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
        type: t?.name || "—"
      });
    }
    out.sort((a, b) => `${a.operator} ${a.type}`.localeCompare(`${b.operator} ${b.type}`, "ru"));
    return out;
  }, [aircraftPaletteMap, aircraftQ.data, aircraftTypesQ.data]);

  const eventTypesQ = useQuery({
    queryKey: ["ref", "event-types"],
    queryFn: () => apiGet<EventType[]>("/api/ref/event-types")
  });

  const workshopsQ = useQuery({
    queryKey: ["ref", "workshops"],
    queryFn: () => apiGet<Array<{ id: string; code: string; name: string; isActive?: boolean }>>("/api/ref/workshops")
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
  const [dndHangarIds, setDndHangarIds] = useState<string[]>(() => {
    const arr = savedUi?.dndHangarIds;
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    return [];
  });
  const [dndLayoutIds, setDndLayoutIds] = useState<string[]>(() => {
    const arr = savedUi?.dndLayoutIds;
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    return [];
  });
  const [dndZoneOnly, setDndZoneOnly] = useState<boolean>(() => Boolean(savedUi?.dndZoneOnly ?? false));
  const [selectedDndEventIds, setSelectedDndEventIds] = useState<string[]>([]);
  /** Показывать на Гантте внешние MRO (isPhysical=false). По умолчанию — да. */
  const [showExternalMroOnGantt, setShowExternalMroOnGantt] = useState<boolean>(
    () => savedUi?.showExternalMroOnGantt !== false
  );

  const resetFilters = () => {
    const rf = dayjs().add(-20, "day").format("YYYY-MM-DD");
    const rt = dayjs().add(30, "day").format("YYYY-MM-DD");

    setFilterAircraftTypeIds([]);
    setFilterOperatorIds([]);
    setFilterAircraftIds([]);
    setFilterEventTypeIds([]);
    setFilterWorkshopIds([]);
    setFilterStatusIds([]);
    setFilterPlanningKind("ALL");
    setSelectedHangarIds([]);
    setDndHangarIds([]);
    setDndLayoutIds([]);
    setDndZoneOnly(false);
    setSelectedDndEventIds([]);

    setRangeFromInput(rf);
    setRangeToInput(rt);
    setRangeFromApplied(rf);
    setRangeToApplied(rt);
    setRangeError(null);
  };

  const dndActive = dndEnabled && canDnd && groupMode === "HANGAR_STAND";
  const dndHangarScopeIds = dndHangarIds.length > 0 ? dndHangarIds : selectedHangarIds;

  const dndLayoutsQ = useQuery({
    queryKey: ["ref", "dnd-layouts", dndHangarScopeIds.slice().sort().join(",")],
    enabled: dndActive,
    queryFn: async () => {
      if (dndHangarScopeIds.length === 0) {
        return await apiGet<Layout[]>("/api/ref/layouts?activeOnly=1");
      }
      const chunks = await Promise.all(
        dndHangarScopeIds.map((hid) =>
          apiGet<Layout[]>(`/api/ref/layouts?hangarId=${encodeURIComponent(hid)}&activeOnly=1`)
        )
      );
      const byId = new Map<string, Layout>();
      for (const chunk of chunks) for (const l of chunk) byId.set(l.id, l);
      return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }
  });

  const dndLayoutOptions = useMemo(() => {
    return (dndLayoutsQ.data ?? []).map((l) => {
      const hangarName = (hangarsQ.data ?? []).find((h) => h.id === l.hangarId)?.name ?? "Ангар";
      return { id: l.id, label: `${hangarName} / ${l.name}` };
    });
  }, [dndLayoutsQ.data, hangarsQ.data]);

  useEffect(() => {
    if (dndLayoutIds.length === 0) return;
    const avail = new Set((dndLayoutsQ.data ?? []).map((l) => l.id));
    if (avail.size === 0) return;
    const next = dndLayoutIds.filter((id) => avail.has(id));
    if (next.length !== dndLayoutIds.length) setDndLayoutIds(next);
  }, [dndLayoutsQ.data, dndLayoutIds]);

  const dndStandsQ = useQuery({
    queryKey: [
      "ref",
      "dnd-stands",
      dndHangarScopeIds.slice().sort().join(","),
      dndLayoutIds.slice().sort().join(",")
    ],
    enabled: dndActive,
    queryFn: async () => {
      let layouts: Layout[];
      if (dndHangarScopeIds.length === 0) {
        layouts = await apiGet<Layout[]>("/api/ref/layouts?activeOnly=1");
      } else {
        const chunks = await Promise.all(
          dndHangarScopeIds.map((hid) =>
            apiGet<Layout[]>(`/api/ref/layouts?hangarId=${encodeURIComponent(hid)}&activeOnly=1`)
          )
        );
        const layoutById = new Map<string, Layout>();
        for (const chunk of chunks) {
          for (const l of chunk) layoutById.set(l.id, l);
        }
        layouts = Array.from(layoutById.values());
      }
      if (dndLayoutIds.length > 0) {
        const allow = new Set(dndLayoutIds);
        layouts = layouts.filter((l) => allow.has(l.id));
      }
      const standsPerLayout = await Promise.all(
        layouts.map((l) => apiGet<Stand[]>(`/api/ref/stands?layoutId=${encodeURIComponent(l.id)}&activeOnly=1`))
      );
      const hangarById = new Map(
        (hangarsQ.data ?? []).map((h) => [h.id, { name: h.name, code: h.code ?? "" }] as const)
      );
      const out: DndStand[] = [];
      for (let i = 0; i < layouts.length; i++) {
        const l = layouts[i]!;
        const hangar = hangarById.get(l.hangarId);
        const hname = hangar?.name ?? "Ангар";
        for (const s of standsPerLayout[i] ?? []) {
          if ((s as any).isActive === false) continue;
          out.push({
            ...(s as any),
            layoutId: (s as any).layoutId ?? l.id,
            hangarId: l.hangarId,
            hangarName: hname,
            hangarCode: hangar?.code ?? "",
            layoutName: l.name,
            layoutCode: l.code ?? ""
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
    const prev = isMobile ? safeReadGanttUi() ?? {} : null;
    safeWriteGanttUi({
      rangeFromApplied,
      rangeToApplied,
      rangeFromInput,
      rangeToInput,
      groupMode,
      panelView: isMobile && prev ? (prev.panelView ?? panelView) : panelView,
      ganttDisplayMode,
      majorScale,
      minorScale,
      timelineTimeMode,
      timeModeMigratedToLocalDefault: true,
      selectedHangarIds,
      filterAircraftTypeIds,
      filterOperatorIds,
      filterAircraftIds,
      filterEventTypeIds,
      filterWorkshopIds,
      filterStatusIds,
      filterPlanningKind,
      ganttLabelWidth,
      fitWidth,
      showAllPlacementLinks,
      ganttToolbarOpen: isMobile && prev ? (prev.ganttToolbarOpen ?? ganttToolbarOpen) : ganttToolbarOpen,
      dndEnabled: isMobile && prev ? (prev.dndEnabled ?? dndEnabled) : dndEnabled,
      dndHangarIds,
      dndLayoutIds,
      dndZoneOnly,
      showExternalMroOnGantt,
      zoom: minorScale
    });
  }, [
    rangeFromApplied,
    rangeToApplied,
    rangeFromInput,
    rangeToInput,
    groupMode,
    panelView,
    ganttDisplayMode,
    majorScale,
    minorScale,
    timelineTimeMode,
    selectedHangarIds,
    filterAircraftTypeIds,
    filterOperatorIds,
    filterAircraftIds,
    filterEventTypeIds,
    filterWorkshopIds,
    filterStatusIds,
    filterPlanningKind,
    ganttLabelWidth,
    fitWidth,
    showAllPlacementLinks,
    ganttToolbarOpen,
    dndEnabled,
    dndHangarIds,
    dndLayoutIds,
    dndZoneOnly,
    showExternalMroOnGantt,
    isMobile,
  ]);

  const events = q.data ?? [];

  const externalMroHangarIds = useMemo(() => {
    return new Set((hangarsQ.data ?? []).filter((h) => h.isPhysical === false).map((h) => h.id));
  }, [hangarsQ.data]);

  const eventsForGantt = useMemo(() => {
    if (showExternalMroOnGantt || externalMroHangarIds.size === 0) return events;
    return events.filter((e) => {
      const ids = eventHangarIds(e);
      if (ids.length === 0) return true;
      return ids.some((id) => !externalMroHangarIds.has(id));
    });
  }, [events, showExternalMroOnGantt, externalMroHangarIds]);

  const ganttFilters = useMemo<GanttFilters>(
    () => ({
      hangarIds: selectedHangarIds,
      operatorIds: filterOperatorIds,
      aircraftTypeIds: filterAircraftTypeIds,
      aircraftIds: filterAircraftIds,
      eventTypeIds: filterEventTypeIds,
      workshopIds: filterWorkshopIds,
      statusIds: filterStatusIds,
      planningKind: filterPlanningKind
    }),
    [selectedHangarIds, filterOperatorIds, filterAircraftTypeIds, filterAircraftIds, filterEventTypeIds, filterWorkshopIds, filterStatusIds, filterPlanningKind]
  );

  const smartFilterOptions = useMemo(() => {
    const hangarIdSet = new Set<string>();
    const operatorIdSet = new Set<string>();
    const aircraftTypeIdSet = new Set<string>();
    const aircraftIdSet = new Set<string>();
    const eventTypeIdSet = new Set<string>();
    const workshopIdSet = new Set<string>();
    const statusIdSet = new Set<string>();
    const planningKindSet = new Set<"PLANNED" | "UNPLANNED">();

    for (const e of eventsForGantt) {
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
      if (eventMatchesGanttFilters(e, ganttFilters, "workshopIds")) {
        const wid = eventWorkshopId(e);
        if (wid) workshopIdSet.add(wid);
      }
      if (eventMatchesGanttFilters(e, ganttFilters, "statusIds")) {
        const sid = eventStatusId(e);
        if (sid) statusIdSet.add(sid);
      }
      if (eventMatchesGanttFilters(e, ganttFilters, "planningKind")) {
        const pk = String(e.planningKind ?? "").toUpperCase();
        if (pk === "PLANNED" || pk === "UNPLANNED") planningKindSet.add(pk);
      }
    }

    const hangars = (hangarsQ.data ?? [])
      .filter((h) => eventsForGantt.length === 0 || hangarIdSet.has(h.id))
      .filter((h) => showExternalMroOnGantt || h.isPhysical !== false)
      .map((h) => ({
        id: h.id,
        label: h.isPhysical === false ? `${h.name} (MRO)` : h.name
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const operators = (operatorsQ.data ?? [])
      .filter((o) => eventsForGantt.length === 0 || operatorIdSet.has(o.id))
      .map((o) => ({ id: o.id, label: o.code ? `${o.code} • ${o.name}` : o.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const aircraftTypes = (aircraftTypesQ.data ?? [])
      .filter((t) => eventsForGantt.length === 0 || aircraftTypeIdSet.has(t.id))
      .map((t) => ({ id: t.id, label: t.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const aircraft = (aircraftQ.data ?? [])
      .filter((a) => eventsForGantt.length === 0 || aircraftIdSet.has(String(a.id)))
      .map((a) => ({ id: a.id, label: a.tailNumber }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const eventTypes = (eventTypesQ.data ?? [])
      .filter((t) => eventsForGantt.length === 0 || eventTypeIdSet.has(t.id))
      .map((t) => ({ id: t.id, label: t.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const workshops = (workshopsQ.data ?? [])
      .filter((w) => w.isActive !== false)
      .filter((w) => eventsForGantt.length === 0 || workshopIdSet.has(w.id))
      .map((w) => ({ id: w.id, label: w.code ? `${w.code} • ${w.name}` : w.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    const statusSortOrder = new Map<string, number>(statusCatalog.map((s) => [s.code, s.sortOrder]));
    const statuses =
      eventsForGantt.length === 0
        ? selectableStatusOptions
        : [...statusIdSet]
            .map((id) => ({
              id,
              label: statusCatalogLabel(id, statusCatalog),
              sortOrder: statusSortOrder.get(id) ?? 999
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "ru"))
            .map(({ id, label }) => ({ id, label }));

    return { hangars, operators, aircraftTypes, aircraft, eventTypes, workshops, statuses, planningKinds: planningKindSet };
  }, [eventsForGantt, ganttFilters, hangarsQ.data, operatorsQ.data, aircraftTypesQ.data, aircraftQ.data, eventTypesQ.data, workshopsQ.data, showExternalMroOnGantt, statusCatalog, selectableStatusOptions]);

  useEffect(() => {
    if (eventsForGantt.length === 0) return;

    const prune = (selected: string[], available: Set<string>) => selected.filter((id) => available.has(id));
    const hangarAvail = new Set(smartFilterOptions.hangars.map((o) => o.id));
    const operatorAvail = new Set(smartFilterOptions.operators.map((o) => o.id));
    const typeAvail = new Set(smartFilterOptions.aircraftTypes.map((o) => o.id));
    const aircraftAvail = new Set(smartFilterOptions.aircraft.map((o) => o.id));
    const eventTypeAvail = new Set(smartFilterOptions.eventTypes.map((o) => o.id));
    const workshopAvail = new Set(smartFilterOptions.workshops.map((o) => o.id));
    const statusAvail = new Set(smartFilterOptions.statuses.map((o) => o.id));

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

    const nextWorkshops = prune(filterWorkshopIds, workshopAvail);
    if (nextWorkshops.length !== filterWorkshopIds.length) setFilterWorkshopIds(nextWorkshops);

    const nextStatuses = prune(filterStatusIds, statusAvail);
    if (nextStatuses.length !== filterStatusIds.length) setFilterStatusIds(nextStatuses);

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
    filterWorkshopIds,
    filterStatusIds,
    filterPlanningKind
  ]);

  const fixedDayWidth = ZOOM_PX_PER_DAY[minorScale];
  const dayWidth = useMemo(() => {
    if (!fitWidth || timelineViewportWidth <= 0 || days <= 0) return fixedDayWidth;
    return Math.max(MIN_FIT_DAY_WIDTH, timelineViewportWidth / days);
  }, [fitWidth, timelineViewportWidth, days, fixedDayWidth]);
  // Всегда через dayWidth: при выходе из «по ширине» ширина гарантированно возвращается к зуму.
  const canvasWidth = useMemo(() => Math.max(1, Math.round(days * dayWidth)), [days, dayWidth]);
  // Эпоха только при смене fit — remount внутренних слоёв скролла (Chromium иначе
  // не обновляет scrollWidth), без remount на каждый canvasWidth (это дёргало скролл).
  const [fitLayoutEpoch, setFitLayoutEpoch] = useState(0);
  const ganttRowHeight = ganttDisplayMode === "PLAN_FACT" ? 56 : 44;
  const ticks = useMemo(() => buildGanttTicks(from, to, majorScale, minorScale), [from, to, majorScale, minorScale]);
  const showSlotHistogram = groupMode === "HANGAR_STAND";
  const ganttLabelColStyle = useMemo(() => ({ width: ganttLabelWidth, flexBasis: ganttLabelWidth }), [ganttLabelWidth]);
  const ganttLeftColRef = useRef<HTMLDivElement | null>(null);
  const [axisLabelWidth, setAxisLabelWidth] = useState(ganttLabelWidth);
  useLayoutEffect(() => {
    setAxisLabelWidth(ganttLabelWidth);
    const el = ganttLeftColRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number" && Number.isFinite(w) && w > 0) setAxisLabelWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ganttLabelWidth, panelView]);
  const preferAxisCodes = axisLabelWidth < AXIS_CODES_BELOW_WIDTH;
  const hangarMetaById = useMemo(() => {
    const m = new Map<string, { name: string; code: string }>();
    for (const h of hangarsQ.data ?? []) m.set(h.id, { name: h.name, code: h.code ?? "" });
    return m;
  }, [hangarsQ.data]);
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

  useEffect(() => {
    // Высота закреплённого блока фильтров — для sticky шкалы Гантта и высоты таблицы.
    const el = ganttFiltersStickyRef.current;
    if (!el) return;
    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--gantt-filters-sticky-height", `${h}px`);
    };
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--gantt-filters-sticky-height");
    };
  }, []);

  useEffect(() => {
    // Ширину viewport меряем только для «по ширине» — иначе ResizeObserver
    // даёт лишние ререндеры и дёрганый горизонтальный скролл.
    if (!fitWidth) return;
    const el = bodyScrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      setTimelineViewportWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [panelView, ganttLabelWidth, fitWidth]);

  useEffect(() => {
    if (!timelineScaleMenu) return;
    const onDoc = (e: MouseEvent) => {
      // ПКМ / auxclick не должны сразу закрывать только что открытое меню
      if (e.button !== 0) return;
      if (timelineScaleMenuRef.current && e.target instanceof Node && !timelineScaleMenuRef.current.contains(e.target)) {
        setTimelineScaleMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTimelineScaleMenu(null);
    };
    // откладываем подписку, чтобы тот же ПКМ не закрыл меню до отрисовки
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [timelineScaleMenu]);

  const startGanttLabelResize = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = ganttLabelWidth;
    const maxByViewport = Math.max(
      MAX_GANTT_LABEL_WIDTH,
      Math.floor((typeof window !== "undefined" ? window.innerWidth : MAX_GANTT_LABEL_WIDTH) * 0.55)
    );
    const onMove = (ev: PointerEvent) => {
      setGanttLabelWidth(clamp(startWidth + ev.clientX - startX, MIN_GANTT_LABEL_WIDTH, maxByViewport));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [ganttLabelWidth]);

  useEffect(() => {
    const update = () => setCurrentMinute(dayjs().utcOffset(timelineTimeMode === "UTC" ? 0 : MSK_OFFSET_MINUTES).second(0).millisecond(0));
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

  // Блокировка обратной связи + coalesce через rAF — иначе связка body/header/bottom дёргается.
  const scrollSyncLockRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<{ left: number; source: "body" | "bottom" } | null>(null);

  const applyGanttScrollLeft = useCallback((scrollLeft: number, source?: "body" | "bottom") => {
    const h = headerViewportRef.current;
    const b = bodyScrollRef.current;
    const g = histogramViewportRef.current;
    const s = bottomScrollRef.current;

    scrollSyncLockRef.current = true;
    if (h && h.scrollLeft !== scrollLeft) h.scrollLeft = scrollLeft;
    if (b && source !== "body" && b.scrollLeft !== scrollLeft) b.scrollLeft = scrollLeft;
    if (g && g.scrollLeft !== scrollLeft) g.scrollLeft = scrollLeft;
    if (s && source !== "bottom" && s.scrollLeft !== scrollLeft) s.scrollLeft = scrollLeft;
    requestAnimationFrame(() => {
      scrollSyncLockRef.current = false;
    });
  }, []);

  const syncGanttScrollLeft = useCallback(
    (scrollLeft: number, source?: "body" | "bottom") => {
      // DnD auto-scroll и явные сбросы — сразу; пользовательский скролл — через rAF.
      if (!source) {
        applyGanttScrollLeft(scrollLeft);
        return;
      }
      pendingScrollRef.current = { left: scrollLeft, source };
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const pending = pendingScrollRef.current;
        pendingScrollRef.current = null;
        if (!pending) return;
        applyGanttScrollLeft(pending.left, pending.source);
      });
    },
    [applyGanttScrollLeft]
  );

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // Только при переключении «по ширине»: remount слоёв скролла + принудительный пересчёт overflow.
  const prevFitWidthRef = useRef(fitWidth);
  useEffect(() => {
    if (prevFitWidthRef.current === fitWidth) return;
    prevFitWidthRef.current = fitWidth;
    setFitLayoutEpoch((n) => n + 1);
    const bumpOverflow = (el: HTMLElement | null) => {
      if (!el) return;
      const prev = el.style.overflowX;
      el.style.overflowX = "hidden";
      void el.offsetWidth;
      el.style.overflowX = prev || "";
      void el.scrollWidth;
    };
    const raf = window.requestAnimationFrame(() => {
      bumpOverflow(bodyScrollRef.current);
      bumpOverflow(bottomScrollRef.current);
      bumpOverflow(headerViewportRef.current);
      bumpOverflow(histogramViewportRef.current);
      applyGanttScrollLeft(0);
      requestAnimationFrame(() => {
        bumpOverflow(bodyScrollRef.current);
        bumpOverflow(bottomScrollRef.current);
        applyGanttScrollLeft(0);
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [fitWidth, applyGanttScrollLeft]);

  const onBodyScroll = () => {
    if (scrollSyncLockRef.current) return;
    const b = bodyScrollRef.current;
    if (!b) return;
    syncGanttScrollLeft(b.scrollLeft, "body");
  };

  const onBottomScroll = () => {
    if (scrollSyncLockRef.current) return;
    const s = bottomScrollRef.current;
    if (!s) return;
    syncGanttScrollLeft(s.scrollLeft, "bottom");
  };

  // Pan без setState (ререндер mid-drag ломал capture/клики).
  // Ghost-click после pan глушим одноразовым listener'ом с авто-снятием.
  const spacePanRef = useRef(false);
  const panSessionRef = useRef<null | {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>(null);
  const panWinCleanupRef = useRef<null | (() => void)>(null);
  const panGhostCleanupRef = useRef<null | (() => void)>(null);

  const setGanttPanClass = useCallback((kind: "ready" | "panning", on: boolean) => {
    const el = bodyScrollRef.current;
    if (!el) return;
    el.classList.toggle(kind === "ready" ? "ganttPanReady" : "ganttPanning", on);
  }, []);

  const clearGanttPanDom = useCallback(() => {
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("-webkit-user-select");
    document.body.style.removeProperty("cursor");
    setGanttPanClass("panning", false);
  }, [setGanttPanClass]);

  const swallowGhostClickOnce = useCallback(() => {
    panGhostCleanupRef.current?.();
    let done = false;
    const handler = (e: Event) => {
      if (done) return;
      done = true;
      e.preventDefault();
      e.stopPropagation();
      (e as MouseEvent).stopImmediatePropagation?.();
      cleanup();
    };
    const cleanup = () => {
      document.removeEventListener("click", handler, true);
      document.removeEventListener("auxclick", handler, true);
      window.clearTimeout(timer);
      if (panGhostCleanupRef.current === cleanup) panGhostCleanupRef.current = null;
    };
    document.addEventListener("click", handler, true);
    document.addEventListener("auxclick", handler, true);
    // Ghost-click приходит сразу после pointerup; дольше не держим — иначе «залипание».
    const timer = window.setTimeout(cleanup, 80);
    panGhostCleanupRef.current = cleanup;
  }, []);

  const endGanttPanSession = useCallback(() => {
    const session = panSessionRef.current;
    if (!session) return;
    const didMove = session.moved;
    panSessionRef.current = null;
    panWinCleanupRef.current?.();
    panWinCleanupRef.current = null;
    clearGanttPanDom();
    if (didMove) swallowGhostClickOnce();
  }, [clearGanttPanDom, swallowGhostClickOnce]);

  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return Boolean(el.isContentEditable);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;
      spacePanRef.current = true;
      setGanttPanClass("ready", true);
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      spacePanRef.current = false;
      setGanttPanClass("ready", false);
    };
    const clearSpace = () => {
      spacePanRef.current = false;
      setGanttPanClass("ready", false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", clearSpace);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", clearSpace);
      panWinCleanupRef.current?.();
      panGhostCleanupRef.current?.();
      clearGanttPanDom();
    };
  }, [setGanttPanClass, clearGanttPanDom]);

  useEffect(() => {
    const onSelectStart = (e: Event) => {
      if (panSessionRef.current) e.preventDefault();
    };
    document.addEventListener("selectstart", onSelectStart, true);
    return () => document.removeEventListener("selectstart", onSelectStart, true);
  }, []);

  const onGanttPanPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (panelView !== "DIAGRAM") return;
      if (ptrDragRef.current?.started) return;
      if (panSessionRef.current) return;

      const isMMB = e.button === 1;
      const isLMB = e.button === 0;
      if (!isMMB && !isLMB) return;

      const target = e.target as HTMLElement | null;
      if (target?.closest?.("button, a, input, textarea, select, label, .ganttAxisResizeHandle")) return;

      const onBar = Boolean(target?.closest?.(".bar, .factBar, [data-dnd-bar='1']"));
      const spaceHeld = spacePanRef.current;
      if (isLMB && onBar && !spaceHeld) return;

      const immediate = isMMB || spaceHeld;
      if (immediate) {
        e.preventDefault();
        e.stopPropagation();
      }

      document.body.style.userSelect = "none";
      document.body.style.setProperty("-webkit-user-select", "none");

      panSessionRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: immediate
      };

      if (immediate) {
        setGanttPanClass("panning", true);
        document.body.style.cursor = "grabbing";
      }

      const onMove = (ev: PointerEvent) => {
        const s = panSessionRef.current;
        if (!s || s.pointerId !== ev.pointerId) return;
        const dx = ev.clientX - s.lastX;
        const dy = ev.clientY - s.lastY;
        if (!s.moved) {
          if (Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) < 4) return;
          s.moved = true;
          setGanttPanClass("panning", true);
          document.body.style.cursor = "grabbing";
        }
        s.lastX = ev.clientX;
        s.lastY = ev.clientY;

        const body = bodyScrollRef.current;
        if (body && dx !== 0) {
          const max = Math.max(0, body.scrollWidth - body.clientWidth);
          const next = Math.max(0, Math.min(max, body.scrollLeft - dx));
          if (next !== body.scrollLeft) {
            body.scrollLeft = next;
            applyGanttScrollLeft(next, "body");
          }
        }
        if (dy !== 0) {
          const main = ganttPageMainRef.current;
          if (main) main.scrollTop -= dy;
          else window.scrollBy(0, -dy);
        }
        ev.preventDefault();
      };

      const onUp = (ev: PointerEvent) => {
        const s = panSessionRef.current;
        if (!s || s.pointerId !== ev.pointerId) return;
        endGanttPanSession();
      };

      panWinCleanupRef.current?.();
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
      panWinCleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
      };
    },
    [panelView, applyGanttScrollLeft, setGanttPanClass, endGanttPanSession]
  );

  // редактор
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [original, setOriginal] = useState<EditorDraft | null>(null);
  // режим копирования: когда включён, клик по событию открывает редактор с предзаполненной
  // копией, а сохранение создаёт НОВОЕ событие (draft.id остаётся пустым)
  const [copySelectMode, setCopySelectMode] = useState(false);

  useEffect(() => {
    if (isMobile) {
      if (!mobileUiAppliedRef.current) {
        mobileUiAppliedRef.current = true;
        setPanelView("TABLE");
        setGanttToolbarOpen(false);
        setDndEnabled(false);
        setCopySelectMode(false);
        setSelectedDndEventIds([]);
      }
      return;
    }
    mobileUiAppliedRef.current = false;
  }, [isMobile]);

  const [copyFromTitle, setCopyFromTitle] = useState<string | null>(null);
  const [shareHint, setShareHint] = useState<string | null>(null);

  const shareCurrentEvent = async () => {
    if (!draft?.id) return;
    const url = buildEventShareUrl({
      eventId: draft.id,
      sandboxId: activeSandboxId
    });
    const ok = await copyTextToClipboard(url);
    setShareHint(ok ? "Ссылка скопирована" : "Не удалось скопировать ссылку");
    window.setTimeout(() => setShareHint(null), 2200);
  };

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
  const aircraftSelectOptions = useMemo(() => {
    const selectedId = draft?.aircraftId ?? "";
    const opts = (aircraftQ.data ?? []).map((a) => ({ id: a.id, label: a.tailNumber }));
    if (!selectedId) return opts;
    const selected = opts.filter((o) => o.id === selectedId);
    const rest = opts.filter((o) => o.id !== selectedId);
    return [...selected, ...rest];
  }, [aircraftQ.data, draft?.aircraftId]);
  const aircraftFieldEditable = draft?.status != null && AIRCRAFT_EDITABLE_STATUSES.has(draft.status);
  /** В статусе «Завершено» нельзя менять даты, тип планирования/события, ангар и буксировки. */
  const scheduleLockedByDone = draft?.status === "DONE";
  const selectedDraftEvent = useMemo(() => {
    if (!draft?.id) return null;
    return events.find((ev) => ev.id === draft.id) ?? null;
  }, [draft?.id, events]);

  const editorSummary = useMemo(() => {
    if (!draft) return "";
    const typeName =
      (eventTypesQ.data ?? []).find((t) => t.id === draft.eventTypeId)?.name ??
      selectedDraftEvent?.eventType?.name ??
      "Тип не указан";
    const aircraftLabel =
      selectedAircraft?.tailNumber ??
      selectedDraftEvent?.aircraft?.tailNumber ??
      selectedDraftEvent?.virtualAircraft?.label ??
      "Борт не указан";
    const title = draft.title?.trim() || "Без названия";
    const fmt = (v: string) => {
      if (!v) return "—";
      const d = dayjs(v);
      return d.isValid() ? d.format("DD.MM.YYYY HH:mm") : v;
    };
    return `${typeName} · ${aircraftLabel} · ${title} · ${fmt(draft.startAtLocal)} – ${fmt(draft.endAtLocal)}`;
  }, [draft, eventTypesQ.data, selectedAircraft, selectedDraftEvent]);

  const selectedVirtualAircraft = selectedDraftEvent?.virtualAircraft ?? null;
  const selectedVirtualOperatorName = selectedVirtualAircraft?.operatorId
    ? ((operatorsQ.data ?? []).find((operator) => operator.id === selectedVirtualAircraft.operatorId)?.name ?? "—")
    : "—";
  const selectedVirtualAircraftType = selectedVirtualAircraft?.aircraftTypeId
    ? ((aircraftTypesQ.data ?? []).find((type) => type.id === selectedVirtualAircraft.aircraftTypeId) ?? null)
    : null;
  const selectedAircraftTypeId = selectedAircraft?.typeId ?? selectedVirtualAircraft?.aircraftTypeId ?? "";
  const aircraftFieldLabel =
    selectedAircraft?.tailNumber ??
    (selectedVirtualAircraft && !draft?.aircraftId ? selectedVirtualAircraft.label ?? "—" : "—");

  // подтверждение изменения
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState<
    "event" | "reserve" | "towAdd" | "towDel" | "dndMove" | "bulkStatus" | null
  >(null);
  const [changeReason, setChangeReason] = useState("");
  /** Сброс ошибок/статуса мутаций карточки при открытии другой / закрытии */
  const [editorFeedbackEpoch, setEditorFeedbackEpoch] = useState(0);
  const bumpEditorFeedbackReset = () => setEditorFeedbackEpoch((n) => n + 1);

  const openEditorForNew = () => {
    if (!canEditEventsEffective) return;
    if (editorOpen && editorCollapsed) return;
    bumpEditorFeedbackReset();
    const defaultAircraft = aircraftQ.data?.[0]?.id ?? "";
    const defaultEventType = eventTypesQ.data?.[0]?.id ?? "";
    const defaultStart = dayjs().add(1, "day").hour(9).minute(0).second(0).format("YYYY-MM-DDTHH:mm");
    const defaultEnd = dayjs().add(3, "day").hour(18).minute(0).second(0).format("YYYY-MM-DDTHH:mm");
    const d: EditorDraft = {
      title: "ТО",
      level: "OPERATIONAL",
      status: DEFAULT_EVENT_STATUS,
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
      workshopId: "",
      layoutId: "",
      standId: "",
      allowOverlap: false,
      multiPlacement: false,
      autoFillGapPlacements: true,
      placements: [
        ensurePlacementClientKey({
          origin: "MANUAL",
          startAtLocal: defaultStart,
          endAtLocal: defaultEnd,
          budgetStartAtLocal: defaultStart,
          budgetEndAtLocal: defaultEnd,
          actualStartAtLocal: "",
          actualEndAtLocal: "",
          hangarId: "",
          layoutId: "",
          standId: ""
        })
      ]
    };
    setDraft(d);
    setOriginal(d);
    setChangeReason("");
    setCopyFromTitle(null);
    setEditorCollapsed(false);
    setEditorOpen(true);
  };

  const openEditorForExisting = (ev: EventRow) => {
    if (editorOpen && editorCollapsed) return;
    bumpEditorFeedbackReset();
    const startAtLocal = toInputLocal(ev.startAt);
    const endAtLocal = toInputLocal(ev.endAt);
    const placements = placementDraftFromEvent(ev);
    const d: EditorDraft = {
      id: ev.id,
      title: ev.title,
      level: ev.level,
      status: (ev.status as any) ?? DEFAULT_EVENT_STATUS,
      planningKind: eventPlanningKind(ev),
      aircraftId: (ev.aircraft as any)?.id ?? (ev as any).aircraftId ?? "",
      eventTypeId: (ev.eventType as any)?.id ?? (ev as any)?.eventTypeId ?? "",
      startAtLocal,
      endAtLocal,
      budgetStartAtLocal: toInputLocal(ev.budgetStartAt),
      budgetEndAtLocal: toInputLocal(ev.budgetEndAt),
      actualStartAtLocal: toInputLocal(ev.actualStartAt),
      actualEndAtLocal: toInputLocal(ev.actualEndAt),
      notes: ev.notes ?? "",
      hangarId: (ev.hangar as any)?.id ?? "",
      workshopId: (ev.workshop as any)?.id ?? (ev as any).workshopId ?? "",
      layoutId: (ev.layout as any)?.id ?? "",
      standId: (ev.reservation?.stand as any)?.id ?? "",
      allowOverlap: false,
      multiPlacement: placements.length > 1,
      autoFillGapPlacements: true,
      placements
    };
    setDraft(d);
    setOriginal(d);
    setChangeReason("");
    setCopyFromTitle(null);
    setEditorCollapsed(false);
    setEditorOpen(true);
  };

  // Открыть редактор в режиме копирования выбранного события:
  // все данные переносятся, id НЕ копируется (draft.id = undefined),
  // статус сбрасывается в PLANNED, к названию добавляется « (копия)»
  const openEditorForCopy = (ev: EventRow) => {
    if (editorOpen && editorCollapsed) return;
    bumpEditorFeedbackReset();
    const startAtLocal = toInputLocal(ev.startAt);
    const endAtLocal = toInputLocal(ev.endAt);
    const placements = placementDraftFromEvent(ev).map((p) =>
      ensurePlacementClientKey({ ...p, id: undefined, actualStartAtLocal: "", actualEndAtLocal: "" })
    );
    const d: EditorDraft = {
      title: `${ev.title} (копия)`,
      level: ev.level,
      status: DEFAULT_EVENT_STATUS,
      planningKind: eventPlanningKind(ev),
      aircraftId: (ev.aircraft as any)?.id ?? (ev as any).aircraftId ?? "",
      eventTypeId: (ev.eventType as any)?.id ?? (ev as any)?.eventTypeId ?? "",
      startAtLocal,
      endAtLocal,
      budgetStartAtLocal: toInputLocal(ev.budgetStartAt),
      budgetEndAtLocal: toInputLocal(ev.budgetEndAt),
      actualStartAtLocal: "",
      actualEndAtLocal: "",
      notes: ev.notes ?? "",
      hangarId: (ev.hangar as any)?.id ?? "",
      workshopId: (ev.workshop as any)?.id ?? (ev as any).workshopId ?? "",
      layoutId: (ev.layout as any)?.id ?? "",
      standId: (ev.reservation?.stand as any)?.id ?? "",
      allowOverlap: false,
      multiPlacement: placements.length > 1,
      autoFillGapPlacements: true,
      placements
    };
    setDraft(d);
    setOriginal(d);
    setChangeReason("");
    setCopyFromTitle(ev.title);
    setCopySelectMode(false);
    setEditorCollapsed(false);
    setEditorOpen(true);
  };

  // Унифицированный выбор события: в обычном режиме — редактирование,
  // в режиме копирования — открытие мастера копии.
  const pickEvent = (ev: EventRow) => {
    if (editorOpen && editorCollapsed) return;
    const fullEvent = events.find((candidate) => candidate.id === ev.id) ?? ev;
    if (copySelectMode) openEditorForCopy(fullEvent);
    else openEditorForExisting(fullEvent);
  };

  // Открытие карточки из уведомления / shared-ссылки — без смены периода на Гантте
  const [pendingOpenEventId, setPendingOpenEventId] = useState<string | null>(null);

  useEffect(() => {
    const consumeStorage = () => {
      try {
        const eventId = sessionStorage.getItem("hangarPlanning:openEventId");
        if (eventId) {
          sessionStorage.removeItem("hangarPlanning:openEventId");
          sessionStorage.removeItem("hangarPlanning:openEventStartAt");
          sessionStorage.removeItem("hangarPlanning:openEventEndAt");
          sessionStorage.removeItem("hangarPlanning:openEventSandboxId");
          setPendingOpenEventId(eventId);
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    };

    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ eventId?: string }>).detail;
      if (!detail?.eventId) return;
      setPendingOpenEventId(detail.eventId);
    };

    consumeStorage();
    window.addEventListener("hangarPlanning:openEventFromNotification", onOpen);
    return () => window.removeEventListener("hangarPlanning:openEventFromNotification", onOpen);
  }, []);

  // После смены контура/песочницы снова пробуем открыть событие из sessionStorage
  useEffect(() => {
    try {
      const eventId = sessionStorage.getItem("hangarPlanning:openEventId");
      if (!eventId) return;
      sessionStorage.removeItem("hangarPlanning:openEventId");
      sessionStorage.removeItem("hangarPlanning:openEventStartAt");
      sessionStorage.removeItem("hangarPlanning:openEventEndAt");
      sessionStorage.removeItem("hangarPlanning:openEventSandboxId");
      setPendingOpenEventId(eventId);
    } catch {
      // ignore
    }
  }, [activeSandboxId]);

  useEffect(() => {
    if (!pendingOpenEventId) return;
    let cancelled = false;
    (async () => {
      try {
        const ev = await apiGet<EventRow>(`/api/events/${encodeURIComponent(pendingOpenEventId)}`);
        if (cancelled || !ev?.id) return;
        setPendingOpenEventId(null);
        openEditorForExisting(ev);
      } catch {
        if (!cancelled) setPendingOpenEventId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingOpenEventId, activeSandboxId]);

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

  // Полные справочники без фильтра по типу ВС — чтобы diff в «Подтверждении» резолвил и старые layout/stand.
  const historyLayoutsQ = useQuery({
    queryKey: ["ref", "layouts", "history-labels"],
    queryFn: () => apiGet<Layout[]>("/api/ref/layouts"),
    staleTime: 60_000
  });
  const historyStandsQ = useQuery({
    queryKey: ["ref", "stands", "history-labels"],
    queryFn: () => apiGet<Stand[]>("/api/ref/stands"),
    staleTime: 60_000
  });

  const historyRefMaps = useMemo<HistoryRefMaps>(() => {
    const hangars = new Map((hangarsQ.data ?? []).map((h) => [h.id, h.name] as const));
    const layouts = new Map<string, string>();
    const addLayout = (l: Layout) => {
      if (layouts.has(l.id)) return;
      const hangarName = hangars.get(l.hangarId);
      layouts.set(l.id, hangarName ? `${hangarName} / ${l.name}` : l.name);
    };
    for (const l of historyLayoutsQ.data ?? []) addLayout(l);
    for (const l of allLayoutsQ.data ?? []) addLayout(l);
    for (const l of layoutsForEditorQ.data ?? []) addLayout(l);

    const stands = new Map<string, string>();
    const addStand = (s: Stand) => {
      if (stands.has(s.id)) return;
      stands.set(s.id, s.code?.trim() ? s.code : s.name);
    };
    for (const s of historyStandsQ.data ?? []) addStand(s);
    for (const s of allStandsQ.data ?? []) addStand(s);
    for (const s of standsForEditorQ.data ?? []) addStand(s);

    return {
      hangars,
      layouts,
      stands,
      aircraft: new Map((aircraftQ.data ?? []).map((a) => [a.id, a.tailNumber] as const)),
      aircraftTypes: new Map(
        (aircraftTypesQ.data ?? []).map((t) => [t.id, t.icaoType ? `${t.icaoType} · ${t.name}` : t.name] as const)
      ),
      operators: new Map((operatorsQ.data ?? []).map((operator) => [operator.id, operator.name] as const)),
      eventTypes: new Map((eventTypesQ.data ?? []).map((t) => [t.id, t.name] as const)),
      workshops: new Map((workshopsQ.data ?? []).map((w) => [w.id, w.name] as const)),
      statuses: new Map(statusCatalog.map((s) => [s.code, s.name] as const))
    };
  }, [
    hangarsQ.data,
    historyLayoutsQ.data,
    allLayoutsQ.data,
    layoutsForEditorQ.data,
    historyStandsQ.data,
    allStandsQ.data,
    standsForEditorQ.data,
    aircraftQ.data,
    aircraftTypesQ.data,
    operatorsQ.data,
    eventTypesQ.data,
    workshopsQ.data,
    statusCatalog
  ]);

  const historyQ = useQuery({
    queryKey: ["event-history", draft?.id ?? ""],
    queryFn: () => apiGet<EventAudit[]>(`/api/events/${draft!.id}/history`),
    enabled: !!draft?.id && editorOpen
  });

  const historyByDay = useMemo(() => {
    const items = historyQ.data ?? [];
    const groups: Array<{ dayKey: string; label: string; items: EventAudit[] }> = [];
    const buckets = new Map<string, EventAudit[]>();
    const todayKey = dayjs().format("YYYY-MM-DD");
    const yesterdayKey = dayjs().subtract(1, "day").format("YYYY-MM-DD");
    for (const h of items) {
      const dayKey = dayjs(h.createdAt).format("YYYY-MM-DD");
      let bucket = buckets.get(dayKey);
      if (!bucket) {
        bucket = [];
        buckets.set(dayKey, bucket);
        const label =
          dayKey === todayKey ? "Сегодня" : dayKey === yesterdayKey ? "Вчера" : dayjs(dayKey).format("DD.MM.YYYY");
        groups.push({ dayKey, label, items: bucket });
      }
      bucket.push(h);
    }
    return groups;
  }, [historyQ.data]);

  const computeDraftDiff = (a: EditorDraft | null, b: EditorDraft | null) => {
    if (!a || !b) return [];
    const normalizePlacementsForDiff = (items: PlacementDraft[]) =>
      items.map((p) => ({
        origin: p.origin ?? "MANUAL",
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
      "workshopId",
      "layoutId",
      "standId",
      "multiPlacement",
      "autoFillGapPlacements"
    ];
    const diffs = keys
      .filter((k) => (a[k] ?? "") !== (b[k] ?? ""))
      .map((k) => ({ field: String(k), from: a[k] ?? "", to: b[k] ?? "" }));
    if (JSON.stringify(normalizePlacementsForDiff(a.placements)) !== JSON.stringify(normalizePlacementsForDiff(b.placements))) {
      const placementSummary = (items: PlacementDraft[]) => {
        const auto = items.filter((placement) => placement.origin === "AUTO_GAP");
        const minutes = auto.reduce(
          (total, placement) =>
            total + Math.max(0, dayjs(placement.endAtLocal).diff(dayjs(placement.startAtLocal), "minute")),
          0
        );
        return `${items.length} этапов · авто без ангара: ${auto.length} (${Number((minutes / 60).toFixed(1))} ч)`;
      };
      diffs.push({ field: "placements", from: placementSummary(a.placements), to: placementSummary(b.placements) });
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
    if (activeSandbox) {
      if (what === "event") saveEventM.mutate();
      else reserveM.mutate();
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
    const payload = { kind: "add" as const, startAt, endAt };
    setPendingTow(payload);
    setPendingSave("towAdd");
    if (activeSandbox) {
      addTowM.mutate(payload);
      return;
    }
    setConfirmOpen(true);
  };

  const requestTowDeleteWithReason = (towId: string) => {
    if (!draft?.id) throw new Error("Нет события");
    const payload = { kind: "del" as const, towId };
    setPendingTow(payload);
    setPendingSave("towDel");
    if (activeSandbox) {
      delTowM.mutate(payload);
      return;
    }
    setConfirmOpen(true);
  };

  const saveEventM = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Нет данных формы");
      if (!draft.eventTypeId) throw new Error("Заполните тип события");
      if (!draft.aircraftId && !selectedVirtualAircraft) throw new Error("Заполните борт");
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
      if (draft.multiPlacement) {
        const issues = placementWarnings({
          placements: draft.placements,
          eventStartAtLocal: draft.startAtLocal,
          eventEndAtLocal: draft.endAtLocal,
          autoFillGapPlacements: draft.autoFillGapPlacements
        });
        if (issues.length) throw new Error(issues[0]);
      }
      const placementsPayload = draft.multiPlacement
        ? placementApiPayload(
            normalizePlacementDraftGaps(
              draft.placements.map((p) =>
                p.origin === "AUTO_GAP"
                  ? {
                      ...p,
                      budgetStartAtLocal: "",
                      budgetEndAtLocal: "",
                      actualStartAtLocal: "",
                      actualEndAtLocal: ""
                    }
                  : draft.planningKind === "UNPLANNED"
                  ? { ...p, budgetStartAtLocal: "", budgetEndAtLocal: "" }
                  : {
                      ...p,
                      budgetStartAtLocal: p.budgetStartAtLocal || p.startAtLocal,
                      budgetEndAtLocal: p.budgetEndAtLocal || p.endAtLocal
                    }
              ),
              draft.autoFillGapPlacements
            )
          )
        : placementApiPayload([
            ensurePlacementClientKey({
              origin: "MANUAL",
              startAtLocal: draft.startAtLocal,
              endAtLocal: draft.endAtLocal,
              budgetStartAtLocal: normalizedBudgetStartAt ? draft.budgetStartAtLocal || draft.startAtLocal : "",
              budgetEndAtLocal: normalizedBudgetEndAt ? draft.budgetEndAtLocal || draft.endAtLocal : "",
              actualStartAtLocal: draft.actualStartAtLocal,
              actualEndAtLocal: draft.actualEndAtLocal,
              hangarId: draft.hangarId,
              layoutId: draft.layoutId,
              standId: draft.standId
            })
          ]);

      const reason = changeReason.trim();
      const payload = {
        level: draft.level,
        status: draft.status,
        planningKind: draft.planningKind,
        title: draft.title,
        ...(draft.aircraftId ? { aircraftId: draft.aircraftId } : {}),
        ...(!draft.aircraftId && selectedVirtualAircraft ? { virtualAircraft: selectedVirtualAircraft } : {}),
        eventTypeId: draft.eventTypeId,
        startAt,
        endAt,
        budgetStartAt: normalizedBudgetStartAt,
        budgetEndAt: normalizedBudgetEndAt,
        actualStartAt,
        actualEndAt,
        hangarId: draft.hangarId || null,
        workshopId: draft.workshopId || null,
        layoutId: draft.layoutId || null,
        placements: placementsPayload,
        notes: draft.notes?.trim() ? draft.notes : null,
        allowOverlap: draft.allowOverlap,
        autoFillGapPlacements: draft.multiPlacement && draft.autoFillGapPlacements,
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

  const deleteEventM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Нет события");
      return await apiDelete(`/api/events/${draft.id}`);
    },
    onSuccess: () => {
      setEditorOpen(false);
      setEditorCollapsed(false);
      setDraft(null);
      setOriginal(null);
      setCopyFromTitle(null);
      setChangeReason("");
      void qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString()] });
    }
  });

  const reserveM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Сначала сохраните событие");
      if (!draft.layoutId || !draft.standId) throw new Error("Выберите вариант и место");
      const reason = changeReason.trim();
      return await apiPut(`/api/reservations/by-event/${draft.id}`, {
        layoutId: draft.layoutId,
        standId: draft.standId,
        allowOverlap: draft.allowOverlap,
        ...(reason ? { changeReason: reason } : {})
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

  const [pendingDnd, setPendingDnd] = useState<(DndMoveRequest | DndPlaceRequest | DndBatchPlaceRequest) | null>(null);
  const dndCommitRef = useRef<(payload: DndMoveRequest | DndPlaceRequest | DndBatchPlaceRequest) => void>(() => {});
  const [, setDraggingEventId] = useState<string | null>(null);
  const [dndHoverKey, setDndHoverKey] = useState<string | null>(null);
  const [dndHoverBarIds, setDndHoverBarIds] = useState<string[]>([]);
  const [dndHoverIntent, setDndHoverIntent] = useState<"move" | "bump" | null>(null);
  const [dndNotice, setDndNotice] = useState<string | null>(null);
  const [dndBlockedReason, setDndBlockedReason] = useState<string | null>(null);

  // Надёжный DnD на pointer events + предпросмотр по времени.
  const [ptrDrag, setPtrDrag] = useState<null | DndPtrDrag>(null);
  const [ptrPreview, setPtrPreview] = useState<null | DndPtrPreview>(null);
  const [ptrTarget, setPtrTarget] = useState<null | { hangarId: string; rowKey: string; intent: "move" | "bump"; bumpedEventId?: string }>(
    null
  );

  // При смене песочницы/контура сбрасываем DnD, чтобы «Только зона» и фильтры не ломали чужой контекст.
  const prevSandboxIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevSandboxIdRef.current;
    prevSandboxIdRef.current = activeSandboxId;
    if (prev === undefined) return;
    if (prev === activeSandboxId) return;
    setDndEnabled(false);
    setDndZoneOnly(false);
    setDndHangarIds([]);
    setDndLayoutIds([]);
    setSelectedDndEventIds([]);
    setPtrDrag(null);
    setPtrPreview(null);
    setPtrTarget(null);
    setPendingDnd(null);
    setDndNotice(null);
    setDndBlockedReason(null);
    setDraggingEventId(null);
    setDndHoverKey(null);
    setDndHoverBarIds([]);
    setDndHoverIntent(null);
  }, [activeSandboxId]);

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
    ptrDragRef.current = ptrDrag;
  }, [ptrDrag]);

  const dndRangeLabel = useMemo(() => {
    const live = ptrDrag?.started && ptrPreview
      ? { startAt: ptrPreview.envelopeStartAt, endAt: ptrPreview.envelopeEndAt }
      : null;
    if (live) return formatDndRangeLabel(live.startAt, live.endAt, timelineTimeMode);
    if (selectedDndEventIds.length === 0) return null;
    const selected = events.filter((e) => selectedDndEventIds.includes(e.id));
    if (selected.length === 0) return null;
    const startMs = Math.min(...selected.map((e) => dayjs(e.startAt).valueOf()));
    const endMs = Math.max(...selected.map((e) => dayjs(e.endAt).valueOf()));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return formatDndRangeLabel(new Date(startMs).toISOString(), new Date(endMs).toISOString(), timelineTimeMode);
  }, [ptrDrag?.started, ptrPreview, selectedDndEventIds, events, timelineTimeMode]);

  const resolveDropTargetAtPoint = useCallback((clientX: number, clientY: number, fallback?: { hangarId: string; rowKey: string } | null) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const barEl = (el?.closest?.("[data-dnd-bar='1']") as HTMLElement | null) ?? null;
    const dropEl =
      (el?.closest?.("[data-dnd-drop='1']") as HTMLElement | null) ??
      (barEl?.closest?.("[data-dnd-drop='1']") as HTMLElement | null) ??
      null;
    if (dropEl?.dataset?.hangarId && dropEl?.dataset?.rowKey) {
      return { hangarId: dropEl.dataset.hangarId, rowKey: dropEl.dataset.rowKey, intent: "move" as const };
    }

    // Fallback по Y: найти ближайшую drop-строку по вертикали (когда курсор над баром/gap).
    const right = bodyScrollRef.current;
    const rows = hangarStandRowsRef.current ?? [];
    if (right && rows.length > 0) {
      const rect = right.getBoundingClientRect();
      const y = clientY - rect.top + right.scrollTop;
      const rowIdx = Math.max(0, Math.min(rows.length - 1, Math.floor(y / ganttRowHeight)));
      for (let dist = 0; dist < rows.length; dist++) {
        for (const idx of [rowIdx - dist, rowIdx + dist]) {
          if (idx < 0 || idx >= rows.length) continue;
          const row = rows[idx] as any;
          if (row?.kind === "stand" && row.hangarId) {
            return { hangarId: String(row.hangarId), rowKey: String(row.key), intent: "move" as const };
          }
        }
        if (dist === 0) continue;
      }
    }
    if (fallback?.hangarId && fallback.rowKey) {
      return { hangarId: fallback.hangarId, rowKey: fallback.rowKey, intent: "move" as const };
    }
    return null;
  }, [ganttRowHeight]);

  const computePreviewAtClientX = useCallback(
    (clientX: number, d: NonNullable<typeof ptrDrag>): DndPtrPreview | null => {
      const right = bodyScrollRef.current;
      const inner = right?.querySelector?.(".ganttRightInner") as HTMLElement | null;
      const rect = inner?.getBoundingClientRect();
      if (!rect || !right) return null;
      const scrollLeft = right.scrollLeft;
      const px = clientX - rect.left + scrollLeft;
      const msPerPx = (24 * 60 * 60 * 1000) / dayWidth;
      const snapMs = 15 * 60 * 1000;
      const snap = (ms: number) => Math.round(ms / snapMs) * snapMs;

      const newLeftPx = px - d.grabOffsetPx;
      const startMs = snap(from.valueOf() + newLeftPx * msPerPx);
      const endMs = startMs + (d.origEndMs - d.origStartMs);
      const deltaMs = startMs - d.origStartMs;
      const geomParams = { from, dayWidth, canvasWidth, timeMode: timelineTimeMode };
      const leader = dndPreviewBarGeom({ startMs, endMs, ...geomParams });
      const items = d.items.length > 0 ? d.items : [{ eventId: d.eventId, origStartMs: d.origStartMs, origEndMs: d.origEndMs }];
      const bars = items.map((item) =>
        dndPreviewBarGeom({ startMs: item.origStartMs + deltaMs, endMs: item.origEndMs + deltaMs, ...geomParams })
      );
      const envelopeStartMs = Math.min(...items.map((item) => item.origStartMs + deltaMs));
      const envelopeEndMs = Math.max(...items.map((item) => item.origEndMs + deltaMs));
      const envelope = dndPreviewBarGeom({ startMs: envelopeStartMs, endMs: envelopeEndMs, ...geomParams });

      return {
        ...leader,
        envelopeStartAt: envelope.startAt,
        envelopeEndAt: envelope.endAt,
        envelopeX: envelope.x,
        envelopeW: envelope.w,
        bars
      };
    },
    [from, dayWidth, canvasWidth, timelineTimeMode]
  );

  useEffect(() => {
    if (!dndActive) {
      setPtrDrag(null);
      setPtrTarget(null);
      ptrDragRef.current = null;
      if (autoScrollRafRef.current != null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      return;
    }
    if (!ptrDrag) return;

    const EDGE_PX = 48;
    const MAX_SCROLL_SPEED = 28;

    const applyMoveAt = (clientX: number, clientY: number) => {
      const d = ptrDragRef.current;
      if (!d) return;
      lastPointerClientRef.current = { x: clientX, y: clientY };

      const dx = clientX - d.startClientX;
      const dy = clientY - d.startClientY;
      const startedNow = d.started || Math.hypot(dx, dy) >= 3;
      if (startedNow && !d.started) {
        const next = { ...d, started: true };
        ptrDragRef.current = next;
        setPtrDrag(next);
      }
      if (!startedNow && !d.started) return;

      const fallback = d.originHangarId && d.originRowKey ? { hangarId: d.originHangarId, rowKey: d.originRowKey } : null;
      const nextTarget = resolveDropTargetAtPoint(clientX, clientY, fallback) ?? ptrTargetRef.current;
      if (nextTarget) {
        ptrTargetRef.current = nextTarget;
        setPtrTarget(nextTarget);
        setDndHoverKey(nextTarget.rowKey);
        setDndHoverIntent("move");
        setDndHoverBarIds([]);
      }

      const pv = computePreviewAtClientX(clientX, d);
      if (pv) {
        ptrPreviewRef.current = pv;
        setPtrPreview(pv);
        if (dndBlockedReason) setDndBlockedReason(null);
      }
    };

    const stopAutoScroll = () => {
      if (autoScrollRafRef.current != null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };

    const tickAutoScroll = () => {
      autoScrollRafRef.current = null;
      const right = bodyScrollRef.current;
      const ptr = lastPointerClientRef.current;
      const d = ptrDragRef.current;
      if (!right || !ptr || !d?.started) return;

      const rect = right.getBoundingClientRect();
      let delta = 0;
      if (ptr.x < rect.left + EDGE_PX) {
        const t = (rect.left + EDGE_PX - ptr.x) / EDGE_PX;
        delta = -Math.ceil(MAX_SCROLL_SPEED * Math.min(1, Math.max(0.15, t)));
      } else if (ptr.x > rect.right - EDGE_PX) {
        const t = (ptr.x - (rect.right - EDGE_PX)) / EDGE_PX;
        delta = Math.ceil(MAX_SCROLL_SPEED * Math.min(1, Math.max(0.15, t)));
      }

      if (delta !== 0) {
        const prev = right.scrollLeft;
        const next = Math.max(0, Math.min(right.scrollWidth - right.clientWidth, prev + delta));
        if (next !== prev) {
          right.scrollLeft = next;
          syncGanttScrollLeft(next, "body");
          applyMoveAt(ptr.x, ptr.y);
        }
        autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
      }
    };

    const onMove = (e: PointerEvent) => {
      applyMoveAt(e.clientX, e.clientY);
      const right = bodyScrollRef.current;
      if (!right || !ptrDragRef.current?.started) {
        stopAutoScroll();
        return;
      }
      const rect = right.getBoundingClientRect();
      const nearEdge = e.clientX < rect.left + EDGE_PX || e.clientX > rect.right - EDGE_PX;
      if (nearEdge && autoScrollRafRef.current == null) {
        autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
      } else if (!nearEdge) {
        stopAutoScroll();
      }
    };

    const onUp = () => {
      stopAutoScroll();
      const d = ptrDragRef.current;
      const t = ptrTargetRef.current;
      const preview = ptrPreviewRef.current;
      ptrDragRef.current = null;
      ptrPreviewRef.current = null;
      ptrTargetRef.current = null;
      lastPointerClientRef.current = null;
      setPtrDrag(null);
      setDraggingEventId(null);
      setPtrPreview(null);
      setPtrTarget(null);
      setDndBlockedReason(null);

      if (!d?.started) return;
      if (!t) return;
      if (!preview) return;

      const eventIds = d.eventIds.length > 0 ? d.eventIds : [d.eventId];
      const dndPayload =
        eventIds.length > 1
          ? {
              eventIds,
              hangarId: t.hangarId,
              startAt: preview.startAt,
              endAt: preview.endAt
            }
          : ({
              eventId: d.eventId,
              hangarId: t.hangarId,
              bumpOnConflict: false,
              startAt: preview.startAt,
              endAt: preview.endAt
            } as any);
      setPendingDnd(dndPayload);
      setPendingSave("dndMove");
      setDndNotice(null);
      setChangeReason("");
      if (activeSandbox) {
        dndCommitRef.current(dndPayload);
      } else {
        setConfirmOpen(true);
      }
    };

    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });

    return () => {
      stopAutoScroll();
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", onMove as any);
      window.removeEventListener("pointerup", onUp as any);
      window.removeEventListener("pointercancel", onUp as any);
    };
  }, [
    dndActive,
    ptrDrag,
    resolveDropTargetAtPoint,
    computePreviewAtClientX,
    syncGanttScrollLeft,
    dndBlockedReason,
    findDndLayoutLock,
    activeSandbox
  ]);

  const addTowM = useMutation({
    mutationFn: async (override: { kind: "add"; startAt: string; endAt: string } | null = null) => {
      if (!draft?.id) throw new Error("Сначала сохраните событие");
      const tow = override ?? (pendingTow?.kind === "add" ? pendingTow : null);
      if (!tow) throw new Error("Нет данных буксировки");
      const reason = changeReason.trim();
      return await apiPost(`/api/events/${draft.id}/tows`, {
        startAt: tow.startAt,
        endAt: tow.endAt,
        ...(reason ? { changeReason: reason } : {})
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
    mutationFn: async (override: { kind: "del"; towId: string } | null = null) => {
      if (!draft?.id) throw new Error("Нет события");
      const tow = override ?? (pendingTow?.kind === "del" ? pendingTow : null);
      if (!tow) throw new Error("Не выбрана буксировка");
      const cr = changeReason.trim();
      const q = cr ? `?changeReason=${encodeURIComponent(cr)}` : "";
      return await apiDelete(`/api/events/${draft.id}/tows/${tow.towId}${q}`);
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
    mutationFn: async (
      override: (DndMoveRequest | DndPlaceRequest | DndBatchPlaceRequest) | null = null
    ) => {
      const data = override ?? pendingDnd;
      if (!data) throw new Error("Нет данных переноса");
      const reason = changeReason.trim();
      const reasonPayload = reason ? { changeReason: reason } : {};
      const batchIds = (data as DndBatchPlaceRequest).eventIds;
      if (Array.isArray(batchIds) && batchIds.length > 1) {
        return await apiPost<{
          ok: boolean;
          moved: number;
          placements?: Array<{ layoutName?: string; standCode?: string }>;
          errors?: Array<{ eventId: string; message: string }>;
        }>("/api/reservations/dnd-place-hangar/batch", {
          eventIds: batchIds,
          hangarId: (data as DndBatchPlaceRequest).hangarId,
          startAt: (data as DndBatchPlaceRequest).startAt,
          endAt: (data as DndBatchPlaceRequest).endAt,
          ...reasonPayload
        });
      }
      const hasTime = (data as any).startAt && (data as any).endAt;
      const path = hasTime ? "/api/reservations/dnd-place-hangar" : "/api/reservations/dnd-move";
      return await apiPost<{ ok: boolean; bumpedEventIds: string[]; placement?: { layoutName?: string; standCode?: string } }>(path, {
        ...data,
        bumpOnConflict: (data as any).bumpOnConflict,
        ...reasonPayload
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
      setSelectedDndEventIds([]);
      const moved = res?.moved ?? 1;
      const errList = (res?.errors ?? []) as Array<{ eventId?: string; message?: string }>;
      const errCount = errList.length;
      const bumped = (res?.bumpedEventIds ?? []).length;
      const autoPlace = res?.placement
        ? ` Схема: ${res.placement.layoutName ?? "—"}, место: ${res.placement.standCode ?? "—"}.`
        : res?.placements?.[0]
          ? ` Схема: ${res.placements[0].layoutName ?? "—"}, место: ${res.placements[0].standCode ?? "—"}.`
          : "";
      const errDetails =
        errCount > 0
          ? ` ${errList
              .map((e) => String(e?.message ?? "").trim())
              .filter(Boolean)
              .slice(0, 5)
              .join(" · ")}${errCount > 5 ? ` …ещё ${errCount - 5}` : ""}`
          : "";
      const batchMsg =
        moved > 1 || errCount > 0
          ? `Перенесено событий: ${moved}${errCount ? `, ошибок: ${errCount}.` : "."}${autoPlace}${errDetails}`
          : bumped
            ? `Перенос выполнен. Вытеснено событий: ${bumped}.${autoPlace}`
            : `Перенос выполнен.${autoPlace}`;
      setDndNotice(batchMsg);
      setChangeReason("");
      void qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString()] });
      if (draft?.id) void qc.invalidateQueries({ queryKey: ["event-history", draft.id] });
      for (const id of res?.bumpedEventIds ?? []) {
        void qc.invalidateQueries({ queryKey: ["event-history", String(id)] });
      }
    }
  });
  dndCommitRef.current = (payload) => {
    dndMoveM.mutate(payload);
  };

  type BulkStatusBatchResult = {
    ok: true;
    requested: EventStatusCode;
    updated: Array<{ eventId: string; from: EventStatusCode; to: EventStatusCode }>;
    skipped: Array<{ eventId: string; reason: "not_found" | "unchanged" | "terminal" | "deleted" }>;
    failed: Array<{ eventId: string; message: string }>;
  };

  const bulkStatusM = useMutation({
    mutationFn: async () => {
      const ids = selectedTableEventIds;
      if (ids.length === 0) throw new Error("Не выбраны события");
      if (ids.length > BULK_STATUS_MAX) throw new Error(`За один раз можно изменить не больше ${BULK_STATUS_MAX} событий`);
      const reason = changeReason.trim();
      if (!activeSandbox && !reason) throw new Error("Укажите причину изменения");
      return apiPost<BulkStatusBatchResult>("/api/events/status/batch", {
        eventIds: ids,
        status: bulkStatusTarget,
        ...(reason ? { changeReason: reason } : {})
      });
    },
    onSuccess: (res) => {
      const skippedTerminal = res.skipped.filter((s) => s.reason === "terminal" || s.reason === "deleted").length;
      const skippedUnchanged = res.skipped.filter((s) => s.reason === "unchanged").length;
      const reconciled = res.updated.filter((row) => row.to !== res.requested).length;
      const errDetails =
        res.failed.length > 0
          ? ` ${res.failed
              .map((e) => String(e.message ?? "").trim())
              .filter(Boolean)
              .slice(0, 5)
              .join(" · ")}${res.failed.length > 5 ? ` …ещё ${res.failed.length - 5}` : ""}`
          : "";
      const parts = [`Обновлено: ${res.updated.length}`];
      if (skippedTerminal) parts.push(`пропущено завершённых/отменённых: ${skippedTerminal}`);
      if (skippedUnchanged) parts.push(`без изменений: ${skippedUnchanged}`);
      if (reconciled) parts.push(`из них с автостатусом: ${reconciled}`);
      if (res.failed.length) parts.push(`ошибок: ${res.failed.length}.${errDetails}`);
      setBulkStatusNotice(parts.join(", ") + ".");
      setSelectedTableEventIds([]);
      setConfirmOpen(false);
      setPendingSave(null);
      setChangeReason("");
      void qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString()] });
      void qc.invalidateQueries({ queryKey: ["analytics", "primary-table", "gantt-rows"] });
    },
    onError: (e: any) => {
      setBulkStatusNotice(String(e?.message ?? e));
    }
  });

  const requestBulkStatus = () => {
    if (!canEditEventsEffective || selectedTableEventIds.length === 0) return;
    if (selectedTableEventIds.length > BULK_STATUS_MAX) {
      setBulkStatusNotice(`За один раз можно изменить не больше ${BULK_STATUS_MAX} событий.`);
      return;
    }
    setBulkStatusNotice(null);
    bulkStatusM.reset();
    setPendingSave("bulkStatus");
    setChangeReason("");
    if (activeSandbox) {
      bulkStatusM.mutate();
      return;
    }
    setConfirmOpen(true);
  };

  useEffect(() => {
    if (editorFeedbackEpoch === 0) return;
    saveEventM.reset();
    reserveM.reset();
    unreserveM.reset();
    deleteEventM.reset();
    addTowM.reset();
    delTowM.reset();
  }, [editorFeedbackEpoch]);

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
  // При узкой левой оси ангар/схема показываются кодами вместо наименований.
  const hangarStandRows = useMemo(() => {
    if (groupMode !== "HANGAR_STAND") return [];

    const getHangarId = (e: EventRow) => eventPrimaryHangarId(e);
    const getHangarName = (e: EventRow) => (e.hangar as any)?.name ?? "Ангар";
    const getStandId = (e: EventRow) => (e.reservation?.stand as any)?.id ?? "";
    const getStandCode = (e: EventRow) => (e.reservation?.stand as any)?.code ?? "";
    const hangarLabelFor = (hangarId: string | undefined, fallbackName: string) => {
      const meta = hangarId ? hangarMetaById.get(hangarId) : undefined;
      return hangarAxisLabel({ name: meta?.name ?? fallbackName, code: meta?.code }, preferAxisCodes);
    };
    const hangarTitleFor = (hangarId: string | undefined, fallbackName: string) => {
      const meta = hangarId ? hangarMetaById.get(hangarId) : undefined;
      return hangarAxisLabel({ name: meta?.name ?? fallbackName, code: meta?.code }, false);
    };

    const visible = eventsForGantt
      .filter((e) => eventMatchesGanttFilters(e, ganttFilters))
      .flatMap(eventSegmentsForHangarRows);
    const activeVisible = visible.filter((e) => e.status !== "CANCELLED");
    const cancelledVisible = visible.filter((e) => e.status === "CANCELLED");

    const unassigned = activeVisible.filter((e) => !getHangarId(e) && !e.reservation?.stand);

    const noStandByHangar = new Map<string, { hangarId: string; hangarName: string; events: EventRow[] }>();
    const byStandId = new Map<
      string,
      {
        standId: string;
        layoutId: string;
        hangarId: string;
        hangarName: string;
        standCode: string;
        label: string;
        title: string;
        subLabel?: string;
        events: EventRow[];
      }
    >();

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
        const hangarName = meta?.hangarName ?? hname;
        const standCode = meta?.code ?? scode;
        const label = formatHangarStandAxisLabel(hangarLabelFor(hangarId, hangarName), standCode);
        const title = formatHangarStandAxisLabel(hangarTitleFor(hangarId, hangarName), standCode);
        const subLabel = layoutAxisLabel(
          {
            name: meta?.layoutName ?? String((e.layout as any)?.name ?? ""),
            code: meta?.layoutCode ?? String((e.layout as any)?.code ?? "")
          },
          preferAxisCodes
        );
        const rec = byStandId.get(sid) ?? {
          standId: sid,
          layoutId,
          hangarId,
          hangarName,
          standCode,
          label,
          title,
          subLabel,
          events: [] as EventRow[]
        };
        rec.events.push(e);
        byStandId.set(sid, rec);
      }
    }

    type Row = {
      key: string;
      label: string;
      title?: string;
      subLabel?: string;
      kind: "unassigned" | "hangarNoStand" | "hangar" | "stand" | "cancelled";
      hangarId?: string;
      layoutId?: string;
      standId?: string;
      events: EventRow[];
    };

    const rows: Row[] = [];

    if (unassigned.length > 0) {
      rows.push({
        key: "unassigned",
        label: "Без ангара/места",
        title: "Без ангара/места",
        kind: "unassigned",
        events: unassigned
      });
    }

    // Стабильная сортировка: по имени ангара, затем по коду места
    const hangarList = Array.from(noStandByHangar.entries())
      .map(([hid, v]) => ({ hid, hangarName: v.hangarName, events: v.events }))
      .sort((a, b) => a.hangarName.localeCompare(b.hangarName, "ru"));

    for (const h of hangarList) {
      const label = `${hangarLabelFor(h.hid, h.hangarName)} / Без места`;
      const title = `${hangarTitleFor(h.hid, h.hangarName)} / Без места`;
      rows.push({
        key: `hangar:${h.hid}:no-stand`,
        label,
        title,
        kind: "hangarNoStand",
        hangarId: h.hid,
        events: h.events
      });
    }

    // Добавим пустые стоянки как drop-зоны только в режиме DnD
    if (dndActive) {
      for (const s of dndStandsQ.data ?? []) {
        if (dndHangarScopeIds.length > 0 && !dndHangarScopeIds.includes(s.hangarId)) continue;
        if (dndLayoutIds.length > 0 && !dndLayoutIds.includes(s.layoutId)) continue;
        if (!byStandId.has(s.id)) {
          byStandId.set(s.id, {
            standId: s.id,
            layoutId: s.layoutId,
            hangarId: s.hangarId,
            hangarName: s.hangarName,
            standCode: s.code,
            label: formatHangarStandAxisLabel(hangarLabelFor(s.hangarId, s.hangarName), s.code),
            title: formatHangarStandAxisLabel(hangarTitleFor(s.hangarId, s.hangarName), s.code),
            subLabel: layoutAxisLabel({ name: s.layoutName, code: s.layoutCode }, preferAxisCodes),
            events: []
          });
        }
      }
    }

    // Режим «только зона DnD»: скрываем строки вне выбранных ангаров/схем
    if (dndActive && dndZoneOnly) {
      for (const [sid, rec] of Array.from(byStandId.entries())) {
        if (dndHangarScopeIds.length > 0 && !dndHangarScopeIds.includes(rec.hangarId)) {
          byStandId.delete(sid);
          continue;
        }
        if (dndLayoutIds.length > 0 && rec.layoutId && !dndLayoutIds.includes(rec.layoutId)) {
          byStandId.delete(sid);
        }
      }
    }

    const standList = Array.from(byStandId.values()).sort((a, b) => {
      const byHangar = a.hangarName.localeCompare(b.hangarName, "ru");
      if (byHangar) return byHangar;
      return compactStandLabel(a.standCode).localeCompare(compactStandLabel(b.standCode), "ru");
    });
    for (const s of standList) {
      rows.push({
        key: `stand:${s.hangarId}|${s.standId}`,
        label: s.label,
        title: s.title,
        subLabel: s.subLabel,
        kind: "stand",
        hangarId: s.hangarId,
        layoutId: s.layoutId,
        standId: s.standId,
        events: s.events
      });
    }

    // Раскладка нахлёстов по тому же интервалу, что рисуется на шкале
    // (в CURRENT с фактом иначе бары «наезжают» при непересекающемся оперативе).
    const packRange = (ev: EventRow) =>
      dndActive
        ? { startMs: Date.parse(ev.startAt), endMs: Date.parse(ev.endAt) }
        : eventPackRangeMs(ev, ganttDisplayMode);

    type LaneRow = {
      key: string;
      label: string;
      title?: string;
      subLabel?: string;
      kind: Row["kind"];
      hangarId?: string;
      layoutId?: string;
      standId?: string;
      events: PlacedEvent[];
    };

    const pushLanes = (source: Row[], target: LaneRow[]) => {
      for (const r of source) {
        if (r.events.length === 0) {
          target.push({
            key: `${r.key}:lane:0`,
            label: r.label,
            title: r.title,
            subLabel: r.subLabel,
            kind: r.kind,
            hangarId: r.hangarId,
            layoutId: r.layoutId,
            standId: r.standId,
            events: []
          });
          continue;
        }
        const lanes = packOverlapsIntoLanes(r.events, packRange);
        for (let i = 0; i < lanes.length; i++) {
          const baseTitle = r.title ?? r.label;
          target.push({
            key: `${r.key}:lane:${i}`,
            label: overlapLaneAxisLabel(r.label, i),
            title: overlapLaneAxisTitle(baseTitle, i),
            subLabel: r.subLabel,
            kind: r.kind,
            hangarId: r.hangarId,
            layoutId: r.layoutId,
            standId: r.standId,
            events: lanes[i]!
          });
        }
      }
    };

    // В режиме зоны DnD не показываем unassigned / no-stand / cancelled — только рабочие drop-строки
    if (dndActive && dndZoneOnly) {
      const laneRows: LaneRow[] = [];
      pushLanes(
        rows.filter((r) => r.kind === "stand"),
        laneRows
      );
      return laneRows;
    }

    const laneRows: LaneRow[] = [];
    pushLanes(rows, laneRows);

    if (cancelledVisible.length > 0) {
      const cancelledLanes = packOverlapsIntoLanes(cancelledVisible, packRange);
      for (let i = 0; i < cancelledLanes.length; i++) {
        laneRows.push({
          key: `cancelled:lane:${i}`,
          label: overlapLaneAxisLabel("Отменено", i),
          title: overlapLaneAxisTitle("Отменено", i),
          kind: "cancelled",
          events: cancelledLanes[i]!
        });
      }
    }

    return laneRows;
  }, [
    groupMode,
    ganttFilters,
    eventsForGantt,
    dndActive,
    dndStandsQ.data,
    dndStandById,
    dndHangarScopeIds,
    dndLayoutIds,
    dndZoneOnly,
    hangarMetaById,
    preferAxisCodes,
    ganttDisplayMode
  ]);

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
    const links: Array<{
      key: string;
      eventId: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      d: string;
    }> = [];
    const rowH = ganttRowHeight;
    for (const ev of events) {
      const placements = ev.placements ?? [];
      if (placements.length < 2) continue;
      const sorted = sortEventPlacements(placements);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        const ak = placementSegmentKey(ev.id, a, i);
        const bk = placementSegmentKey(ev.id, b, i + 1);
        const ar = bySegmentKey.get(ak);
        const br = bySegmentKey.get(bk);
        if (!ar || !br) continue;
        const ag = calcBarXW({ startAt: a.startAt, endAt: a.endAt, from, dayWidth, canvasWidth, timeMode: timelineTimeMode });
        const bg = calcBarXW({ startAt: b.startAt, endAt: b.endAt, from, dayWidth, canvasWidth, timeMode: timelineTimeMode });
        if (!ag || !bg) continue;
        const x1 = ag.x + ag.w;
        const y1 = ar.rowIdx * rowH + rowH / 2;
        const x2 = bg.x;
        const y2 = br.rowIdx * rowH + rowH / 2;
        links.push({
          key: `${ak}->${bk}`,
          eventId: ev.id,
          x1,
          y1,
          x2,
          y2,
          d: placementLinkPath(x1, y1, x2, y2),
          color: placementLinkColor(aircraftTypeMarkColor(ev, aircraftPaletteMap))
        });
      }
    }
    return links;
  }, [groupMode, hangarStandRows, events, from, dayWidth, canvasWidth, aircraftPaletteMap, ganttRowHeight, timelineTimeMode]);

  /** Выбранное событие для связок: открытая карточка с id. */
  const selectedPlacementEventId = editorOpen && draft?.id ? draft.id : null;

  const visiblePlacementLinks = useMemo(() => {
    if (showAllPlacementLinks) return placementLinks;
    if (!selectedPlacementEventId) return [];
    return placementLinks.filter((l) => l.eventId === selectedPlacementEventId);
  }, [placementLinks, selectedPlacementEventId, showAllPlacementLinks]);

  /** Idle-маркеры разрыва: next/prev label по segmentKey. */
  const placementBridgeBySegmentKey = useMemo(() => {
    const m = new Map<string, { nextLabel?: string; prevLabel?: string }>();
    if (groupMode !== "HANGAR_STAND") return m;
    for (const ev of events) {
      const placements = ev.placements ?? [];
      if (placements.length < 2) continue;
      const sorted = sortEventPlacements(placements);
      for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i]!;
        const key = placementSegmentKey(ev.id, cur, i);
        const prev = i > 0 ? sorted[i - 1] : null;
        const next = i < sorted.length - 1 ? sorted[i + 1] : null;
        m.set(key, {
          prevLabel: prev ? formatPlacementBridgeLabel(prev, hangarMetaById) : undefined,
          nextLabel: next ? formatPlacementBridgeLabel(next, hangarMetaById) : undefined
        });
      }
    }
    return m;
  }, [groupMode, events, hangarMetaById]);

  const exportEvents = useMemo(() => {
    return eventsForGantt.filter((e) => eventMatchesGanttFilters(e, ganttFilters));
  }, [eventsForGantt, ganttFilters]);

  useEffect(() => {
    const visible = new Set(exportEvents.map((e) => e.id));
    setSelectedTableEventIds((ids) => {
      const next = ids.filter((id) => visible.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [exportEvents]);

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

  const hasEdgeTimeLabelCollision = useCallback(
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
      if (!canShowBarEdgeTimeLabel(minorScale)) return null;
      const labelLeft = seg.x + seg.w + EXIT_TIME_LABEL_GAP;
      const labelRight = labelLeft + EXIT_TIME_LABEL_WIDTH;
      if (labelRight > canvasWidth - 2) return null;
      if (hasEdgeTimeLabelCollision(rowEvents, ev, targetStartAt, targetEndAt, labelLeft, labelRight)) return null;
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
    [canvasWidth, ganttDisplayMode, hasEdgeTimeLabelCollision, minorScale, timelineTimeMode]
  );

  const renderEntryTimeLabel = useCallback(
    (rowEvents: PlacedEvent[], ev: EventRow, seg: { x: number; w: number }, targetStartAt: string, targetEndAt: string, targetIsFact: boolean) => {
      if (!canShowBarEdgeTimeLabel(minorScale)) return null;
      const labelRight = seg.x - ENTRY_TIME_LABEL_GAP;
      const labelLeft = labelRight - ENTRY_TIME_LABEL_WIDTH;
      if (labelLeft < 2) return null;
      if (hasEdgeTimeLabelCollision(rowEvents, ev, targetStartAt, targetEndAt, labelLeft, labelRight)) return null;
      const top = ganttDisplayMode === "PLAN_FACT" ? (targetIsFact ? 34 : 8) : 14;
      return (
        <span
          className={`entryTimeLabel${targetIsFact ? " entryTimeLabelFact" : ""}`}
          style={{ left: labelLeft, top, width: ENTRY_TIME_LABEL_WIDTH }}
          title={entryTimeTitle(ev, timelineTimeMode)}
        >
          {entryTimeLabel(ev, timelineTimeMode)}
        </span>
      );
    },
    [ganttDisplayMode, hasEdgeTimeLabelCollision, minorScale, timelineTimeMode]
  );

  const cancelledAircraftRows = useMemo(() => {
    if (groupMode !== "AIRCRAFT") return [];
    const cancelled = exportEvents.filter((e) => e.status === "CANCELLED");
    return packOverlapsIntoLanes(cancelled, (ev) => eventPackRangeMs(ev, ganttDisplayMode)).map((events, i) => ({
      key: `cancelled-aircraft:lane:${i}`,
      label: overlapLaneAxisLabel("Отменено", i),
      title: overlapLaneAxisTitle("Отменено", i),
      subLabel: "Не участвует в рабочем размещении",
      events
    }));
  }, [groupMode, exportEvents, ganttDisplayMode]);

  const aircraftRows = useMemo(
    () => [
      ...visibleEvents.map((ev) => {
        const segments = eventSegmentsForHangarRows(ev);
        const fullSub = aircraftAxisSubLabel(ev, false, hangarMetaById) || formatRowLabel(ev) || ev.title;
        const axisSub = aircraftAxisSubLabel(ev, preferAxisCodes, hangarMetaById) || formatRowLabel(ev) || ev.title;
        return {
          key: ev.id,
          label: eventAircraftLabel(ev),
          subLabel: axisSub,
          title: preferAxisCodes ? `${eventAircraftLabel(ev)} • ${fullSub}` : undefined,
          events: segments.map((segment) => ({ ev: segment } as PlacedEvent))
        };
      }),
      ...cancelledAircraftRows
    ],
    [visibleEvents, cancelledAircraftRows, hangarMetaById, preferAxisCodes]
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
          "Статус": statusCatalogLabel(ev.status, statusCatalog),
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
              const place = p.origin === "AUTO_GAP" ? "без ангара (авто)" : p.stand?.code ?? p.layout?.name ?? p.hangar?.name ?? "без места";
              return `${idx + 1}. ${formatExportDate(p.startAt)} – ${formatExportDate(p.endAt)} · ${place}`;
            })
            .join("; "),
          "Буксировок": towSegments.length,
          "Интервалы буксировок": towSegments
            .map((t) => `${formatExportDate(t.startAt)} – ${formatExportDate(t.endAt)}`)
            .join("; "),
          "Примечание": String(ev.notes ?? ""),
          "ID события": ev.id
        };
      });
  }, [exportEvents, aircraftTypeById, operatorNameById, from, to]);

  const exportBaseName = `gantt-${rangeFromApplied}-${rangeToApplied}`;
  const reportMeta = [
    `Период: ${timelineDate(rangeFromApplied, timelineTimeMode).format("DD.MM.YYYY")} – ${timelineDate(rangeToApplied, timelineTimeMode).format("DD.MM.YYYY")}`,
    `Шкала: ${ZOOM_LABEL[majorScale]} / ${ZOOM_LABEL[minorScale]}${fitWidth ? " (по ширине)" : ""}`,
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
            const stripe = ganttStatusStripeColor(ev.status, statusCatalog);
            const label = compactBarLabel(ev);
            const actualSvg =
              ganttDisplayMode === "PLAN_FACT" && ev.actualStartAt && ev.actualEndAt
                ? (() => {
                    const ax = clamp(xFor(ev.actualStartAt), labelW, labelW + chartW);
                    const ar = clamp(xFor(ev.actualEndAt), labelW, labelW + chartW);
                    const aw = Math.max(2, ar - ax);
                    const tone = factTone(ev);
                    const factFill = tone === "bad" ? "#dc2626" : tone === "warn" ? "#f97316" : "#16a34a";
                    const tatLabel = factTatLabel(ev);
                    const overrunText =
                      tatLabel && aw > 72
                        ? `<text x="${(ax + 4).toFixed(1)}" y="${y + 44}" font-size="8" font-weight="700" fill="#ffffff">${htmlEscape(tatLabel)}</text>`
                        : "";
                    return `<rect x="${ax.toFixed(1)}" y="${y + 29}" width="${aw.toFixed(1)}" height="22" rx="8" fill="${factFill}" opacity="0.95" />${overrunText}`;
                  })()
                : "";
            const barY = ganttDisplayMode === "PLAN_FACT" ? y + 5 : y + 6;
            const barH = ganttDisplayMode === "PLAN_FACT" ? 22 : 18;
            const stripeSvg = stripe
              ? `<rect x="${x.toFixed(1)}" y="${(barY + barH - 3).toFixed(1)}" width="${w.toFixed(1)}" height="3" fill="${htmlEscape(stripe)}" />`
              : "";
            return `<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" rx="5" fill="${htmlEscape(fill)}" stroke="${stroke}" stroke-width="1" opacity="${ev.status === "CANCELLED" ? "0.55" : "0.88"}" />
              ${stripeSvg}
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

  const periodChipLabel = `${dayjs.utc(rangeFromApplied).format("DD.MM.YY")} – ${dayjs.utc(rangeToApplied).format("DD.MM.YY")}`;

  const activeFilterSummaryParts = useMemo(() => {
    const pick = (title: string, ids: string[], options: Array<{ id: string; label: string }>, maxNames = 2) => {
      if (!ids.length) return null;
      const byId = new Map(options.map((o) => [o.id, o.label] as const));
      const names = ids.map((id) => byId.get(id) ?? id);
      const text =
        names.length <= maxNames ? names.join(", ") : `${names.slice(0, maxNames).join(", ")} +${names.length - maxNames}`;
      return `${title}: ${text}`;
    };
    return [
      pick("Ангар", selectedHangarIds, smartFilterOptions.hangars),
      pick("Оператор", filterOperatorIds, smartFilterOptions.operators),
      pick("Тип ВС", filterAircraftTypeIds, smartFilterOptions.aircraftTypes),
      pick("Борт", filterAircraftIds, smartFilterOptions.aircraft),
      pick("Тип события", filterEventTypeIds, smartFilterOptions.eventTypes),
      pick("Цех", filterWorkshopIds, smartFilterOptions.workshops),
      pick("Статус", filterStatusIds, smartFilterOptions.statuses),
      filterPlanningKind === "ALL"
        ? null
        : `Планирование: ${filterPlanningKind === "PLANNED" ? "плановые" : "внеплановые"}`,
      showExternalMroOnGantt ? null : "без внешних MRO"
    ].filter((x): x is string => Boolean(x));
  }, [
    selectedHangarIds,
    filterOperatorIds,
    filterAircraftTypeIds,
    filterAircraftIds,
    filterEventTypeIds,
    filterWorkshopIds,
    filterStatusIds,
    filterPlanningKind,
    smartFilterOptions,
    showExternalMroOnGantt
  ]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (selectedHangarIds.length) n += 1;
    if (filterOperatorIds.length) n += 1;
    if (filterAircraftTypeIds.length) n += 1;
    if (filterAircraftIds.length) n += 1;
    if (filterEventTypeIds.length) n += 1;
    if (filterWorkshopIds.length) n += 1;
    if (filterStatusIds.length) n += 1;
    if (filterPlanningKind !== "ALL") n += 1;
    return n;
  }, [
    selectedHangarIds,
    filterOperatorIds,
    filterAircraftTypeIds,
    filterAircraftIds,
    filterEventTypeIds,
    filterWorkshopIds,
    filterStatusIds,
    filterPlanningKind
  ]);

  const ganttHeaderMetaParts = useMemo(() => {
    const parts = [
      `${dayjs.utc(rangeFromApplied).format("DD.MM.YYYY")} – ${dayjs.utc(rangeToApplied).format("DD.MM.YYYY")}`,
      `${ZOOM_LABEL[majorScale]} / ${ZOOM_LABEL[minorScale]}${fitWidth ? " · по ширине" : ""}`,
      ganttDisplayMode === "CURRENT" ? "Текущий график" : "План-факт",
      panelView === "TABLE" ? "Таблица" : groupMode === "AIRCRAFT" ? "Борт / событие" : "Ангар / место",
      ...activeFilterSummaryParts
    ];
    return parts;
  }, [
    rangeFromApplied,
    rangeToApplied,
    majorScale,
    minorScale,
    fitWidth,
    ganttDisplayMode,
    panelView,
    groupMode,
    activeFilterSummaryParts
  ]);

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

  const setDraftPlacement = (clientKey: string, patch: Partial<PlacementDraft>) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        placements: d.placements.map((p) =>
          p.clientKey === clientKey && p.origin !== "AUTO_GAP" ? { ...p, ...patch } : p
        )
      };
    });
  };

  const setMultiPlacementMode = (enabled: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      if (enabled) {
        const first = d.placements.find((placement) => placement.origin !== "AUTO_GAP") ?? {
          origin: "MANUAL" as const,
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
          placements: [
            ensurePlacementClientKey({
              ...first,
              origin: "MANUAL",
              startAtLocal: d.startAtLocal,
              endAtLocal: d.endAtLocal,
              budgetStartAtLocal: d.budgetStartAtLocal,
              budgetEndAtLocal: d.budgetEndAtLocal,
              actualStartAtLocal: d.actualStartAtLocal,
              actualEndAtLocal: d.actualEndAtLocal
            })
          ]
        };
      }
      const first = d.placements.find((placement) => placement.origin !== "AUTO_GAP");
      return {
        ...d,
        multiPlacement: false,
        hangarId: first?.hangarId ?? d.hangarId,
        layoutId: first?.layoutId ?? d.layoutId,
        standId: first?.standId ?? d.standId,
        placements: [
          ensurePlacementClientKey({
            origin: "MANUAL",
            startAtLocal: d.startAtLocal,
            endAtLocal: d.endAtLocal,
            budgetStartAtLocal: first?.budgetStartAtLocal ?? d.budgetStartAtLocal,
            budgetEndAtLocal: first?.budgetEndAtLocal ?? d.budgetEndAtLocal,
            actualStartAtLocal: first?.actualStartAtLocal ?? d.actualStartAtLocal,
            actualEndAtLocal: first?.actualEndAtLocal ?? d.actualEndAtLocal,
            hangarId: first?.hangarId ?? d.hangarId,
            layoutId: first?.layoutId ?? d.layoutId,
            standId: first?.standId ?? d.standId
          })
        ]
      };
    });
  };

  const addPlacementDraft = () => {
    setDraft((d) => {
      if (!d) return d;
      const manuals = manualPlacements(d.placements);
      const prev = manuals[manuals.length - 1];
      const startAtLocal = prev?.endAtLocal || d.startAtLocal;
      const endAtLocal =
        isValidDateTimeLocal(startAtLocal) && isValidDateTimeLocal(d.endAtLocal) && dayjs(d.endAtLocal).isAfter(dayjs(startAtLocal))
          ? d.endAtLocal
          : "";
      return {
        ...d,
        multiPlacement: true,
        placements: [
          ...manuals,
          ensurePlacementClientKey({
            origin: "MANUAL",
            startAtLocal,
            endAtLocal,
            budgetStartAtLocal: "",
            budgetEndAtLocal: "",
            actualStartAtLocal: "",
            actualEndAtLocal: "",
            hangarId: "",
            layoutId: "",
            standId: ""
          })
        ]
      };
    });
  };

  const removePlacementDraft = (clientKey: string) => {
    setDraft((d) => {
      if (!d) return d;
      const next = d.placements.filter((placement) => placement.clientKey !== clientKey && placement.origin !== "AUTO_GAP");
      const manuals = manualPlacements(next);
      return {
        ...d,
        placements: manuals.length ? manuals : d.placements
      };
    });
  };

  const setAutoFillGapPlacements = (autoFillGapPlacements: boolean) => {
    setDraft((d) => (d ? { ...d, autoFillGapPlacements, placements: manualPlacements(d.placements) } : d));
  };

  const alignPlacementsToEvent = () => {
    setDraft((d) => {
      if (!d) return d;
      const manuals = manualPlacements(d.placements);
      if (!manuals.length) return d;
      return {
        ...d,
        placements: manuals.map((placement, idx) => {
          const patch: Partial<PlacementDraft> = {};
          if (idx === 0) patch.startAtLocal = d.startAtLocal;
          if (idx === manuals.length - 1) patch.endAtLocal = d.endAtLocal;
          return { ...placement, ...patch };
        })
      };
    });
  };

  return (
    <div className="ganttPage">
      <div className="card ganttPanel" ref={ganttFiltersStickyRef}>
        <div className="ganttPanelHeader">
          <div className="ganttPanelTitle">
            <strong>План</strong>
            <span className="muted ganttPanelPeriod">
              {ganttHeaderMetaParts.map((part, idx) => (
                <Fragment key={`${idx}-${part}`}>
                  {idx > 0 ? <span className="ganttPanelDot" aria-hidden="true">·</span> : null}
                  <span>{part}</span>
                </Fragment>
              ))}
            </span>
          </div>
          <div className="ganttPanelActions">
            <button
              type="button"
              className={`btn ganttIconBtn ganttToolbarCollapseBtn${ganttToolbarOpen ? "" : " ganttToolbarCollapseBtnClosed"}`}
              aria-pressed={!ganttToolbarOpen}
              aria-expanded={ganttToolbarOpen}
              title={ganttToolbarOpen ? "Скрыть панель настроек" : "Показать панель настроек"}
              aria-label={ganttToolbarOpen ? "Скрыть панель настроек" : "Показать панель настроек"}
              onClick={() => setGanttToolbarOpen((v) => !v)}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 8l5 5 5-5" />
              </svg>
              {!ganttToolbarOpen && activeFilterCount > 0 ? (
                <span className="tgFiltersToggleBadge ganttToolbarCollapseBadge">{activeFilterCount}</span>
              ) : null}
            </button>
            {panelView === "TABLE" ? (
              <button
                type="button"
                className="btn ganttTableSettingsBtn"
                onClick={() => setTableSettingsOpen(true)}
                title="Настройки таблицы: набор реквизитов и заготовки"
                aria-label="Настройки таблицы"
              >
                Настройки
              </button>
            ) : null}
            {isMobile ? (
              <div className="ganttViewToggle ganttViewToggleCompact" role="group" aria-label="Режим отображения плана">
                <button
                  type="button"
                  className={`ganttViewToggleBtn${panelView === "TABLE" ? " ganttViewToggleBtnActive" : ""}`}
                  aria-pressed={panelView === "TABLE"}
                  onClick={() => {
                    setCopySelectMode(false);
                    setPanelView("TABLE");
                  }}
                >
                  Список
                </button>
                <button
                  type="button"
                  className={`ganttViewToggleBtn${panelView === "DIAGRAM" ? " ganttViewToggleBtnActive" : ""}`}
                  aria-pressed={panelView === "DIAGRAM"}
                  onClick={() => setPanelView("DIAGRAM")}
                >
                  Диаграмма
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="btn ganttIconBtn"
              onClick={() => setLegendOpen(true)}
              title="Легенда диаграммы"
              aria-label="Открыть легенду диаграммы"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="3" y="3.5" width="4" height="4" rx="1" fill="#38bdf8" />
                <rect x="3" y="8.5" width="4" height="4" rx="1" fill="#a78bfa" />
                <rect x="3" y="13.5" width="4" height="3" rx="1" fill="#f59e0b" />
                <path d="M9 5.5h8M9 10.5h8M9 15h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
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

        {ganttToolbarOpen ? (
        <div className="ganttToolbar">
          <div className="ganttToolbarRow">
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
              {!isMobile ? (
                <>
                  <button
                    type="button"
                    className={`btn ganttIconBtn${copySelectMode ? " btnCopyActive" : ""}`}
                    onClick={() => setCopySelectMode((v) => !v)}
                    disabled={!canEditEventsEffective || panelView !== "DIAGRAM"}
                    title={
                      !canEditEventsEffective
                        ? "Просмотрщик может смотреть события, но не создавать копии"
                        : panelView !== "DIAGRAM"
                        ? "Копирование доступно в режиме диаграммы"
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
                    disabled={!canEditEventsEffective}
                    title={!canEditEventsEffective ? "Недостаточно прав для создания события" : undefined}
                    aria-label="Создать событие"
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M10 4v12" />
                      <path d="M4 10h12" />
                    </svg>
                  </button>
                </>
              ) : null}
            </div>

            <div className="ganttToolbarGroup">
              {!isMobile ? (
                <>
              <span className="tgLabel">Вид</span>
              <div className="ganttViewToggle" role="group" aria-label="Режим отображения плана">
                <button
                  type="button"
                  className={`ganttViewToggleBtn${panelView === "DIAGRAM" ? " ganttViewToggleBtnActive" : ""}`}
                  aria-pressed={panelView === "DIAGRAM"}
                  onClick={() => setPanelView("DIAGRAM")}
                >
                  Диаграмма
                </button>
                <button
                  type="button"
                  className={`ganttViewToggleBtn${panelView === "TABLE" ? " ganttViewToggleBtnActive" : ""}`}
                  aria-pressed={panelView === "TABLE"}
                  onClick={() => {
                    setCopySelectMode(false);
                    setPanelView("TABLE");
                  }}
                >
                  Таблица
                </button>
              </div>
                </>
              ) : (
                <span className="tgLabel">Настройки диаграммы</span>
              )}
              {panelView === "DIAGRAM" ? (
                <>
                  <div className="tgField" title="Как группировать строки диаграммы">
                    <span className="tgFieldLabel">Группировка</span>
                    <SwitchToggle
                      compact
                      checked={groupMode === "HANGAR_STAND"}
                      onChange={(v) => {
                        setGroupMode(v ? "HANGAR_STAND" : "AIRCRAFT");
                        if (!v) {
                          setSelectedDndEventIds([]);
                          setPtrDrag(null);
                        }
                      }}
                      label={groupMode === "HANGAR_STAND" ? "Ангар / место" : "Борт / событие"}
                    />
                  </div>
                  <div
                    className="tgField"
                    title="Текущий график показывает факт вместо плана, когда факт заполнен; План-факт показывает два бара"
                  >
                    <span className="tgFieldLabel">Отображение</span>
                    <SwitchToggle
                      compact
                      checked={ganttDisplayMode === "PLAN_FACT"}
                      onChange={(v) => setGanttDisplayMode(v ? "PLAN_FACT" : "CURRENT")}
                      label={ganttDisplayMode === "PLAN_FACT" ? "План-факт" : "Текущий график"}
                    />
                  </div>
                  <div
                    className="tgField"
                    title="Внешние MRO (ангары с isPhysical=false) — сторонние контуры для оценки потребности"
                  >
                    <span className="tgFieldLabel">Внешние MRO</span>
                    <SwitchToggle
                      compact
                      checked={showExternalMroOnGantt}
                      onChange={setShowExternalMroOnGantt}
                      label={showExternalMroOnGantt ? "Показывать" : "Скрыты"}
                    />
                  </div>
                  {!isMobile ? (
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
                      if (!v) {
                        setSelectedDndEventIds([]);
                        setPtrDrag(null);
                      }
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
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <div className="ganttToolbarRow">
            <div className="ganttToolbarGroup">
              <span className="tgLabel">Период</span>
              <ToolbarPopover label={periodChipLabel} title="Период диаграммы" panelClassName="tbPopoverPeriod">
                <div className="tbPopoverPeriodBody">
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
                  <div className="tbPopoverPeriodDates">
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
                  </div>
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
              </ToolbarPopover>
            </div>

            <div className="ganttToolbarGroup">
              <span className="tgLabel">Фильтры</span>
              <label className={`tgField${selectedHangarIds.length ? " tgFieldActive" : ""}`}>
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
              <label className={`tgField${filterOperatorIds.length ? " tgFieldActive" : ""}`}>
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
              <label className={`tgField${filterAircraftTypeIds.length ? " tgFieldActive" : ""}`}>
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
              <label className={`tgField${filterAircraftIds.length ? " tgFieldActive" : ""}`}>
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
              <label className={`tgField${filterEventTypeIds.length ? " tgFieldActive" : ""}`}>
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
              <label className={`tgField${filterWorkshopIds.length ? " tgFieldActive" : ""}`}>
                <span className="tgFieldLabel">Цех</span>
                <MultiSelectDropdown
                  options={smartFilterOptions.workshops}
                  value={filterWorkshopIds}
                  onChange={setFilterWorkshopIds}
                  placeholder="все"
                  width={160}
                  maxHeight={320}
                  searchable
                  searchPlaceholder="Найти цех"
                  compact
                />
              </label>
              <label className={`tgField${filterStatusIds.length ? " tgFieldActive" : ""}`}>
                <span className="tgFieldLabel">Статус</span>
                <MultiSelectDropdown
                  options={smartFilterOptions.statuses}
                  value={filterStatusIds}
                  onChange={setFilterStatusIds}
                  placeholder="все"
                  width={200}
                  maxHeight={360}
                  searchable
                  searchPlaceholder="Найти статус"
                  compact
                />
              </label>
              <label className={`tgField${filterPlanningKind !== "ALL" ? " tgFieldActive" : ""}`}>
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
          </div>
        </div>
        ) : null}

        {panelView === "TABLE" && canEditEventsEffective ? (
          <div className="ganttBulkStatusBar">
            <button
              type="button"
              className="ganttBulkStatusToggle"
              aria-expanded={bulkStatusPanelOpen}
              onClick={() => setBulkStatusPanelOpen((open) => !open)}
            >
              <span className="ganttBulkStatusTitle">Массовая смена статуса</span>
              {selectedTableEventIds.length > 0 ? (
                <span className="ganttBulkStatusBadge">{selectedTableEventIds.length}</span>
              ) : (
                <span className="muted ganttBulkStatusHint">выберите строки в таблице</span>
              )}
              <span className={`evCardChevron${bulkStatusPanelOpen ? " evStagesChevronOpen" : ""}`} aria-hidden="true" />
            </button>
            {bulkStatusPanelOpen ? (
              <div className="ganttBulkStatusBody">
                <span className="ganttBulkStatusCount">
                  Выбрано: {selectedTableEventIds.length} из {exportEvents.length}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={exportEvents.length === 0}
                  onClick={() => setSelectedTableEventIds(exportEvents.map((e) => e.id))}
                >
                  Выбрать все отфильтрованные
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={selectedTableEventIds.length === 0}
                  onClick={() => setSelectedTableEventIds([])}
                >
                  Снять
                </button>
                <label className="tgField">
                  <span className="tgFieldLabel">Новый статус</span>
                  <SingleSelectDropdown
                    searchable
                    allowEmpty={false}
                    searchPlaceholder="Найти статус"
                    options={selectableStatusOptions}
                    value={bulkStatusTarget}
                    onChange={(status) => setBulkStatusTarget(status as EventStatusCode)}
                    width={260}
                    compact
                  />
                </label>
                <button
                  type="button"
                  className="btn btnPrimary"
                  disabled={
                    selectedTableEventIds.length === 0 ||
                    selectedTableEventIds.length > BULK_STATUS_MAX ||
                    bulkStatusM.isPending
                  }
                  title={
                    selectedTableEventIds.length > BULK_STATUS_MAX
                      ? `За один раз можно изменить не больше ${BULK_STATUS_MAX} событий`
                      : undefined
                  }
                  onClick={requestBulkStatus}
                >
                  {bulkStatusM.isPending ? "Применяем…" : "Применить"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {panelView === "DIAGRAM" && dndActive ? (
          <div className="ganttDndBar">
            <span className="tgLabel">DnD</span>
            <ToolbarPopover
              label={dndHangarIds.length ? `Ангар · ${dndHangarIds.length}` : "Ангар DnD"}
              title="Ангары для drop-зон"
              active={dndHangarIds.length > 0}
              panelClassName="tbPopoverNarrow"
            >
              <label className="tgField">
                <span className="tgFieldLabel">Ангар DnD</span>
                <MultiSelectDropdown
                  options={(hangarsQ.data ?? []).map((h) => ({ id: h.id, label: h.name }))}
                  value={dndHangarIds}
                  onChange={setDndHangarIds}
                  placeholder="как в фильтре"
                  width={220}
                  maxHeight={280}
                  searchable
                  searchPlaceholder="Найти ангар"
                  compact
                />
              </label>
            </ToolbarPopover>
            <ToolbarPopover
              label={dndLayoutIds.length ? `Схемы · ${dndLayoutIds.length}` : "Схемы"}
              title="Схемы расстановки для drop-зон"
              active={dndLayoutIds.length > 0}
              panelClassName="tbPopoverNarrow"
            >
              <label className="tgField">
                <span className="tgFieldLabel">Схемы</span>
                <MultiSelectDropdown
                  options={dndLayoutOptions}
                  value={dndLayoutIds}
                  onChange={setDndLayoutIds}
                  placeholder="все активные"
                  width={240}
                  maxHeight={280}
                  searchable
                  searchPlaceholder="Найти схему"
                  compact
                />
              </label>
            </ToolbarPopover>
            <button
              type="button"
              className={`btn${dndZoneOnly ? " btnPrimary" : ""}`}
              aria-pressed={dndZoneOnly}
              title="Показать только строки выбранных ангаров/схем"
              onClick={() => setDndZoneOnly((v) => !v)}
            >
              Только зона
            </button>
            {selectedDndEventIds.length > 0 ? (
              <button
                type="button"
                className="btn"
                onClick={() => setSelectedDndEventIds([])}
                title="Снять выделение событий"
              >
                Выбрано: {selectedDndEventIds.length} ✕
              </button>
            ) : (
              <span className="muted ganttDndHint">Ctrl/⌘+клик — пачка</span>
            )}
            {dndRangeLabel ? (
              <span
                className={`ganttDndRange${ptrDrag?.started ? " ganttDndRangeLive" : ""}`}
                title={ptrDrag?.started ? "Новые даты при переносе" : "Диапазон выбранных событий"}
              >
                {dndRangeLabel}
              </span>
            ) : null}
          </div>
        ) : null}

        {copySelectMode || (dndEnabled && !dndActive) || dndNotice || bulkStatusNotice || dndBlockedReason || rangeError || q.isFetching || q.error || (dndActive && selectedDndEventIds.length > 0) ? (
          <div className="ganttNotices">
            {copySelectMode ? (
              <span className="gpChip gpChipCopy">
                Режим копирования: выберите событие на диаграмме. <kbd>Esc</kbd> — отмена.
              </span>
            ) : null}
            {dndActive && selectedDndEventIds.length > 0 ? (
              <span className="gpChip gpChipInfo">
                Выделено для массового DnD: {selectedDndEventIds.length}. Тяните любое из них — перенесутся все.
              </span>
            ) : null}
            {q.isFetching ? <span className="gpChip gpChipInfo">Загрузка…</span> : null}
            {dndEnabled && !dndActive ? (
              <span className="gpChip">
                Drag&amp;Drop активен только в режиме «Ангар / место» — будет включён автоматически.
              </span>
            ) : null}
            {dndNotice ? <span className="gpChip">{dndNotice}</span> : null}
            {bulkStatusNotice ? <span className="gpChip gpChipInfo">{bulkStatusNotice}</span> : null}
            {dndBlockedReason ? <span className="gpChip gpChipError">{dndBlockedReason}</span> : null}
            {rangeError ? <span className="gpChip gpChipError">{rangeError}</span> : null}
            {q.error ? <span className="gpChip gpChipError">{String((q.error as any).message || q.error)}</span> : null}
          </div>
        ) : null}

      </div>

      <div className="ganttPageMain" ref={ganttPageMainRef}>
      {panelView === "TABLE" ? (
        <div className="card ganttTableCard">
          <GanttEventsTable
            events={exportEvents}
            canEdit={canEditEventsEffective}
            allowColumnReorder={!isMobile}
            settingsOpen={tableSettingsOpen}
            onSettingsOpenChange={setTableSettingsOpen}
            selectedIds={selectedTableEventIds}
            onSelectedIdsChange={setSelectedTableEventIds}
            eventsQueryFromISO={from.toISOString()}
            eventsQueryToISO={to.toISOString()}
            aircraft={aircraftQ.data ?? []}
            eventTypes={eventTypesQ.data ?? []}
            workshops={workshopsQ.data ?? []}
            hangars={hangarsQ.data ?? []}
            aircraftTypes={aircraftTypesQ.data ?? []}
            operators={(operatorsQ.data ?? []).map((o) => ({ id: o.id, code: o.code, name: o.name }))}
            onOpenEvent={(eventId) => {
              const ev = events.find((e) => e.id === eventId);
              if (ev) openEditorForExisting(ev);
            }}
          />
        </div>
      ) : (
      <div className={`ganttGrid${copySelectMode ? " ganttPickMode" : ""}`}>
        <div className="ganttHeaderRow">
          <div
            className="ganttLabel ganttAxisLabel"
            style={ganttLabelColStyle}
            title={
              preferAxisCodes
                ? "Компактный режим: коды. Расширьте ось, чтобы видеть наименования."
                : "Наименования. Сузьте ось, чтобы переключить на коды."
            }
          >
            <strong>{groupMode === "AIRCRAFT" ? "Борт / событие" : preferAxisCodes ? "Код / место" : "Ангар / место"}</strong>
            <button
              type="button"
              className="ganttAxisResizeHandle"
              onPointerDown={startGanttLabelResize}
              title="Потяните, чтобы изменить ширину левой оси"
              aria-label="Изменить ширину левой оси"
            />
          </div>
          <div className="ganttHeaderRightViewport" ref={headerViewportRef}>
            <div
              key={`gantt-header-${fitLayoutEpoch}`}
              className="ganttCanvas"
              style={{ width: canvasWidth, height: 44 }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTimelineScaleMenu({ x: e.clientX, y: e.clientY });
              }}
              title="ПКМ — шкала времени (Major / Minor / по ширине)"
            >
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

        {timelineScaleMenu && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={timelineScaleMenuRef}
                className="ganttTimelineScaleMenu"
                style={{ left: timelineScaleMenu.x, top: timelineScaleMenu.y }}
                role="dialog"
                aria-label="Шкала времени"
                onContextMenu={(e) => e.preventDefault()}
              >
                <div className="ganttTimelineScaleMenuTitle">Шкала времени</div>
                <div className="tbPopoverGrid tbPopoverGridCompact">
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
                        if (fitWidth) setFitWidth(false);
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
                      <option value="LOCAL">Local (MSK)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </label>
                  <div
                    className="tgField"
                    style={{ gridColumn: "1 / -1" }}
                    title="Показывать S-кривые между этапами всех разорванных событий"
                  >
                    <span className="tgFieldLabel">Связи этапов</span>
                    <SwitchToggle
                      compact
                      checked={showAllPlacementLinks}
                      onChange={setShowAllPlacementLinks}
                      label="Показать все связи"
                      hint="Иначе — только у выбранного события"
                    />
                  </div>
                  <div className="tbPopoverActions">
                    <button
                      type="button"
                      className={`btn${fitWidth ? " btnPrimary" : ""}`}
                      aria-pressed={fitWidth}
                      title="Растянуть выбранный диапазон дат на всю ширину панели"
                      onClick={() => setFitWidth((v) => !v)}
                    >
                      По ширине
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        <div className="ganttBody">
          <div className="ganttLeftCol" style={ganttLabelColStyle} ref={ganttLeftColRef}>
            {groupMode === "AIRCRAFT"
              ? aircraftRows.map((r, rowIdx) => (
                  <div
                    className={`ganttLabel${rowIdx % 2 ? " ganttRowAlt" : ""}`}
                    key={r.key}
                    style={{ height: ganttRowHeight }}
                    title={(r as any).title || undefined}
                  >
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
                    title={(r as any).title && (r as any).title !== r.label ? (r as any).title : undefined}
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
              <div
                key={`gantt-inner-${fitLayoutEpoch}`}
                className="ganttRightInner"
                style={{ width: canvasWidth, minWidth: canvasWidth }}
                onPointerDown={onGanttPanPointerDown}
                onDragStart={(e) => e.preventDefault()}
                onAuxClick={(e) => {
                  if (e.button === 1) e.preventDefault();
                }}
              >
                {groupMode === "HANGAR_STAND" && visiblePlacementLinks.length > 0 ? (
                  <svg
                    className="placementLinkLayer placementLinkLayerActive"
                    width={canvasWidth}
                    height={Math.max(ganttRowHeight, hangarStandRows.length * ganttRowHeight)}
                    aria-hidden="true"
                  >
                    {visiblePlacementLinks.map((l) => (
                      <g key={l.key} className="placementLink">
                        <path d={l.d} className="placementLinkHalo" />
                        <path d={l.d} className="placementLinkStroke" stroke={l.color} />
                        <circle cx={l.x1} cy={l.y1} r={1.75} className="placementLinkDot" fill={l.color} />
                        <circle cx={l.x2} cy={l.y2} r={1.75} className="placementLinkDot" fill={l.color} />
                      </g>
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
                          const overrunLabel = factTatLabel(ev);
                          const exitTargetIsFact = Boolean(actualSeg) || displayPeriod.source === "Факт";
                          const exitTargetSeg = actualSeg ?? g;
                          const exitTargetStartAt = exitTargetIsFact && ev.actualStartAt ? ev.actualStartAt : displayPeriod.startAt;
                          const exitTargetEndAt = exitTargetIsFact && ev.actualEndAt ? ev.actualEndAt : displayPeriod.endAt;
                          const isEditorFocused = editorOpen && Boolean(draft?.id) && draft!.id === ev.id;

                          return (
                            <Fragment key={ev.segmentKey ?? ev.id}>
                              <div
                                className={`bar${ganttDisplayMode === "PLAN_FACT" ? " barPlanFactPlan" : ""}${displayPeriod.source === "Факт" ? " barCurrentFact" : ""}${isEditorFocused ? " barEditing" : ""}`}
                                style={{
                                  left: x,
                                  width: w,
                                  cursor: "pointer",
                                  ...visual,
                                  ...barPaddingStyle(w)
                                }}
                                onClick={() => pickEvent(ev)}
                                title={`${eventTooltip(ev, timelineTimeMode, statusCatalog)}\n${
                                  copySelectMode
                                    ? "Нажмите, чтобы создать копию"
                                    : canEditEventsEffective
                                    ? "Нажмите, чтобы редактировать"
                                    : "Нажмите, чтобы открыть"
                                }`}
                              >
                                {displayPeriod.source === "Опер." ? renderTowBreaks({ ev, barX: x, barW: w, from, dayWidth, canvasWidth, timeMode: timelineTimeMode }) : null}
                                {displayPeriod.source === "Опер." ? renderPlacementBreaks({ ev, barX: x, barW: w, from, dayWidth, canvasWidth, timeMode: timelineTimeMode }) : null}
                                {canShowBarTitle(w) ? (
                                  <span style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
                                    <BarLabel {...aircraftBarText(ev, w, ganttDisplayMode)} />
                                  </span>
                                ) : null}
                                <BarStatusStripe status={ev.status} catalog={statusCatalog} />
                              </div>
                              {actualSeg ? (
                                <div
                                  className={`factBar factBar${actualTone[0].toUpperCase()}${actualTone.slice(1)}${isEditorFocused ? " factBarEditing" : ""}`}
                                  style={{ left: actualSeg.x, width: actualSeg.w }}
                                  title={`${factToneLabel(actualTone)}: ${formatTimelineDate(ev.actualStartAt, timelineTimeMode)} – ${formatTimelineDate(ev.actualEndAt, timelineTimeMode)}${
                                    overrunLabel ? `\n${overrunLabel}` : ""
                                  }`}
                                >
                                  {overrunLabel && canShowBarTitle(actualSeg.w) ? (
                                    <span className="factBarLabel">{overrunLabel}</span>
                                  ) : null}
                                </div>
                              ) : null}
                              {renderEntryTimeLabel(r.events, ev, exitTargetSeg, exitTargetStartAt, exitTargetEndAt, exitTargetIsFact)}
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
                          <div className="ganttDndGhostLayer" aria-hidden="true">
                            {(ptrPreview.bars.length > 1 ? ptrPreview.bars : []).map((bar, idx) => (
                              <div
                                key={`${bar.startAt}-${bar.endAt}-${idx}`}
                                className="ganttDndGhostItem"
                                style={{ left: bar.x, width: bar.w }}
                              />
                            ))}
                            <div
                              className="ganttDndGhostEnvelope"
                              style={{ left: ptrPreview.envelopeX, width: ptrPreview.envelopeW }}
                              title={`Предпросмотр: ${formatTimelineDate(ptrPreview.envelopeStartAt, timelineTimeMode)} – ${formatTimelineDate(
                                ptrPreview.envelopeEndAt,
                                timelineTimeMode
                              )}${(ptrDrag?.eventIds?.length ?? 0) > 1 ? ` · ${ptrDrag!.eventIds.length} событий` : ""}`}
                            >
                              <span className="ganttDndGhostLabel">
                                {formatTimelineDate(ptrPreview.envelopeStartAt, timelineTimeMode)}
                                {" – "}
                                {formatTimelineDate(ptrPreview.envelopeEndAt, timelineTimeMode)}
                                {(ptrDrag?.eventIds?.length ?? 0) > 1 ? ` · ×${ptrDrag!.eventIds.length}` : ""}
                              </span>
                            </div>
                          </div>
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
                          const overrunLabel = factTatLabel(ev);
                          const exitTargetIsFact = Boolean(actualSeg) || displayPeriod.source === "Факт";
                          const exitTargetSeg = actualSeg ?? g;
                          const exitTargetStartAt = exitTargetIsFact && ev.actualStartAt ? ev.actualStartAt : displayPeriod.startAt;
                          const exitTargetEndAt = exitTargetIsFact && ev.actualEndAt ? ev.actualEndAt : displayPeriod.endAt;
                          const isEditorFocused = editorOpen && Boolean(draft?.id) && draft!.id === ev.id;
                          const isPlacementDimmed = Boolean(selectedPlacementEventId) && ev.id !== selectedPlacementEventId;
                          const isDndSelected = dndActive && selectedDndEventIds.includes(ev.id);
                          const isDndBumpHover = dndActive && dndHoverBarIds.includes(ev.id) && dndHoverIntent === "bump";
                          const isMultiPlacementDndBlocked = (ev.placementCount ?? 1) > 1;
                          const bridge = ev.segmentKey ? placementBridgeBySegmentKey.get(ev.segmentKey) : undefined;
                          const bridgeMarkTop = ganttDisplayMode === "PLAN_FACT" ? 16 : 22;
                          const bridgeTitleBits = [
                            bridge?.prevLabel ? `Ранее: ${bridge.prevLabel}` : "",
                            bridge?.nextLabel ? `Далее: ${bridge.nextLabel}` : ""
                          ]
                            .filter(Boolean)
                            .join("\n");

                          return (
                            <Fragment key={ev.segmentKey ?? ev.id}>
                              <div
                              className={`bar${ganttDisplayMode === "PLAN_FACT" ? " barPlanFactPlan" : ""}${displayPeriod.source === "Факт" ? " barCurrentFact" : ""}${ev.placementOrigin === "AUTO_GAP" ? " barAutoGap" : ""}${isEditorFocused ? " barEditing" : ""}${isPlacementDimmed ? " barDimmed" : ""}`}
                              style={{
                                left: x,
                                width: w,
                                cursor: dndActive ? (isMultiPlacementDndBlocked ? "not-allowed" : "grab") : "pointer",
                                ...visual,
                                ...barPaddingStyle(w),
                                outline: isDndSelected
                                  ? "2px solid rgba(14, 165, 233, 0.95)"
                                  : isDndBumpHover
                                    ? "2px solid rgba(239, 68, 68, 0.95)"
                                    : undefined,
                                outlineOffset: 0,
                                boxShadow: isDndSelected ? "0 0 0 2px rgba(14, 165, 233, 0.25)" : undefined
                              }}
                              data-dnd-bar={dndActive && !isMultiPlacementDndBlocked ? "1" : undefined}
                              data-event-id={ev.id}
                              onPointerDown={(e) => {
                                if (!dndActive) return;
                                if (isMultiPlacementDndBlocked) {
                                  setDndNotice("Многоэтапное событие изменяется только в карточке — Drag&Drop отключён.");
                                  return;
                                }
                                if (e.button !== 0) return;
                                if (spacePanRef.current) return; // Space = pan, не DnD
                                // Ctrl/Cmd/Shift — мультивыбор без старта drag
                                if (e.metaKey || e.ctrlKey || e.shiftKey) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setSelectedDndEventIds((prev) =>
                                    prev.includes(ev.id) ? prev.filter((id) => id !== ev.id) : [...prev, ev.id]
                                  );
                                  return;
                                }
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                                } catch {
                                  // ignore
                                }
                                setPtrTarget(null);
                                setDndHoverKey(null);
                                setDndHoverBarIds([]);
                                setDndHoverIntent(null);
                                const right = bodyScrollRef.current;
                                const inner = right?.querySelector?.(".ganttRightInner") as HTMLElement | null;
                                const rect = inner?.getBoundingClientRect();
                                const scrollLeft = right ? right.scrollLeft : 0;
                                const px = rect ? e.clientX - rect.left + scrollLeft : x;

                                const selected =
                                  selectedDndEventIds.includes(ev.id) && selectedDndEventIds.length > 1
                                    ? [ev.id, ...selectedDndEventIds.filter((id) => id !== ev.id)]
                                    : [ev.id];
                                const items = dndItemsForSelection(selected, ev, events);
                                const dragState: DndPtrDrag = {
                                  eventId: ev.id,
                                  eventIds: items.map((item) => item.eventId),
                                  mode: "move",
                                  started: false,
                                  startClientX: e.clientX,
                                  startClientY: e.clientY,
                                  grabOffsetPx: Math.max(0, px - x),
                                  origStartMs: dayjs(ev.startAt).valueOf(),
                                  origEndMs: dayjs(ev.endAt).valueOf(),
                                  originHangarId: String(r.hangarId ?? ""),
                                  originRowKey: String(r.key),
                                  items
                                };
                                ptrPreviewRef.current = null;
                                setPtrPreview(null);
                                ptrDragRef.current = dragState;
                                setPtrDrag(dragState);
                                if (r.hangarId) {
                                  const t = { hangarId: String(r.hangarId), rowKey: String(r.key), intent: "move" as const };
                                  ptrTargetRef.current = t;
                                  setPtrTarget(t);
                                }
                              }}
                              onClick={() => {
                                // В режиме DnD клик не должен открывать карточку
                                if (dndActive) return;
                                pickEvent(ev);
                              }}
                              title={`${eventTooltip(ev, timelineTimeMode, statusCatalog)}${bridgeTitleBits ? `\n${bridgeTitleBits}` : ""}\n${
                                dndActive && isMultiPlacementDndBlocked
                                  ? "Многоэтапное событие изменяется только в карточке"
                                  : dndActive
                                  ? "Ctrl/⌘+клик — выделить · тяните для переноса"
                                  : copySelectMode
                                    ? "Нажмите, чтобы создать копию"
                                    : "Нажмите, чтобы редактировать"
                              }`}
                            >
                              {displayPeriod.source === "Опер." ? renderTowBreaks({ ev, barX: x, barW: w, from, dayWidth, canvasWidth, timeMode: timelineTimeMode }) : null}
                              {canShowBarTitle(w) ? (
                                <span style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
                                  <BarLabel {...hangarBarText(ev, w, ganttDisplayMode)} />
                                </span>
                              ) : null}
                              <BarStatusStripe status={ev.status} catalog={statusCatalog} />
                              </div>
                            {bridge?.prevLabel ? (
                              <div
                                className={`placementBridgeMark placementBridgeMarkIn${isPlacementDimmed ? " placementBridgeMarkDimmed" : ""}`}
                                style={{ left: x, top: bridgeMarkTop }}
                                aria-hidden="true"
                              />
                            ) : null}
                            {bridge?.nextLabel ? (
                              <div
                                className={`placementBridgeMark placementBridgeMarkOut${isPlacementDimmed ? " placementBridgeMarkDimmed" : ""}`}
                                style={{ left: x + w, top: bridgeMarkTop }}
                                aria-hidden="true"
                              />
                            ) : null}
                            {actualSeg ? (
                              <div
                                className={`factBar factBar${actualTone[0].toUpperCase()}${actualTone.slice(1)}${isEditorFocused ? " factBarEditing" : ""}${isPlacementDimmed ? " barDimmed" : ""}`}
                                style={{ left: actualSeg.x, width: actualSeg.w }}
                                title={`${factToneLabel(actualTone)}: ${formatTimelineDate(ev.actualStartAt, timelineTimeMode)} – ${formatTimelineDate(ev.actualEndAt, timelineTimeMode)}${
                                  overrunLabel ? `\n${overrunLabel}` : ""
                                }`}
                              >
                                {overrunLabel && canShowBarTitle(actualSeg.w) ? (
                                  <span className="factBarLabel">{overrunLabel}</span>
                                ) : null}
                              </div>
                            ) : null}
                            {renderEntryTimeLabel(r.events, ev, exitTargetSeg, exitTargetStartAt, exitTargetEndAt, exitTargetIsFact)}
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
      {!isMobile ? (
        <div className="ganttStickyFooter" aria-label="Нижняя панель диаграммы">
          <div className="ganttBottomScrollRow" aria-hidden="true">
            <div className="ganttBottomScrollSpacer" style={ganttLabelColStyle} />
            <div className="ganttBottomScrollViewport" ref={bottomScrollRef} onScroll={onBottomScroll}>
              <div
                key={`gantt-bottom-${fitLayoutEpoch}`}
                className="ganttBottomScrollInner"
                style={{ width: canvasWidth, minWidth: canvasWidth }}
              />
            </div>
          </div>
          {showSlotHistogram ? (
            <div className="ganttSlotHistogramRow">
              <div className="ganttSlotHistogramLabel" style={ganttLabelColStyle}>
                <strong>События</strong>
                <span>кол-во в периоде</span>
              </div>
              <div className="ganttSlotHistogramViewport" ref={histogramViewportRef}>
                <div key={`gantt-hist-${fitLayoutEpoch}`} className="ganttSlotHistogramCanvas" style={{ width: canvasWidth, minWidth: canvasWidth }}>
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
      ) : null}
      </div>
      )}
      </div>

      <FloatingEditorPanel
        open={editorOpen}
        collapsed={editorCollapsed}
        onCollapsedChange={setEditorCollapsed}
        title={
          !canEditEventsEffective
            ? "Просмотр события"
            : draft?.id
            ? "Редактирование события"
            : copyFromTitle
            ? "Копия события"
            : "Новое событие"
        }
        summary={editorSummary || "Карточка события"}
        beneathModal={confirmOpen || legendOpen}
        disableDrag={isMobile}
        onClose={() => {
          bumpEditorFeedbackReset();
          setEditorOpen(false);
          setEditorCollapsed(false);
          setCopyFromTitle(null);
          setShareHint(null);
        }}
        headerActions={
          draft?.id ? (
            <>
              {shareHint ? <span className="drawerShareHint" role="status">{shareHint}</span> : null}
              <button
                className="drawerShareBtn"
                onClick={() => void shareCurrentEvent()}
                aria-label="Поделиться"
                title="Поделиться ссылкой на событие"
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M10 2.5v9.5M10 2.5L6.5 6M10 2.5L13.5 6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M4 11.5v3.2c0 .7.56 1.3 1.25 1.3h9.5c.69 0 1.25-.6 1.25-1.3v-3.2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </>
          ) : null
        }
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

            {!canEditEventsEffective ? (
              <div className="contextNotice" role="status">
                <strong>Режим просмотра.</strong>{" "}
                {isMobile
                  ? "На мобильном устройстве доступен только просмотр. Карточка открыта без редактирования."
                  : "У вашей роли нет прав на редактирование событий. Карточка доступна только для просмотра."}
              </div>
            ) : null}

            <fieldset className="evReadonlyFieldset" disabled={!canEditEventsEffective}>
            <section className="evCard">
              <header className="evCardHeader">
                <EvCardTitle
                  helpLabel="Основная информация"
                  help={
                    <>
                      <p>Идентификация события: название, статус, тип планирования, тип события, борт и ответственный цех.</p>
                      <ul>
                        <li>Борт можно менять только в статусах «Черновик» и «Запланировано».</li>
                        <li>Оператор и тип ВС подставляются из справочника по выбранному борту.</li>
                        <li>Новые события создаются как оперативные; уровень на форме не выбирается.</li>
                      </ul>
                    </>
                  }
                >
                  Основная информация
                </EvCardTitle>
              </header>
              <div className="evCardBody">
                <div className="evMainInfo">
                  <label className="evField evEventTitleField">
                    <input
                      className="evInput evEventTitleInput"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      placeholder="Например: Техобслуживание А320"
                      aria-label="Название события"
                    />
                  </label>

                  <div className="evMainInfoGroup" aria-label="Параметры события">
                    <div className="evField">
                      <span className="evFieldLabel">Статус</span>
                      <SingleSelectDropdown
                        className="evSelect"
                        searchable
                        allowEmpty={false}
                        searchPlaceholder="Введите статус"
                        options={selectableStatusOptions}
                        value={draft.status}
                        onChange={(status) => setDraft({ ...draft, status: status as EditorDraft["status"] })}
                        width="100%"
                      />
                    </div>
                    <div className="evField">
                      <span className="evFieldLabel">Тип планирования</span>
                      <SingleSelectDropdown
                        className="evSelect"
                        searchable
                        allowEmpty={false}
                        searchPlaceholder="Введите тип планирования"
                        options={[
                          { id: "PLANNED", label: "Плановое" },
                          { id: "UNPLANNED", label: "Внеплановое" }
                        ]}
                        value={draft.planningKind}
                        disabled={scheduleLockedByDone}
                        onChange={(next) => {
                          const planningKind = next as EditorDraft["planningKind"];
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
                        width="100%"
                      />
                    </div>
                    <div className="evField">
                      <span className="evFieldLabel">Тип события</span>
                      <SingleSelectDropdown
                        className="evSelect"
                        searchable
                        searchPlaceholder="Введите тип события"
                        placeholder="— выберите —"
                        emptyLabel="— выберите —"
                        options={(eventTypesQ.data ?? []).map((type) => ({ id: type.id, label: type.name }))}
                        value={draft.eventTypeId}
                        disabled={scheduleLockedByDone}
                        onChange={(eventTypeId) => setDraft({ ...draft, eventTypeId })}
                        width="100%"
                        maxHeight={280}
                      />
                    </div>
                  </div>

                  <div className="evMainInfoGroup" aria-label="Воздушное судно">
                    <div className="evField">
                      <span className="evFieldLabel">Борт</span>
                      {!aircraftFieldEditable || (selectedVirtualAircraft && !draft.aircraftId) ? (
                        <input
                          className="evInput evInputReadonly"
                          value={aircraftFieldLabel}
                          readOnly
                          title={
                            !aircraftFieldEditable
                              ? "Борт можно менять только в статусах «Черновик» и «Запланировано»"
                              : undefined
                          }
                        />
                      ) : (
                        <SingleSelectDropdown
                          className="evSelect"
                          searchable
                          searchPlaceholder="Найти борт"
                          placeholder="— выберите —"
                          emptyLabel="— выберите —"
                          options={aircraftSelectOptions}
                          value={draft.aircraftId}
                          onChange={(aircraftId) => setDraft({ ...draft, aircraftId })}
                          width="100%"
                          maxHeight={280}
                        />
                      )}
                    </div>
                    <label className="evField">
                      <span className="evFieldLabel">Оператор</span>
                      <input
                        className="evInput evInputReadonly"
                        value={
                          draft.aircraftId
                            ? selectedAircraft?.operator?.name ?? "—"
                            : selectedVirtualAircraft
                              ? selectedVirtualOperatorName
                              : "—"
                        }
                        readOnly
                      />
                    </label>
                    <label className="evField">
                      <span className="evFieldLabel">Тип ВС</span>
                      <input
                        className="evInput evInputReadonly"
                        value={
                          draft.aircraftId
                            ? selectedAircraft?.type
                              ? `${selectedAircraft.type.icaoType ? `${selectedAircraft.type.icaoType} • ` : ""}${selectedAircraft.type.name}`
                              : "—"
                            : selectedVirtualAircraftType
                              ? `${selectedVirtualAircraftType.icaoType ? `${selectedVirtualAircraftType.icaoType} • ` : ""}${selectedVirtualAircraftType.name}`
                              : "—"
                        }
                        readOnly
                      />
                    </label>
                  </div>

                  <div className="evField evWorkshopField">
                    <span className="evFieldLabel">Ответственный цех</span>
                    <SingleSelectDropdown
                      className="evSelect"
                      searchable
                      searchPlaceholder="Введите код или название цеха"
                      placeholder="— не задан —"
                      emptyLabel="— не задан —"
                      options={(workshopsQ.data ?? [])
                        .filter((workshop) => workshop.isActive !== false || workshop.id === draft.workshopId)
                        .map((workshop) => ({
                          id: workshop.id,
                          label: workshop.code ? `${workshop.code} • ${workshop.name}` : workshop.name
                        }))}
                      value={draft.workshopId}
                      onChange={(workshopId) => setDraft({ ...draft, workshopId })}
                      width="100%"
                      maxHeight={280}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="evCard">
              <header className="evCardHeader">
                <EvCardTitle
                  helpLabel="Периоды и TAT"
                  help={
                    <>
                      <p>Три периода события для планирования и сравнения.</p>
                      <ul>
                        <li>Оперативный период управляет полоской на Гантте и размещением в ангаре.</li>
                        <li>Бюджетный период нужен для планового TAT; у внеплановых событий он скрыт.</li>
                        <li>Фактический период заполняется по ходу работы и влияет на статус «Завершено».</li>
                      </ul>
                    </>
                  }
                >
                  Периоды и TAT
                </EvCardTitle>
              </header>
              <div className="evCardBody">
                <fieldset
                  className={`evReadonlyFieldset${scheduleLockedByDone ? " evLockedReadonly" : ""}`}
                  disabled={scheduleLockedByDone}
                >
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
                </fieldset>
              </div>
            </section>

            <section className="evCard">
              <header className="evCardHeader">
                <EvCardTitle
                  helpLabel="Ангар и место"
                  help={
                    <>
                      <p>Где событие выполняется: ангар, вариант размещения и место.</p>
                      <ul>
                        <li>Выбор ангара и места в форме ещё не резервирует слот — для этого нужна кнопка «Назначить место».</li>
                        <li>Варианты размещения фильтруются по совместимости с типом ВС.</li>
                        <li>При нескольких размещениях этапы открываются компактным списком ниже; одно место назначается отдельно.</li>
                        <li>Первый этап начинается, а последний заканчивается вместе с оперативным периодом события.</li>
                      </ul>
                    </>
                  }
                >
                  Ангар и место
                </EvCardTitle>
              </header>
              <div className="evCardBody">
                <fieldset
                  className={`evReadonlyFieldset${scheduleLockedByDone ? " evLockedReadonly" : ""}`}
                  disabled={scheduleLockedByDone}
                >
                <div className="evLocationGrid">
                  <div className="evField">
                    <span className="evFieldLabel">Ангар</span>
                    <SingleSelectDropdown
                      className="evSelect"
                      searchable
                      searchPlaceholder="Введите ангар"
                      placeholder="— не задан —"
                      emptyLabel="— не задан —"
                      options={(hangarsQ.data ?? []).map((hangar) => ({ id: hangar.id, label: hangar.name }))}
                      value={draft.hangarId}
                      onChange={(hangarId) => setDraft({ ...draft, hangarId, layoutId: "", standId: "" })}
                      width="100%"
                    />
                  </div>
                  <div className="evField">
                    <span className="evFieldLabel">Вариант размещения</span>
                    <SingleSelectDropdown
                      className="evSelect"
                      searchable
                      searchPlaceholder="Введите вариант размещения"
                      placeholder="— не задан —"
                      emptyLabel="— не задан —"
                      options={(layoutsForEditorQ.data ?? []).map((layout) => ({
                        id: layout.id,
                        label: `${layout.name}${layout.isCompatible === false ? " — недоступно для типа ВС" : ""}`,
                        description: layout.standsSummary || undefined,
                        disabled: layout.isCompatible === false
                      }))}
                      value={draft.layoutId}
                      disabled={!draft.hangarId}
                      onChange={(layoutId) => setDraft({ ...draft, layoutId, standId: "" })}
                      width="100%"
                    />
                  </div>
                  <div className="evField">
                    <span className="evFieldLabel">Место</span>
                    <SingleSelectDropdown
                      className="evSelect"
                      searchable
                      searchPlaceholder="Введите код или название места"
                      placeholder="— не выбрано —"
                      emptyLabel="— не выбрано —"
                      options={(standsForEditorQ.data ?? []).map((stand) => ({
                        id: stand.id,
                        label: `${stand.code} • ${stand.name}${
                          stand.isCompatible === false ? " — недоступно для типа ВС" : ""
                        }`,
                        disabled: stand.isCompatible === false
                      }))}
                      value={draft.standId}
                      disabled={!draft.layoutId}
                      onChange={(standId) => setDraft({ ...draft, standId })}
                      width="100%"
                    />
                  </div>
                </div>
                <div className="evToggleStack">
                  <EvToggle
                    checked={draft.multiPlacement}
                    onChange={setMultiPlacementMode}
                    label="Событие в нескольких ангарах"
                    hint="Позволяет задать последовательность этапов размещения"
                  />
                  <EvToggle
                    checked={draft.allowOverlap}
                    onChange={(allowOverlap) => setDraft({ ...draft, allowOverlap })}
                    label="Разрешить нахлёст при сохранении"
                    hint={
                      draft.allowOverlap
                        ? "Сохранение не блокируется занятостью места или другой схемой ангара"
                        : "При конфликте места сохранение будет отклонено"
                    }
                  />
                </div>
                {draft.multiPlacement ? (
                  <EventPlacementsEditor
                    placements={draft.placements}
                    autoFillGapPlacements={draft.autoFillGapPlacements}
                    eventStartAtLocal={draft.startAtLocal}
                    eventEndAtLocal={draft.endAtLocal}
                    planningKind={draft.planningKind}
                    hangars={hangarsQ.data ?? []}
                    layoutsByHangar={layoutsByHangar}
                    standsByLayout={standsByLayout}
                    disabled={scheduleLockedByDone}
                    onPatch={setDraftPlacement}
                    onAdd={addPlacementDraft}
                    onRemove={removePlacementDraft}
                    onAutoFillChange={setAutoFillGapPlacements}
                    onAlignToEvent={alignPlacementsToEvent}
                  />
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
                </fieldset>
              </div>
            </section>

            <section className="evCard">
              <header className="evCardHeader">
                <EvCardTitle
                  helpLabel="Буксировки"
                  help={
                    <>
                      <p>Интервалы закатки и выкатки внутри события.</p>
                      <ul>
                        <li>Сначала сохраните событие — затем можно добавлять буксировки.</li>
                        <li>Можно указать несколько интервалов; они должны лежать внутри оперативного периода.</li>
                      </ul>
                    </>
                  }
                >
                  Буксировки
                </EvCardTitle>
              </header>
              <div className="evCardBody">
                {!draft.id ? (
                  <div className="muted">Сначала сохраните событие, затем можно добавлять буксировки.</div>
                ) : (
                  <fieldset
                    className={`evReadonlyFieldset${scheduleLockedByDone ? " evLockedReadonly" : ""}`}
                    disabled={scheduleLockedByDone}
                  >
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
                  </fieldset>
                )}
              </div>
            </section>

            <section className="evCard">
              <header className="evCardHeader">
                <EvCardTitle
                  helpLabel="Примечание"
                  help={
                    <>
                      <p>Свободный комментарий к событию для команды планирования и производства.</p>
                      <ul>
                        <li>Сюда удобно писать контекст, особенности работ и внешние согласования.</li>
                        <li>Текст виден всем, у кого есть доступ к карточке события.</li>
                      </ul>
                    </>
                  }
                >
                  Примечание
                </EvCardTitle>
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
                  <EvCardTitle
                    helpLabel="Трудоёмкость"
                    help={
                      <>
                        <p>Трудоёмкость по квалификациям (ч/ч) для бюджета, MPS-плана и факта WP.</p>
                        <ul>
                          <li>Блок доступен после сохранения события.</li>
                          <li>Значения попадают в первичную таблицу; выработка в сутки для MPS/факта считается в отчёте как TOTAL / TAT.</li>
                        </ul>
                      </>
                    }
                  >
                    Трудоёмкость
                  </EvCardTitle>
                  <span className="evCardChevron" aria-hidden="true" />
                </summary>
                <div className="evCardBody">
                  <EventResourcesPanel eventId={draft.id} />
                </div>
              </details>
            ) : null}

            <details className="evCard evCardDetails">
              <summary className="evCardHeader evCardSummary">
                <EvCardTitle
                  helpLabel="История изменений"
                  help={
                    <>
                      <p>Журнал правок события: кто, когда и что изменил — включая автостатусы.</p>
                      <ul>
                        <li>Записи сгруппированы по дням; раскрывайте нужную дату.</li>
                        <li>В рабочем контуре при существенных правках указывается причина.</li>
                        <li>В песочнице причина не обязательна.</li>
                      </ul>
                    </>
                  }
                  badge={
                    draft.id && (historyQ.data ?? []).length > 0 ? (
                      <span className="evCardBadge">{(historyQ.data ?? []).length}</span>
                    ) : null
                  }
                >
                  История изменений
                </EvCardTitle>
                <span className="evCardChevron" aria-hidden="true" />
              </summary>
              <div className="evCardBody">
                {!draft.id ? (
                  <div className="muted">История появится после сохранения события.</div>
                ) : historyQ.error ? (
                  <div className="error">{String(historyQ.error.message || historyQ.error)}</div>
                ) : historyByDay.length === 0 ? (
                  <div className="muted">История пока пустая.</div>
                ) : (
                  <div className="evHistoryList">
                    {historyByDay.map((group, groupIdx) => (
                      <details key={group.dayKey} className="evHistoryDay" open={groupIdx === 0}>
                        <summary className="evHistoryDaySummary">
                          <span className="evHistoryDayLabel">{group.label}</span>
                          <span className="evHistoryDayCount muted">{group.items.length}</span>
                        </summary>
                        <div className="evHistoryDayItems">
                          {group.items.map((h) => {
                            const diffs = extractDiffEntries(h.changes);
                            return (
                              <div key={h.id} className="evHistoryItem">
                                <div className="evHistoryHead">
                                  <strong>{formatActionLabel(h.action, h.changes)}</strong>
                                  <span className="muted">{dayjs(h.createdAt).format("HH:mm")}</span>
                                  <span className="muted">• {formatHistoryActor(h.actor)}</span>
                                </div>
                                {h.reason ? (
                                  <div className="evHistoryReason">
                                    <strong>Комментарий:</strong> {h.reason}
                                  </div>
                                ) : null}
                                {diffs.length > 0 ? (
                                  <div className="evHistoryDiffList">
                                    {diffs.map((d, i) => {
                                      const hasFrom = "from" in d;
                                      const hasTo = "to" in d;
                                      return (
                                        <div key={`${d.field}-${i}`} className="evHistoryDiffItem">
                                          <span className="evHistoryDiffField">{d.field}</span>
                                          {hasFrom || hasTo ? (
                                            <span className="evHistoryDiffValues">
                                              {hasFrom ? (
                                                <span className="evHistoryDiffFrom">
                                                  {resolveHistoryValue(d.rawKey, d.from, historyRefMaps)}
                                                </span>
                                              ) : null}
                                              {hasFrom && hasTo ? (
                                                <span className="evHistoryDiffArrow" aria-hidden="true">
                                                  →
                                                </span>
                                              ) : null}
                                              {hasTo ? (
                                                <span className="evHistoryDiffTo">
                                                  {resolveHistoryValue(d.rawKey, d.to, historyRefMaps)}
                                                </span>
                                              ) : null}
                                            </span>
                                          ) : (
                                            <span className="muted">{d.note}</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </details>

            <footer className="evFooter">
              <div className="evFooterInfo">
                {saveEventM.error || reserveM.error || unreserveM.error || deleteEventM.error ? (
                  <span className="error">
                    {String((saveEventM.error ?? reserveM.error ?? unreserveM.error ?? deleteEventM.error)?.message ?? "")}
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
                    bumpEditorFeedbackReset();
                    setEditorOpen(false);
                    setEditorCollapsed(false);
                    setCopyFromTitle(null);
                  }}
                  type="button"
                >
                  {canEditEventsEffective ? "Отмена" : "Закрыть"}
                </button>
                {canEditEventsEffective && draft.id && activeSandbox ? (
                  <button
                    className="btn btnDanger"
                    onClick={() => {
                      if (!confirm(`Удалить событие «${draft.title}» из песочницы «${activeSandbox.name}»?`)) return;
                      deleteEventM.mutate();
                    }}
                    disabled={deleteEventM.isPending}
                    type="button"
                  >
                    {deleteEventM.isPending ? "Удаляем…" : "Удалить из песочницы"}
                  </button>
                ) : null}
                {canEditEventsEffective ? (
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
                    saveEventM.isPending ||
                    (!!draft.id && computeDraftDiff(original, draft).length === 0)
                  }
                  type="button"
                >
                  {draft.id ? "Сохранить изменения" : copyFromTitle ? "Создать копию" : "Создать событие"}
                </button>
                ) : null}
              </div>
            </footer>
          </div>
        )}
      </FloatingEditorPanel>

      <Drawer
        open={legendOpen}
        title="Легенда диаграммы"
        subtitle="Статусы, индикаторы и цвета баров по правилу «оператор × тип ВС»."
        onClose={() => setLegendOpen(false)}
      >
        <div className="ganttLegendBody">
          <div className="legendSection">
            <div className="legendSectionTitle">Статусы событий</div>
            <div className="legendSectionGrid">
              {statusCatalog
                .filter((s) => s.code !== "DELETED")
                .map((s) => (
                  <LegendStatus
                    key={s.code}
                    status={s.code}
                    baseColor="#94a3b8"
                    label={s.name}
                    catalog={statusCatalog}
                  />
                ))}
            </div>
            <div className="legendHint muted">
              Цветная полоска внизу бара — статус из справочника «Статусы». Пунктирная рамка — слот ещё на согласовании.
              Заливка определяется правилом «оператор × тип ВС» (см. ниже).
            </div>
          </div>

          <div className="legendSection">
            <div className="legendSectionTitle">Индикаторы</div>
            <div className="legendSectionGrid">
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
                {legendPaletteEntries.slice(0, 48).map((p) => (
                  <span className="legendPaletteItem" key={p.key} title={`${p.operator} × ${p.type}`}>
                    <span className="legendPaletteSwatch" style={{ background: p.color }} />
                    <span className="legendPaletteLabel">
                      <span className="legendPaletteOperator">{p.operator}</span>
                      <span className="legendPaletteType">{p.type}</span>
                    </span>
                  </span>
                ))}
                {legendPaletteEntries.length > 48 ? (
                  <span className="legendPaletteMore muted">и ещё {legendPaletteEntries.length - 48}…</span>
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
                        <span className="evDiffFrom">{resolveHistoryValue(d.field, d.from, historyRefMaps)}</span>
                        <span className="evDiffArrow" aria-hidden="true">→</span>
                        <span className="evDiffTo">{resolveHistoryValue(d.field, d.to, historyRefMaps)}</span>
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
              <div className="evDiffTitle">
                {Array.isArray((pendingDnd as any)?.eventIds) && (pendingDnd as any).eventIds.length > 1
                  ? `Массовый перенос: ${(pendingDnd as any).eventIds.length} событий`
                  : "Перенос события"}
              </div>
              <div className="muted">
                Размещение/время будут изменены согласно предпросмотру
                {Array.isArray((pendingDnd as any)?.eventIds) && (pendingDnd as any).eventIds.length > 1
                  ? " (относительные сдвиги сохраняются)"
                  : ""}
                .
              </div>
            </div>
          ) : null}
          {pendingSave === "bulkStatus" ? (
            <div className="evDiff">
              <div className="evDiffTitle">Массовая смена статуса: {selectedTableEventIds.length} событий</div>
              <div className="muted">
                Новый статус: {statusCatalogLabel(bulkStatusTarget, statusCatalog)}. Завершённые и отменённые события
                будут пропущены
                {(() => {
                  const skip = exportEvents.filter(
                    (e) => selectedTableEventIds.includes(e.id) && BULK_STATUS_TERMINAL.has(e.status)
                  ).length;
                  return skip > 0 ? ` (${skip}).` : ".";
                })()}{" "}
                Этапы размещения не меняются.
              </div>
            </div>
          ) : null}

          <footer className="evFooter">
            <div className="evFooterInfo">
              {saveEventM.error ||
              reserveM.error ||
              addTowM.error ||
              delTowM.error ||
              dndMoveM.error ||
              bulkStatusM.error ? (
                <span className="error">
                  {String(
                    (
                      saveEventM.error ??
                      reserveM.error ??
                      addTowM.error ??
                      delTowM.error ??
                      dndMoveM.error ??
                      bulkStatusM.error
                    )?.message ?? ""
                  )}
                </span>
              ) : saveEventM.isPending ||
                reserveM.isPending ||
                addTowM.isPending ||
                delTowM.isPending ||
                dndMoveM.isPending ||
                bulkStatusM.isPending ? (
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
                  dndMoveM.isPending ||
                  bulkStatusM.isPending
                }
                onClick={() => {
                  if (pendingSave === "event") saveEventM.mutate();
                  if (pendingSave === "reserve") reserveM.mutate();
                  if (pendingSave === "towAdd") addTowM.mutate(null);
                  if (pendingSave === "towDel") delTowM.mutate(null);
                  if (pendingSave === "dndMove") dndMoveM.mutate(null);
                  if (pendingSave === "bulkStatus") bulkStatusM.mutate();
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

