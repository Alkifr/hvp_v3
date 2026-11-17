/** Шкала времени как на Гантте: Major / Minor, Local (MSK) / UTC, ширина суток. */

export type TimelineTimeMode = "UTC" | "LOCAL";
export type TimeScale = "hour" | "day" | "week" | "month" | "quarter" | "year";

export const TIMELINE_SCALE_ORDER: TimeScale[] = ["hour", "day", "week", "month", "quarter", "year"];

export const TIMELINE_SCALE_LABEL: Record<TimeScale, string> = {
  hour: "час",
  day: "сутки",
  week: "неделя",
  month: "месяц",
  quarter: "квартал",
  year: "год"
};

/** Пикселей на сутки, как ZOOM_PX_PER_DAY на Гантте. */
export const TIMELINE_PX_PER_DAY: Record<TimeScale, number> = {
  hour: 480,
  day: 24,
  week: 10,
  month: 3,
  quarter: 1.1,
  year: 0.4
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MSK_OFFSET_MINUTES = 180;

export type ScaleCell = {
  key: string;
  label: string;
  title: string;
  left: number;
  width: number;
  alt: boolean;
  /** Час 0–23, если minor = час. Иначе null. */
  hour: number | null;
};

function offsetMinutes(mode: TimelineTimeMode) {
  return mode === "UTC" ? 0 : MSK_OFFSET_MINUTES;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function wall(ms: number, mode: TimelineTimeMode) {
  const shifted = new Date(ms + offsetMinutes(mode) * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    dow: shifted.getUTCDay()
  };
}

function fromWall(y: number, m: number, d: number, h: number, mode: TimelineTimeMode) {
  return Date.UTC(y, m, d, h, 0, 0, 0) - offsetMinutes(mode) * 60_000;
}

export function timelineBoundsMs(from: string, to: string, mode: TimelineTimeMode = "LOCAL") {
  const startKey = from.slice(0, 10);
  const endKey = to.slice(0, 10);
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const [ey, em, ed] = endKey.split("-").map(Number);
  const start = fromWall(sy!, (sm ?? 1) - 1, sd ?? 1, 0, mode);
  const end = fromWall(ey!, (em ?? 1) - 1, ed ?? 1, 0, mode) + DAY_MS;
  return { start, end: end > start ? end : start + DAY_MS };
}

export function startOfScale(ms: number, scale: TimeScale, mode: TimelineTimeMode): number {
  const w = wall(ms, mode);
  switch (scale) {
    case "hour":
      return fromWall(w.y, w.m, w.d, w.h, mode);
    case "day":
      return fromWall(w.y, w.m, w.d, 0, mode);
    case "week":
      return fromWall(w.y, w.m, w.d, 0, mode) - w.dow * DAY_MS;
    case "month":
      return fromWall(w.y, w.m, 1, 0, mode);
    case "quarter":
      return fromWall(w.y, w.m - (w.m % 3), 1, 0, mode);
    case "year":
      return fromWall(w.y, 0, 1, 0, mode);
  }
}

export function addScale(ms: number, scale: TimeScale, mode: TimelineTimeMode): number {
  const w = wall(ms, mode);
  switch (scale) {
    case "hour":
      return ms + HOUR_MS;
    case "day":
      return ms + DAY_MS;
    case "week":
      return ms + 7 * DAY_MS;
    case "month":
      return fromWall(w.y, w.m + 1, 1, 0, mode);
    case "quarter":
      return fromWall(w.y, w.m + 3, 1, 0, mode);
    case "year":
      return fromWall(w.y + 1, 0, 1, 0, mode);
  }
}

export function labelForScale(ms: number, scale: TimeScale, mode: TimelineTimeMode) {
  const w = wall(ms, mode);
  switch (scale) {
    case "hour":
      return pad(w.h);
    case "day":
      return String(w.d);
    case "week": {
      const end = wall(ms + 6 * DAY_MS, mode);
      return `${w.d}–${end.d} ${MONTHS[end.m]}`;
    }
    case "month":
      return MONTHS[w.m] ?? "";
    case "quarter":
      return `Q${Math.floor(w.m / 3) + 1}`;
    case "year":
      return String(w.y);
  }
}

export function majorLabelForScale(ms: number, scale: TimeScale, mode: TimelineTimeMode) {
  const w = wall(ms, mode);
  switch (scale) {
    case "hour":
      return `${pad(w.d)}.${pad(w.m + 1)}.${w.y} ${pad(w.h)}:00`;
    case "day":
      return `${pad(w.d)}.${pad(w.m + 1)}.${w.y}`;
    case "week": {
      const end = wall(ms + 6 * DAY_MS, mode);
      return `${w.d} ${MONTHS[w.m]} ${w.y}–${end.d} ${MONTHS[end.m]} ${end.y}`;
    }
    case "month":
      return `${MONTHS[w.m]} ${w.y}`;
    case "quarter":
      return `Q${Math.floor(w.m / 3) + 1} ${w.y}`;
    case "year":
      return String(w.y);
  }
}

/** Major не мельче Minor. Год может совпадать сам с собой. */
export function coerceMajor(major: TimeScale, minor: TimeScale): TimeScale {
  const minorIdx = TIMELINE_SCALE_ORDER.indexOf(minor);
  const majorIdx = TIMELINE_SCALE_ORDER.indexOf(major);
  if (majorIdx > minorIdx || minor === "year") return major;
  return TIMELINE_SCALE_ORDER[Math.min(minorIdx + 1, TIMELINE_SCALE_ORDER.length - 1)]!;
}

function clipPercent(startMs: number, endMs: number, rangeStart: number, rangeEnd: number) {
  const span = Math.max(1, rangeEnd - rangeStart);
  const left = Math.max(0, ((startMs - rangeStart) / span) * 100);
  const right = Math.min(100, ((endMs - rangeStart) / span) * 100);
  return { left, width: Math.max(0, right - left) };
}

export function layoutTimelineScale(
  from: string,
  to: string,
  major: TimeScale,
  minor: TimeScale,
  mode: TimelineTimeMode = "LOCAL"
): { minor: ScaleCell[]; major: ScaleCell[] } {
  const { start, end } = timelineBoundsMs(from, to, mode);
  const minorCells: ScaleCell[] = [];
  const majorKeys: number[] = [];
  let cur = startOfScale(start, minor, mode);
  const limit = 5000;
  for (let i = 0; i < limit && cur < end; i++) {
    const next = addScale(cur, minor, mode);
    const clipped = clipPercent(cur, next, start, end);
    const majorStart = startOfScale(cur, major, mode);
    if (!majorKeys.includes(majorStart)) majorKeys.push(majorStart);
    if (clipped.width > 0) {
      const hour = minor === "hour" ? wall(cur, mode).h : null;
      const minorLabel = labelForScale(cur, minor, mode);
      const majorLabel = majorLabelForScale(majorStart, major, mode);
      minorCells.push({
        key: `m-${cur}`,
        label: minorLabel,
        title: `${majorLabel} • ${minorLabel}`,
        left: clipped.left,
        width: clipped.width,
        alt: (majorKeys.length - 1) % 2 === 1,
        hour
      });
    }
    cur = next;
  }
  const majorCells: ScaleCell[] = majorKeys.flatMap((majorStart, index) => {
    const majorEnd = addScale(majorStart, major, mode);
    const clipped = clipPercent(majorStart, majorEnd, start, end);
    if (clipped.width <= 0) return [];
    const label = majorLabelForScale(majorStart, major, mode);
    return [{
      key: `M-${majorStart}`,
      label,
      title: label,
      left: clipped.left,
      width: clipped.width,
      alt: index % 2 === 1,
      hour: null
    }];
  });
  return { minor: minorCells, major: majorCells };
}

/** Сутки смены: ночь 00:00–08:00, день 08:00–20:00, ночь 20:00–24:00. */
export function collapseDayNight(cells: ScaleCell[]): ScaleCell[] {
  const out: ScaleCell[] = [];
  for (const cell of cells) {
    if (cell.hour == null) {
      out.push({ ...cell });
      continue;
    }
    const part = cell.hour < 8 ? 0 : cell.hour < 20 ? 1 : 2;
    const label = part === 1 ? "день" : "ночь";
    const title = part === 1 ? "День 08:00–20:00" : part === 0 ? "Ночь 00:00–08:00" : "Ночь 20:00–24:00";
    const last = out[out.length - 1];
    if (last && last.hour === part) {
      last.width += cell.width;
      continue;
    }
    out.push({ ...cell, label, title, hour: part });
  }
  return out;
}

/** На узкой часовой шкале оставляет метки 0, 6, 12 и 18 и растягивает их ячейки. */
export function collapseSparseHours(cells: ScaleCell[]): ScaleCell[] {
  const out: ScaleCell[] = [];
  for (const cell of cells) {
    if (cell.hour != null && cell.hour % 6 !== 0) {
      const last = out[out.length - 1];
      if (last) last.width += cell.width;
      continue;
    }
    out.push({ ...cell });
  }
  return out;
}
