const MS_HOUR = 60 * 60 * 1000;

export type EfficiencyGrain = "day" | "week" | "month" | "period";

/**
 * 121 local days from 1 January is 1 May — that cap hid the rest of a year.
 * 372 covers a leap year plus a short edge day, and still refuses a multi-year fan-out.
 */
export const MAX_DAY_BUCKETS = 372;
/** Previous loop broke after the 121st bucket (`length > 120`). Week and month stay on that ceiling. */
export const MAX_COARSE_BUCKETS = 121;

export type UtilizationBucket = { key: string; label: string; from: Date; to: Date };

export type LayoutSegment = {
  startMs: number;
  endMs: number;
  /** null = empty hangar; conflict = mutually exclusive layouts overlapping */
  layoutId: string | null;
  conflict: boolean;
  capacity: number;
  /** Events active on the whole segment. Segment edges are event boundaries, so the count is uniform. */
  aircraftCount: number;
};

export type ReservationSpan = { startMs: number; endMs: number };

type EffEvent = {
  startAt: Date;
  endAt: Date;
  layoutId: string | null;
};

/** Shift instant into "UTC wall clock" equal to local wall clock at tzOffsetMinutes (east of UTC). */
function toTzWall(d: Date, tzOffsetMinutes: number): Date {
  return new Date(d.getTime() + tzOffsetMinutes * 60_000);
}

function fromTzWall(wall: Date, tzOffsetMinutes: number): Date {
  return new Date(wall.getTime() - tzOffsetMinutes * 60_000);
}

function tzDateLabel(d: Date, tzOffsetMinutes: number): string {
  return toTzWall(d, tzOffsetMinutes).toISOString().slice(0, 10);
}

function startOfTzDay(d: Date, tzOffsetMinutes: number): Date {
  const wall = toTzWall(d, tzOffsetMinutes);
  const wallMidnight = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()));
  return fromTzWall(wallMidnight, tzOffsetMinutes);
}

function startOfTzMonth(d: Date, tzOffsetMinutes: number): Date {
  const wall = toTzWall(d, tzOffsetMinutes);
  const wallMonth = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1));
  return fromTzWall(wallMonth, tzOffsetMinutes);
}

/**
 * Buckets aligned to the client's calendar (tzOffsetMinutes, east of UTC — same as dayjs.utcOffset()).
 * Avoids UTC label drift (e.g. 01.06 local → 31.05 UTC).
 */
