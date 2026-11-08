import {
  buildExclusiveLayoutSegments,
  buildUtilizationBuckets,
  clipHangarWindow,
  type UtilizationBucket
} from "./utilizationSeries.js";

const MS_DAY = 24 * 60 * 60 * 1000;
const MAX_YEAR_BUCKETS = 40;

/** Reservations with no aircraft type, operator, or event type. */
export const UNOWNED_OCCUPANCY_ID = "none";

export type OccupancyGrain = "day" | "week" | "month" | "year";
export type OccupancyGroupBy = "aircraftType" | "operator";

export type OccupancyReservation = {
  hangarId: string;
  startAt: Date;
  endAt: Date;
  aircraftTypeId: string | null;
  operatorId: string | null;
  eventTypeId: string | null;
};

export type OccupancyHangar = {
  hangarId: string;
  layoutIds: string[];
  standCountByLayoutId: Map<string, number>;
  events: Array<{ startAt: Date; endAt: Date; layoutId: string | null }>;
};

export type OccupancyFilters = {
  aircraftTypeIds: string[];
  operatorIds: string[];
  eventTypeIds: string[];
};

export type OccupancyPart = {
  id: string;
  placeDays: number;
  /** placeDays / days in the parent interval. One line is one place held for the whole interval. */
  lines: number;
  /** Share of the parent slice (summary slice, or this row). */
  sharePct: number;
};

export type OccupancyRow = {
  id: string;
  placeDays: number;
  lines: number;
  shareOfCapacityPct: number;
  shareOfOccupiedPct: number;
  byEventType: OccupancyPart[];
};

export type OccupancyBucket = {
  key: string;
  label: string;
  from: Date;
  to: Date;
  dayCount: number;
  capacityPlaceDays: number;
  occupiedPlaceDays: number;
  slicePlaceDays: number;
  capacityLines: number;
  occupiedLines: number;
  sliceLines: number;
  shareOfCapacityPct: number;
  shareOfOccupiedPct: number;
  byEventType: OccupancyPart[];
  byAircraftType: OccupancyPart[];
};

export type OccupancyReport = {
  /** Calendar length of the period. A full month uses that month's day count. */
  periodDays: number;
  capacityPlaceDays: number;
  occupiedPlaceDays: number;
  slicePlaceDays: number;
  capacityLines: number;
  occupiedLines: number;
  sliceLines: number;
  shareOfCapacityPct: number;
  shareOfOccupiedPct: number;
  byEventType: OccupancyPart[];
  rows: OccupancyRow[];
  buckets: OccupancyBucket[];
  /** Last bucket ends before the requested period. Day/week/month/year caps. */
  truncated: boolean;
};

function toTzWall(d: Date, tzOffsetMinutes: number): Date {
  return new Date(d.getTime() + tzOffsetMinutes * 60_000);
}

