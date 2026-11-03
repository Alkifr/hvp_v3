const DAY_MS = 86_400_000;

export function dateKey(value: string | Date): string {
  if (!(value instanceof Date)) return String(value ?? "").slice(0, 10);
  if (Number.isNaN(value.getTime())) return "";
  return new Date(value.getTime() + 180 * 60_000).toISOString().slice(0, 10);
}

export function mondayOfWeek(value: string | Date): string {
  const key = dateKey(value);
  const day = new Date(`${key}T00:00:00Z`);
  const isoDay = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - isoDay + 1);
  return dateKey(day);
}

export function shiftWeek(weekStart: string, weeks: number): string {
  const day = new Date(`${mondayOfWeek(weekStart)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + weeks * 7);
  return dateKey(day);
}

export function weekDates(weekStart: string): string[] {
  const start = new Date(`${mondayOfWeek(weekStart)}T00:00:00Z`).getTime();
  return Array.from({ length: 7 }, (_, index) => dateKey(new Date(start + index * DAY_MS)));
}

export const MAX_RESOURCE_DAYS = 31;

export function addDays(value: string, days: number): string {
  const day = new Date(`${dateKey(value)}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return "";
  day.setUTCDate(day.getUTCDate() + days);
  return dateKey(day);
}

export function monthPeriod(value: string | Date = new Date()): { from: string; to: string } {
  const key = dateKey(value);
  const [year, month] = key.split("-").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function clampResourcePeriod(from: string, to: string): { from: string; to: string } {
  const start = dateKey(from);
  const endInput = dateKey(to);
  if (!isCalendarDate(start)) return { from: "", to: "" };
  let end = isCalendarDate(endInput) && endInput >= start ? endInput : start;
  const maxEnd = addDays(start, MAX_RESOURCE_DAYS - 1);
  if (isCalendarDate(maxEnd) && end > maxEnd) end = maxEnd;
  return { from: start, to: end };
}

export function periodDates(from: string, to: string): string[] {
  const period = clampResourcePeriod(from, to);
  if (!isCalendarDate(period.from) || !isCalendarDate(period.to)) return [];
  const dates: string[] = [];
  for (let key = period.from; dates.length < MAX_RESOURCE_DAYS && key <= period.to; key = addDays(key, 1)) {
    if (!isCalendarDate(key) || (dates.length > 0 && key <= dates[dates.length - 1]!)) break;
    dates.push(key);
  }
  return dates;
}

export function shiftPeriod(from: string, to: string, direction: -1 | 1): { from: string; to: string } {
  const days = periodDates(from, to).length;
  return clampResourcePeriod(addDays(from, direction * days), addDays(to, direction * days));
}

const PERSONNEL_TABS = ["resources", "balance", "week", "capacity"] as const;
export type PersonnelTab = (typeof PERSONNEL_TABS)[number];

export type PersonnelViewState = {
  tab: PersonnelTab;
  weekStart: string;
  periodFrom: string;
  periodTo: string;
  workshopId: string;
  aircraftTypeId: string;
};

function savedDate(value: unknown, fallback: string) {
  const candidate = String(value ?? "");
  if (isCalendarDate(candidate)) return candidate;
  return isCalendarDate(fallback) ? fallback : "";
}

export function personnelViewDefaults(now: Date = new Date()) {
  const period = monthPeriod(now);
  return { periodFrom: period.from, periodTo: period.to, weekStart: mondayOfWeek(now) };
}

export function readPersonnelView(
  raw: unknown,
  defaults: { periodFrom: string; periodTo: string; weekStart: string }
): PersonnelViewState {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const periodFrom = savedDate(row.periodFrom, defaults.periodFrom);
  const periodTo = savedDate(row.periodTo, defaults.periodTo);
  const period = periodFrom && periodTo ? clampResourcePeriod(periodFrom, periodTo) : { from: defaults.periodFrom, to: defaults.periodTo };
  const tab = PERSONNEL_TABS.includes(row.tab as PersonnelTab) ? (row.tab as PersonnelTab) : "resources";
  return {
    tab,
    weekStart: mondayOfWeek(savedDate(row.weekStart, defaults.weekStart)),
    periodFrom: period.from,
    periodTo: period.to,
    workshopId: typeof row.workshopId === "string" ? row.workshopId : "",
    aircraftTypeId: typeof row.aircraftTypeId === "string" ? row.aircraftTypeId : ""
  };
}

export function availabilityKey(date: string, shiftId: string, aircraftTypeId: string, categoryCode: string): string {
  return [dateKey(date), shiftId, aircraftTypeId, categoryCode].join("|");
}

export function formatPersonnelNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: digits });
}

