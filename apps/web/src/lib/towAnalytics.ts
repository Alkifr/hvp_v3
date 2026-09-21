export type TowAnalyticsDirection = "IN" | "OUT" | "TRANSFER" | "UNKNOWN";

export type TowAnalyticsRow = {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStatus: string;
  eventTypeId: string | null;
  eventType: string;
  hangarId: string | null;
  hangar: string;
  aircraftId: string | null;
  aircraft: string;
  aircraftTypeId: string | null;
  aircraftType: string;
  operatorId: string | null;
  operator: string;
  direction: TowAnalyticsDirection;
  directionLabel: string;
  fromStand: string;
  toStand: string;
  startAt: string;
  endAt: string;
  occupancyEndAt: string | null;
  towDurationMin: number | null;
  occupancyMin: number | null;
  slotMin: number | null;
  startChangeReason: string;
  notes: string;
  positionComment: string;
};

export type TowCountSlice = { label: string; count: number };
export type TowHangarSlice = {
  hangarId: string;
  hangar: string;
  tows: number;
  events: number;
  inCount: number;
  outCount: number;
  transferCount: number;
  avgTowDurationMin: number | null;
  occupancyH: number;
};

export type TowTimelinePoint = {
  key: string;
  label: string;
  from: string;
  to: string;
  tows: number;
  occupancyH: number;
  movementH: number;
  peakConcurrent: number;
};

export type TowAnalyticsSummary = {
  tows: number;
  events: number;
  avgTowsPerEvent: number | null;
  inCount: number;
  outCount: number;
  transferCount: number;
  unknownCount: number;
  avgTowDurationMin: number | null;
  medianTowDurationMin: number | null;
  avgOccupancyH: number | null;
  avgOccupancyToSlotPct: number | null;
  changedStartPct: number | null;
  incompleteRoutePct: number | null;
  peakConcurrent: number;
  peakConcurrentAt: string | null;
};

export type TowAnalyticsComputed = {
  summary: TowAnalyticsSummary;
  directions: TowCountSlice[];
  reasons: TowCountSlice[];
  routes: TowCountSlice[];
  hangars: TowHangarSlice[];
  hours: Array<{ hour: number; label: string; count: number }>;
  timeline: TowTimelinePoint[];
};

export type TowAnalyticsGrain = "day" | "week" | "month" | "period";

const MSK_OFFSET_MINUTES = 180;

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, n) => s + n, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mskHour(iso: string, tzOffsetMinutes = MSK_OFFSET_MINUTES): number {
  const shifted = new Date(new Date(iso).getTime() + tzOffsetMinutes * 60_000);
  return shifted.getUTCHours();
}

export function isIncompleteRoute(row: Pick<TowAnalyticsRow, "direction" | "fromStand" | "toStand">): boolean {
  return row.direction === "UNKNOWN" || !row.fromStand.trim() || !row.toStand.trim();
}

export function occupancyToSlotPct(row: Pick<TowAnalyticsRow, "occupancyMin" | "slotMin">): number | null {
  if (row.occupancyMin == null || row.slotMin == null || row.slotMin <= 0) return null;
  return (row.occupancyMin / row.slotMin) * 100;
}

export function peakConcurrent(
  intervals: Array<{ start: number; end: number }>
): { peak: number; at: number | null } {
  const points: Array<{ t: number; d: number }> = [];
  for (const it of intervals) {
    if (!Number.isFinite(it.start) || !Number.isFinite(it.end) || it.end <= it.start) continue;
    points.push({ t: it.start, d: 1 });
    points.push({ t: it.end, d: -1 });
  }
  points.sort((a, b) => a.t - b.t || a.d - b.d);
  let current = 0;
  let peak = 0;
  let at: number | null = null;
  for (const p of points) {
    current += p.d;
    if (current > peak) {
      peak = current;
      at = p.t;
    }
  }
  return { peak, at };
}

function overlapHours(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 3_600_000;
}