export function buildUtilizationBuckets(
  from: Date,
  to: Date,
  grain: EfficiencyGrain,
  tzOffsetMinutes = 0
): UtilizationBucket[] {
  if (grain === "period") {
    return [{ key: "period", label: "Весь период", from, to }];
  }

  const out: UtilizationBucket[] = [];
  const tz = Number.isFinite(tzOffsetMinutes) ? Math.trunc(tzOffsetMinutes) : 0;
  const cap = grain === "day" ? MAX_DAY_BUCKETS : MAX_COARSE_BUCKETS;

  if (grain === "day") {
    let cursor = startOfTzDay(from, tz);
    // If `from` is already start of local day, cursor === from; otherwise snap back then skip before from
    if (cursor.getTime() < from.getTime()) {
      const nextWall = toTzWall(cursor, tz);
      cursor = fromTzWall(
        new Date(Date.UTC(nextWall.getUTCFullYear(), nextWall.getUTCMonth(), nextWall.getUTCDate() + 1)),
        tz
      );
    }
    while (cursor.getTime() < to.getTime() && out.length < cap) {
      const wall = toTzWall(cursor, tz);
      const next = fromTzWall(
        new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1)),
        tz
      );
      const start = cursor.getTime() < from.getTime() ? new Date(from) : cursor;
      const end = next.getTime() > to.getTime() ? new Date(to) : next;
      if (end.getTime() <= start.getTime()) break;
      const label = tzDateLabel(start, tz);
      out.push({ key: `day-${label}`, label, from: start, to: end });
      cursor = next;
    }
    return out;
  }

  if (grain === "week") {
    let cursor = startOfTzDay(from, tz);
    if (cursor.getTime() < from.getTime()) cursor = new Date(from);
    while (cursor.getTime() < to.getTime() && out.length < cap) {
      const wall = toTzWall(cursor, tz);
      const next = fromTzWall(
        new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 7)),
        tz
      );
      const start = cursor.getTime() < from.getTime() ? new Date(from) : cursor;
      const end = next.getTime() > to.getTime() ? new Date(to) : next;
      if (end.getTime() <= start.getTime()) break;
      const labelFrom = tzDateLabel(start, tz);
      const labelTo = tzDateLabel(new Date(end.getTime() - 1), tz);
      out.push({
        key: `week-${labelFrom}`,
        label: `${labelFrom} – ${labelTo}`,
        from: start,
        to: end
      });
      cursor = next;
    }
    return out;
  }

  // month
  let cursor = startOfTzMonth(from, tz);
  if (cursor.getTime() < from.getTime()) {
    const wall = toTzWall(cursor, tz);
    cursor = fromTzWall(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1)), tz);
  }
  while (cursor.getTime() < to.getTime() && out.length < cap) {
    const wall = toTzWall(cursor, tz);
    const next = fromTzWall(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1)), tz);
    const start = cursor.getTime() < from.getTime() ? new Date(from) : cursor;
    const end = next.getTime() > to.getTime() ? new Date(to) : next;
    if (end.getTime() <= start.getTime()) break;
    const label = `${wall.getUTCFullYear()}-${String(wall.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ key: `month-${label}`, label, from: start, to: end });
    cursor = next;
  }
  return out;
}

/**
 * Time-varying hangar capacity (MRO / exclusive-layout model):
 * at any instant only one layout is available; other layouts are blocked and
 * must not contribute place-hours, idle or capacity.
 *
 * Empty intervals use nominal capacity = max stands among hangar layouts
 * (design capacity), matching HangarView Excel / academic hangar scheduling
 * where capacity varies with the active parking configuration.
 */
export function buildExclusiveLayoutSegments(params: {
  from: Date;
  to: Date;
  standCountByLayoutId: Map<string, number>;
  hangarLayoutIds: string[];
  events: EffEvent[];
}): { segments: LayoutSegment[]; referenceStandCount: number; referenceLayoutId: string | null } {
  const { from, to, standCountByLayoutId, hangarLayoutIds, events } = params;
  const hangarLayoutSet = new Set(hangarLayoutIds);

  let referenceStandCount = 0;
  let referenceLayoutId: string | null = null;
  for (const id of hangarLayoutIds) {
    const n = standCountByLayoutId.get(id) ?? 0;
    if (n > referenceStandCount) {
      referenceStandCount = n;
      referenceLayoutId = id;
    }
  }

  const hangarEvents = events.filter((e) => e.layoutId && hangarLayoutSet.has(e.layoutId));
  const points = new Set<number>([from.getTime(), to.getTime()]);
  for (const e of hangarEvents) {
    const s = Math.max(from.getTime(), e.startAt.getTime());
    const en = Math.min(to.getTime(), e.endAt.getTime());
    if (s < en) {
      points.add(s);
      points.add(en);
    }
  }
  const sorted = Array.from(points).sort((a, b) => a - b);
  const segments: LayoutSegment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i]!;
    const en = sorted[i + 1]!;
    if (en <= s) continue;
    const active = hangarEvents.filter((e) => e.startAt.getTime() < en && e.endAt.getTime() > s);
    if (active.length === 0) {
      segments.push({
        startMs: s,
        endMs: en,
        layoutId: null,
        conflict: false,
        capacity: referenceStandCount,
        aircraftCount: 0
      });
      continue;
    }
    const activeLayoutIds = Array.from(new Set(active.map((e) => e.layoutId).filter(Boolean) as string[]));
    const conflict = activeLayoutIds.length > 1;
    const primaryLayoutId = !conflict && activeLayoutIds.length === 1 ? activeLayoutIds[0]! : null;
    const capacity = primaryLayoutId ? standCountByLayoutId.get(primaryLayoutId) ?? 0 : 0;
    segments.push({
      startMs: s,
      endMs: en,
      layoutId: primaryLayoutId,
      conflict,
      capacity,
      aircraftCount: active.length
    });
  }

  return { segments, referenceStandCount, referenceLayoutId };
}

/**
 * Clip a full-period segment sweep to one bucket.
 * `segFromIdx` is the first segment that might still overlap (segments are sorted and contiguous).
 * Cost is proportional to segments that meet the window, not to rebuilding the sweep.
 */
export function clipHangarWindow(
  segments: LayoutSegment[],
  reservations: ReservationSpan[],
  fromMs: number,
  toMs: number,
  segFromIdx = 0
): {
  occupiedMs: number;
  aircraftHours: number;
  capacityHours: number;
  conflictMs: number;
  conflictSegments: number;
  capacityH: number;
  occupiedH: number;
  segFromIdx: number;
} {
  let idx = Math.max(0, segFromIdx);
  while (idx < segments.length && segments[idx]!.endMs <= fromMs) idx++;
  const firstIdx = idx;

  let occupiedMs = 0;
  let aircraftHours = 0;
  let capacityHours = 0;
  let conflictMs = 0;
  let conflictSegments = 0;
  let capacityH = 0;

  for (let i = firstIdx; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.startMs >= toMs) break;
    const s = Math.max(seg.startMs, fromMs);
    const e = Math.min(seg.endMs, toMs);
    if (e <= s) continue;
    const durationHours = (e - s) / MS_HOUR;
    if (seg.conflict) {
      conflictMs += e - s;
      conflictSegments += 1;
      occupiedMs += e - s;
      aircraftHours += seg.aircraftCount * durationHours;
      continue;
    }
    if (seg.layoutId) {
      occupiedMs += e - s;
      aircraftHours += seg.aircraftCount * durationHours;
    }
    if (seg.capacity > 0) {
      const placeH = seg.capacity * durationHours;
      capacityHours += placeH;
      capacityH += placeH;
    }
  }

  let occupiedH = 0;
  for (const r of reservations) {
    if (r.endMs <= fromMs || r.startMs >= toMs) continue;
    occupiedH += (Math.min(r.endMs, toMs) - Math.max(r.startMs, fromMs)) / MS_HOUR;
  }

  return {
    occupiedMs,
    aircraftHours,
    capacityHours,
    conflictMs,
    conflictSegments,
    capacityH,
    occupiedH,
    segFromIdx: firstIdx
  };
}