export function balanceClass(value: number): "positive" | "negative" | "neutral" {
  return value > 0.0001 ? "positive" : value < -0.0001 ? "negative" : "neutral";
}

const CAPACITY_EPS = 0.05;

/** Production capacity: available hours against planned load. Slack = capacity − load. */
export type CapacityHours = {
  load: number;
  capacity: number;
  slack: number;
  /** Load / capacity in percent. Null when there is load and no capacity. */
  loadFactorPct: number | null;
};

export function capacityHours(load: number, capacity: number): CapacityHours {
  const slack = capacity - load;
  return {
    load,
    capacity,
    slack,
    loadFactorPct: capacity > CAPACITY_EPS ? (load / capacity) * 100 : null
  };
}

export function categoryCapacity(
  day: {
    demand?: Record<string, number>;
    authorizedSupply?: Record<string, number>;
    qualificationSupply?: Record<string, number>;
  },
  line: { key: string; planDepartment: string | null; supply: "department" | "qualification" }
): CapacityHours {
  const load = line.planDepartment ? day.demand?.[line.planDepartment] ?? 0 : 0;
  const capacity = line.supply === "department" && line.planDepartment
    ? day.authorizedSupply?.[line.planDepartment] ?? 0
    : day.qualificationSupply?.[line.key] ?? 0;
  return capacityHours(load, capacity);
}

/** Lowest slack among skills that actually have load or capacity. Hours are not fungible across skills. */
export function capacityConstraint<T extends CapacityHours & { label: string }>(
  rows: readonly T[]
): (T & { kind: "overload" | "nearest" }) | null {
  const active = rows.filter((row) => row.capacity > CAPACITY_EPS || row.load > CAPACITY_EPS);
  if (!active.length) return null;
  const worst = active.reduce((best, row) => (row.slack < best.slack ? row : best));
  return { ...worst, kind: worst.slack < -CAPACITY_EPS ? "overload" : "nearest" };
}

/** Inclusive local dates. `to` is the last visible day. */
export function periodTimelinePosition(
  startAt: string,
  endAt: string,
  from: string,
  to: string
): { left: number; width: number; startsBefore: boolean; endsAfter: boolean } | null {
  const start = new Date(`${from.slice(0, 10)}T00:00:00+03:00`).getTime();
  const end = new Date(`${to.slice(0, 10)}T00:00:00+03:00`).getTime() + DAY_MS;
  const itemStart = new Date(startAt).getTime();
  const itemEnd = new Date(endAt).getTime();
  const clippedStart = Math.max(start, itemStart);
  const clippedEnd = Math.min(end, itemEnd);
  if (!Number.isFinite(itemStart) || !Number.isFinite(itemEnd) || !(end > start) || clippedEnd <= clippedStart) return null;
  const span = end - start;
  return {
    left: ((clippedStart - start) / span) * 100,
    width: ((clippedEnd - clippedStart) / span) * 100,
    startsBefore: itemStart < start,
    endsAfter: itemEnd > end
  };
}

export function timelinePosition(
  startAt: string,
  endAt: string,
  weekStart: string
): { left: number; width: number } | null {
  const start = new Date(`${mondayOfWeek(weekStart)}T00:00:00+03:00`).getTime();
  const end = start + 7 * DAY_MS;
  const itemStart = new Date(startAt).getTime();
  const itemEnd = new Date(endAt).getTime();
  const clippedStart = Math.max(start, itemStart);
  const clippedEnd = Math.min(end, itemEnd);
  if (!Number.isFinite(itemStart) || !Number.isFinite(itemEnd) || clippedEnd <= clippedStart) return null;
  return {
    left: ((clippedStart - start) / (end - start)) * 100,
    width: ((clippedEnd - clippedStart) / (end - start)) * 100
  };
}