function countBy(labels: string[]): TowCountSlice[] {
  const m = new Map<string, number>();
  for (const label of labels) m.set(label, (m.get(label) ?? 0) + 1);
  return [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
}

function startOfTzDay(ms: number, tz: number): number {
  const wall = new Date(ms + tz * 60_000);
  const midnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  return midnight - tz * 60_000;
}

function startOfTzMonth(ms: number, tz: number): number {
  const wall = new Date(ms + tz * 60_000);
  const month = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1);
  return month - tz * 60_000;
}

function dateLabel(ms: number, tz: number): string {
  const wall = new Date(ms + tz * 60_000);
  const dd = String(wall.getUTCDate()).padStart(2, "0");
  const mm = String(wall.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}

export function buildTowTimeline(
  rows: TowAnalyticsRow[],
  fromIso: string,
  toIso: string,
  grain: TowAnalyticsGrain,
  tzOffsetMinutes = MSK_OFFSET_MINUTES
): TowTimelinePoint[] {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  const tz = Number.isFinite(tzOffsetMinutes) ? Math.trunc(tzOffsetMinutes) : 0;
  const buckets: Array<{ key: string; label: string; from: number; to: number }> = [];

  if (grain === "period") {
    buckets.push({ key: "period", label: "Весь период", from, to });
  } else if (grain === "month") {
    let cursor = startOfTzMonth(from, tz);
    if (cursor < from) {
      const wall = new Date(cursor + tz * 60_000);
      cursor = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1) - tz * 60_000;
    }
    while (cursor < to) {
      const wall = new Date(cursor + tz * 60_000);
      const next = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1) - tz * 60_000;
      const start = Math.max(cursor, from);
      const end = Math.min(next, to);
      if (end > start) {
        const label = `${wall.getUTCFullYear()}-${String(wall.getUTCMonth() + 1).padStart(2, "0")}`;
        buckets.push({ key: `month-${label}`, label, from: start, to: end });
      }
      cursor = next;
      if (buckets.length > 120) break;
    }
  } else {
    const stepDays = grain === "week" ? 7 : 1;
    let cursor = startOfTzDay(from, tz);
    while (cursor < to) {
      const next = cursor + stepDays * 86_400_000;
      const start = Math.max(cursor, from);
      const end = Math.min(next, to);
      if (end > start) {
        const label =
          grain === "week"
            ? `${dateLabel(start, tz)} – ${dateLabel(end - 1, tz)}`
            : dateLabel(start, tz);
        buckets.push({
          key: `${grain}-${start}`,
          label,
          from: start,
          to: end
        });
      }
      cursor = next;
      if (buckets.length > 120) break;
    }
  }

  return buckets.map((b) => {
    const overlapping = rows.filter((r) => {
      const s = new Date(r.startAt).getTime();
      const e = new Date(r.endAt).getTime();
      return s < b.to && e > b.from;
    });
    const occupancyH = rows.reduce((sum, r) => {
      const s = new Date(r.startAt).getTime();
      const occEnd = r.occupancyEndAt ? new Date(r.occupancyEndAt).getTime() : new Date(r.endAt).getTime();
      return sum + overlapHours(s, occEnd, b.from, b.to);
    }, 0);
    const movementH = overlapping.reduce((sum, r) => {
      const s = new Date(r.startAt).getTime();
      const e = new Date(r.endAt).getTime();
      return sum + overlapHours(s, e, b.from, b.to);
    }, 0);
    const peak = peakConcurrent(
      overlapping.map((r) => ({ start: new Date(r.startAt).getTime(), end: new Date(r.endAt).getTime() }))
    );
    return {
      key: b.key,
      label: b.label,
      from: new Date(b.from).toISOString(),
      to: new Date(b.to).toISOString(),
      tows: overlapping.length,
      occupancyH,
      movementH,
      peakConcurrent: peak.peak
    };
  });
}