function fromTzWall(wall: Date, tzOffsetMinutes: number): Date {
  return new Date(wall.getTime() - tzOffsetMinutes * 60_000);
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function pct(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  return (part / whole) * 100;
}

/** Days in an interval. A timestamp 1ms short of the next midnight still counts as that calendar day. */
export function intervalDays(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  const days = ms / MS_DAY;
  const nearest = Math.round(days);
  if (nearest > 0 && Math.abs(days - nearest) < 1 / 24) return nearest;
  return days;
}

function toLines(placeDays: number, from: Date, to: Date): number {
  const days = intervalDays(from, to);
  if (days <= 0) return 0;
  return placeDays / days;
}

function allows(id: string | null, ids: string[]): boolean {
  if (ids.length === 0) return true;
  return id != null && ids.includes(id);
}

function inSlice(row: OccupancyReservation, filters: OccupancyFilters): boolean {
  return (
    allows(row.aircraftTypeId, filters.aircraftTypeIds) &&
    allows(row.operatorId, filters.operatorIds) &&
    allows(row.eventTypeId, filters.eventTypeIds)
  );
}

function groupId(row: OccupancyReservation, groupBy: OccupancyGroupBy): string {
  const id = groupBy === "operator" ? row.operatorId : row.aircraftTypeId;
  return id ?? UNOWNED_OCCUPANCY_ID;
}

export function buildYearBuckets(from: Date, to: Date, tzOffsetMinutes = 0): UtilizationBucket[] {
  const tz = Number.isFinite(tzOffsetMinutes) ? Math.trunc(tzOffsetMinutes) : 0;
  const wall = toTzWall(from, tz);
  let cursor = fromTzWall(new Date(Date.UTC(wall.getUTCFullYear(), 0, 1)), tz);
  const out: UtilizationBucket[] = [];
  while (cursor.getTime() < to.getTime() && out.length < MAX_YEAR_BUCKETS) {
    const cursorWall = toTzWall(cursor, tz);
    const next = fromTzWall(new Date(Date.UTC(cursorWall.getUTCFullYear() + 1, 0, 1)), tz);
    const start = cursor.getTime() < from.getTime() ? new Date(from) : cursor;
    const end = next.getTime() > to.getTime() ? new Date(to) : next;
    if (end.getTime() <= start.getTime()) break;
    const label = String(toTzWall(start, tz).getUTCFullYear());
    out.push({ key: `year-${label}`, label, from: start, to: end });
    cursor = next;
  }
  return out;
}

export function buildOccupancyBuckets(
  from: Date,
  to: Date,
  grain: OccupancyGrain,
  tzOffsetMinutes = 0
): UtilizationBucket[] {
  if (grain === "year") return buildYearBuckets(from, to, tzOffsetMinutes);
  return buildUtilizationBuckets(from, to, grain, tzOffsetMinutes);
}

function capacityPlaceDays(hangars: OccupancyHangar[], from: Date, to: Date): number {
  let hours = 0;
  for (const hangar of hangars) {
    const { segments } = buildExclusiveLayoutSegments({
      from,
      to,
      standCountByLayoutId: hangar.standCountByLayoutId,
      hangarLayoutIds: hangar.layoutIds,
      events: hangar.events
    });
    hours += clipHangarWindow(segments, [], from.getTime(), to.getTime()).capacityH;
  }
  return hours / 24;
}

type Span = {
  startMs: number;
  endMs: number;
  groupId: string;
  aircraftTypeId: string;
  eventTypeId: string;
  inSlice: boolean;
};

function collectSpans(
  reservations: OccupancyReservation[],
  hangarIds: Set<string>,
  filters: OccupancyFilters,
  groupBy: OccupancyGroupBy
): Span[] {
  const spans: Span[] = [];
  for (const row of reservations) {
    if (!hangarIds.has(row.hangarId)) continue;
    const startMs = row.startAt.getTime();
    const endMs = row.endAt.getTime();
    if (endMs <= startMs) continue;
    spans.push({
      startMs,
      endMs,
      groupId: groupId(row, groupBy),
      aircraftTypeId: row.aircraftTypeId ?? UNOWNED_OCCUPANCY_ID,
      eventTypeId: row.eventTypeId ?? UNOWNED_OCCUPANCY_ID,
      inSlice: inSlice(row, filters)
    });
  }
  return spans;
}

function placeDaysIn(spans: Span[], fromMs: number, toMs: number, onlySlice: boolean): number {
  let ms = 0;
  for (const span of spans) {
    if (onlySlice && !span.inSlice) continue;
    ms += overlapMs(span.startMs, span.endMs, fromMs, toMs);
  }
  return ms / MS_DAY;
}

function partsBy(
  spans: Span[],
  from: Date,
  to: Date,
  parentPlaceDays: number,
  keyOf: (span: Span) => string
): OccupancyPart[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const byId = new Map<string, number>();
  for (const span of spans) {
    if (!span.inSlice) continue;
    const days = overlapMs(span.startMs, span.endMs, fromMs, toMs) / MS_DAY;
    if (days <= 0) continue;
    const key = keyOf(span);
    byId.set(key, (byId.get(key) ?? 0) + days);
  }
  return [...byId.entries()]
    .map(([id, placeDays]) => ({
      id,
      placeDays,
      lines: toLines(placeDays, from, to),
      sharePct: pct(placeDays, parentPlaceDays)
    }))
    .sort((a, b) => b.placeDays - a.placeDays || a.id.localeCompare(b.id));
}

function partsIn(spans: Span[], from: Date, to: Date, parentPlaceDays: number): OccupancyPart[] {
  return partsBy(spans, from, to, parentPlaceDays, (span) => span.eventTypeId);
}

/**
 * Place-days from stand reservations.
 * Capacity follows the exclusive-layout sweep: an idle layout adds nothing while another layout is active.
 * Aircraft type, operator and event type filters narrow the slice only. Capacity and total occupancy stay on the selected hangars.
 */
export function buildOccupancyReport(params: {
  from: Date;
  to: Date;
  grain: OccupancyGrain;
  groupBy: OccupancyGroupBy;
  tzOffsetMinutes?: number;
  hangars: OccupancyHangar[];
  reservations: OccupancyReservation[];
  filters?: OccupancyFilters;
}): OccupancyReport {
  const filters = params.filters ?? { aircraftTypeIds: [], operatorIds: [], eventTypeIds: [] };
  const hangarIds = new Set(params.hangars.map((h) => h.hangarId));
  const spans = collectSpans(params.reservations, hangarIds, filters, params.groupBy);
  const fromMs = params.from.getTime();
  const toMs = params.to.getTime();

  const capacityPlaceDaysValue = capacityPlaceDays(params.hangars, params.from, params.to);
  const occupiedPlaceDays = placeDaysIn(spans, fromMs, toMs, false);
  const slicePlaceDays = placeDaysIn(spans, fromMs, toMs, true);
  const periodDays = intervalDays(params.from, params.to);

  const buckets = buildOccupancyBuckets(params.from, params.to, params.grain, params.tzOffsetMinutes ?? 0);
  const bucketRows: OccupancyBucket[] = buckets.map((bucket) => {
    const bFrom = bucket.from.getTime();
    const bTo = bucket.to.getTime();
    const capacity = capacityPlaceDays(params.hangars, bucket.from, bucket.to);
    const occupied = placeDaysIn(spans, bFrom, bTo, false);
    const slice = placeDaysIn(spans, bFrom, bTo, true);
    return {
      key: bucket.key,
      label: bucket.label,
      from: bucket.from,
      to: bucket.to,
      dayCount: intervalDays(bucket.from, bucket.to),
      capacityPlaceDays: capacity,
      occupiedPlaceDays: occupied,
      slicePlaceDays: slice,
      capacityLines: toLines(capacity, bucket.from, bucket.to),
      occupiedLines: toLines(occupied, bucket.from, bucket.to),
      sliceLines: toLines(slice, bucket.from, bucket.to),
      shareOfCapacityPct: pct(slice, capacity),
      shareOfOccupiedPct: pct(slice, occupied),
      byEventType: partsIn(spans, bucket.from, bucket.to, slice),
      byAircraftType: partsBy(spans, bucket.from, bucket.to, slice, (span) => span.aircraftTypeId)
    };
  });

  const byGroup = new Map<string, Span[]>();
  for (const span of spans) {
    if (!span.inSlice) continue;
    const list = byGroup.get(span.groupId) ?? [];
    list.push(span);
    byGroup.set(span.groupId, list);
  }
  const rows: OccupancyRow[] = [...byGroup.entries()]
    .map(([id, groupSpans]) => {
      const placeDays = placeDaysIn(groupSpans, fromMs, toMs, true);
      return {
        id,
        placeDays,
        lines: toLines(placeDays, params.from, params.to),
        shareOfCapacityPct: pct(placeDays, capacityPlaceDaysValue),
        shareOfOccupiedPct: pct(placeDays, occupiedPlaceDays),
        byEventType: partsIn(groupSpans, params.from, params.to, placeDays)
      };
    })
    .filter((row) => row.placeDays > 0)
    .sort((a, b) => b.placeDays - a.placeDays || a.id.localeCompare(b.id));

  const last = buckets.at(-1);
  return {
    periodDays,
    capacityPlaceDays: capacityPlaceDaysValue,
    occupiedPlaceDays,
    slicePlaceDays,
    capacityLines: toLines(capacityPlaceDaysValue, params.from, params.to),
    occupiedLines: toLines(occupiedPlaceDays, params.from, params.to),
    sliceLines: toLines(slicePlaceDays, params.from, params.to),
    shareOfCapacityPct: pct(slicePlaceDays, capacityPlaceDaysValue),
    shareOfOccupiedPct: pct(slicePlaceDays, occupiedPlaceDays),
    byEventType: partsIn(spans, params.from, params.to, slicePlaceDays),
    rows,
    buckets: bucketRows,
    truncated: last != null && last.to.getTime() < toMs
  };
}
