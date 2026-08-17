import { MSK_OFFSET_MINUTES } from "./localDate.js";

export const DIGEST_PERIOD_MODES = ["last1", "last7", "last30", "custom"] as const;
export type DigestPeriodMode = (typeof DIGEST_PERIOD_MODES)[number];

export const DIGEST_SCHEDULE_MODES = ["manual", "daily", "weekly", "monthly"] as const;
export type DigestScheduleMode = (typeof DIGEST_SCHEDULE_MODES)[number];

export const SCHEDULE_WINDOW_MINUTES = 15;
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type MskParts = {
  y: number;
  m: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

export function mskParts(d: Date): MskParts {
  const shifted = new Date(d.getTime() + MSK_OFFSET_MINUTES * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay()
  };
}

export function mskDayKey(d: Date): string {
  const p = mskParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isoWeekdayFromMsk(d: Date): number {
  const wd = mskParts(d).weekday;
  return wd === 0 ? 7 : wd;
}

export function startOfMskDay(d: Date): Date {
  const p = mskParts(d);
  return new Date(Date.UTC(p.y, p.m - 1, p.day) - MSK_OFFSET_MINUTES * 60_000);
}

export function startOfMskYmd(ymd: string): Date | null {
  if (!YMD_RE.test(ymd)) return null;
  const [y, m, day] = ymd.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, day));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== day) return null;
  return new Date(Date.UTC(y, m - 1, day) - MSK_OFFSET_MINUTES * 60_000);
}

export function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400_000);
}

export function parseDigestPeriodMode(raw: unknown): DigestPeriodMode {
  return DIGEST_PERIOD_MODES.includes(raw as DigestPeriodMode) ? (raw as DigestPeriodMode) : "last7";
}

export function parseDigestScheduleMode(raw: unknown): DigestScheduleMode {
  return DIGEST_SCHEDULE_MODES.includes(raw as DigestScheduleMode) ? (raw as DigestScheduleMode) : "manual";
}

export function parseScheduleTime(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return TIME_RE.test(s) ? s : "09:00";
}

export function parseWeekdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [1, 2, 3, 4, 5];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const n = typeof item === "number" ? item : Number(item);
    if (!Number.isInteger(n) || n < 1 || n > 7 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

export function parseMonthDay(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 28) return 1;
  return n;
}

export function resolveDigestPeriod(
  params: {
    periodMode?: unknown;
    customFrom?: string | null;
    customTo?: string | null;
  },
  now = new Date()
): { from: Date; to: Date } {
  const mode = parseDigestPeriodMode(params.periodMode);
  const todayStart = startOfMskDay(now);
  const tomorrowStart = addUtcDays(todayStart, 1);

  if (mode === "last1") {
    return { from: addUtcDays(todayStart, -1), to: todayStart };
  }
  if (mode === "last30") {
    return { from: addUtcDays(todayStart, -29), to: tomorrowStart };
  }
  if (mode === "custom") {
    const from = startOfMskYmd(String(params.customFrom ?? "").trim());
    const toStart = startOfMskYmd(String(params.customTo ?? "").trim());
    if (!from || !toStart) {
      throw new Error("Укажите корректный период");
    }
    const to = addUtcDays(toStart, 1);
    if (!(to > from)) {
      throw new Error("Дата окончания должна быть позже даты начала");
    }
    return { from, to };
  }
  return { from: addUtcDays(todayStart, -6), to: tomorrowStart };
}

export type ScheduleDueInput = {
  isActive: boolean;
  scheduleMode: unknown;
  scheduleTime: unknown;
  scheduleWeekdays: unknown;
  scheduleMonthDay: unknown;
  lastAutoSentAt: Date | null;
};

export function isScheduledDigestDue(settings: ScheduleDueInput, now = new Date()): boolean {
  if (!settings.isActive) return false;
  const mode = parseDigestScheduleMode(settings.scheduleMode);
  if (mode === "manual") return false;

  const time = parseScheduleTime(settings.scheduleTime);
  const match = TIME_RE.exec(time);
  if (!match) return false;
  const scheduledMinutes = Number(match[1]) * 60 + Number(match[2]);
  const parts = mskParts(now);
  const nowMinutes = parts.hour * 60 + parts.minute;
  if (nowMinutes < scheduledMinutes || nowMinutes > scheduledMinutes + SCHEDULE_WINDOW_MINUTES) return false;

  if (settings.lastAutoSentAt && mskDayKey(settings.lastAutoSentAt) === mskDayKey(now)) return false;

  if (mode === "weekly") {
    const days = parseWeekdays(settings.scheduleWeekdays);
    if (!days.includes(isoWeekdayFromMsk(now))) return false;
  }
  if (mode === "monthly" && parts.day !== parseMonthDay(settings.scheduleMonthDay)) return false;

  return true;
}