export function summarizeTowAnalytics(
  rows: TowAnalyticsRow[],
  opts?: {
    fromIso?: string;
    toIso?: string;
    grain?: TowAnalyticsGrain;
    tzOffsetMinutes?: number;
  }
): TowAnalyticsComputed {
  const durations = rows.map((r) => r.towDurationMin).filter((n): n is number => n != null && n > 0);
  const occupancies = rows.map((r) => r.occupancyMin).filter((n): n is number => n != null && n > 0);
  const occToSlot = rows.map(occupancyToSlotPct).filter((n): n is number => n != null);
  const events = new Set(rows.map((r) => r.eventId));
  const changed = rows.filter((r) => r.startChangeReason.trim()).length;
  const incomplete = rows.filter(isIncompleteRoute).length;
  const peak = peakConcurrent(
    rows.map((r) => ({ start: new Date(r.startAt).getTime(), end: new Date(r.endAt).getTime() }))
  );

  const inCount = rows.filter((r) => r.direction === "IN").length;
  const outCount = rows.filter((r) => r.direction === "OUT").length;
  const transferCount = rows.filter((r) => r.direction === "TRANSFER").length;
  const unknownCount = rows.filter((r) => r.direction === "UNKNOWN").length;

  const hangarMap = new Map<string, TowAnalyticsRow[]>();
  for (const row of rows) {
    const key = row.hangarId || row.hangar || "—";
    const list = hangarMap.get(key) ?? [];
    list.push(row);
    hangarMap.set(key, list);
  }

  const hangars: TowHangarSlice[] = [...hangarMap.entries()]
    .map(([key, list]) => {
      const durs = list.map((r) => r.towDurationMin).filter((n): n is number => n != null && n > 0);
      const occMin = list.reduce((s, r) => s + (r.occupancyMin ?? 0), 0);
      return {
        hangarId: list[0]?.hangarId || key,
        hangar: list[0]?.hangar || "—",
        tows: list.length,
        events: new Set(list.map((r) => r.eventId)).size,
        inCount: list.filter((r) => r.direction === "IN").length,
        outCount: list.filter((r) => r.direction === "OUT").length,
        transferCount: list.filter((r) => r.direction === "TRANSFER").length,
        avgTowDurationMin: avg(durs),
        occupancyH: occMin / 60
      };
    })
    .sort((a, b) => b.tows - a.tows || a.hangar.localeCompare(b.hangar, "ru"));

  const hourCounts = Array.from({ length: 24 }, () => 0);
  const tz = opts?.tzOffsetMinutes ?? MSK_OFFSET_MINUTES;
  for (const row of rows) {
    hourCounts[mskHour(row.startAt, tz)] += 1;
  }

  const timeline =
    opts?.fromIso && opts?.toIso
      ? buildTowTimeline(rows, opts.fromIso, opts.toIso, opts.grain ?? "week", tz)
      : [];

  return {
    summary: {
      tows: rows.length,
      events: events.size,
      avgTowsPerEvent: events.size > 0 ? rows.length / events.size : null,
      inCount,
      outCount,
      transferCount,
      unknownCount,
      avgTowDurationMin: avg(durations),
      medianTowDurationMin: median(durations),
      avgOccupancyH: avg(occupancies.map((m) => m / 60)),
      avgOccupancyToSlotPct: avg(occToSlot),
      changedStartPct: rows.length > 0 ? (changed / rows.length) * 100 : null,
      incompleteRoutePct: rows.length > 0 ? (incomplete / rows.length) * 100 : null,
      peakConcurrent: peak.peak,
      peakConcurrentAt: peak.at != null ? new Date(peak.at).toISOString() : null
    },
    directions: [
      { label: "Закатка", count: inCount },
      { label: "Выкатка", count: outCount },
      { label: "Перестановка", count: transferCount },
      { label: "Не определено", count: unknownCount }
    ].filter((d) => d.count > 0),
    reasons: countBy(rows.map((r) => r.startChangeReason.trim() || "Без причины")).slice(0, 20),
    routes: countBy(
      rows.map((r) => {
        const from = r.fromStand.trim() || "—";
        const to = r.toStand.trim() || "—";
        return `${from} → ${to}`;
      })
    ).slice(0, 15),
    hangars,
    hours: hourCounts.map((count, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      count
    })),
    timeline
  };
}
