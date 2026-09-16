import {
  PRIMARY_METRIC_DEPARTMENTS,
  skillCodeToDepartment,
  type PrimaryMetricDepartmentCode
} from "./primaryMetricDepartments.js";

export type MonthlyPlanQualifications = Record<PrimaryMetricDepartmentCode, number>;

export const MONTHLY_BASE_PLAN_NRC_FACTOR = 1.2;
export const MONTHLY_BASE_PLAN_MAX_DAYS = 62;

export type MonthlyPlanLaborSource = "plan_lines" | "mps" | "budget" | "none";

export type MonthlyPlanDay = {
  key: string;
  label: string;
  weekday: number;
  weekend: boolean;
};

export type MonthlyPlanHalfFlags = { day: boolean; evening: boolean };
export type MonthlyPlanHalfHours = { day: number; evening: number };

export type MonthlyBasePlanEventInput = {
  eventId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  aircraftLabel: string;
  aircraftTypeName: string;
  operatorCode: string;
  operatorId: string | null;
  aircraftId: string | null;
  aircraftTypeId: string | null;
  eventTypeId: string | null;
  hangarId: string | null;
  hangarName: string;
  workshopId: string | null;
  workshopName: string;
  color: string;
  metrics: Array<{ block: string; department: string; manHours: number | null }>;
  planLines: Array<{
    date: Date;
    plannedMinutes: number;
    shiftCode: string | null;
    shiftStartMin: number | null;
    skillCode: string | null;
  }>;
};

export type MonthlyBasePlanEventRow = {
  eventId: string;
  title: string;
  aircraft: string;
  aircraftType: string;
  operatorCode: string;
  operatorId: string | null;
  aircraftId: string | null;
  aircraftTypeId: string | null;
  eventTypeId: string | null;
  hangarId: string | null;
  hangarName: string;
  workshopId: string | null;
  workshopName: string;
  color: string;
  startAt: string;
  endAt: string;
  laborSource: MonthlyPlanLaborSource;
  laborTotal: number;
  qualifications: MonthlyPlanQualifications;
  occupied: MonthlyPlanHalfFlags[];
  labor: MonthlyPlanHalfHours[];
};

export type MonthlyBasePlanShopRow = {
  workshopId: string;
  workshopName: string;
  planned: number[];
  plannedWithNrc: number[];
};

export type MonthlyBasePlanResult = {
  nrcFactor: number;
  days: MonthlyPlanDay[];
  events: MonthlyBasePlanEventRow[];
  shops: MonthlyBasePlanShopRow[];
  summary: {
    events: number;
    shops: number;
    laborTotal: number;
    laborWithNrc: number;
    withPlanLines: number;
    withSpreadLabor: number;
    withoutLabor: number;
  };
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toTzWall(d: Date, tzOffsetMinutes: number): Date {
  return new Date(d.getTime() + tzOffsetMinutes * 60_000);
}

function fromTzWall(wall: Date, tzOffsetMinutes: number): Date {
  return new Date(wall.getTime() - tzOffsetMinutes * 60_000);
}

export function tzDateKey(d: Date, tzOffsetMinutes: number): string {
  return toTzWall(d, tzOffsetMinutes).toISOString().slice(0, 10);
}

export function buildTzDays(from: Date, to: Date, tzOffsetMinutes: number): MonthlyPlanDay[] {
  const tz = Number.isFinite(tzOffsetMinutes) ? Math.trunc(tzOffsetMinutes) : 0;
  const out: MonthlyPlanDay[] = [];
  const fromWall = toTzWall(from, tz);
  let cursor = fromTzWall(new Date(Date.UTC(fromWall.getUTCFullYear(), fromWall.getUTCMonth(), fromWall.getUTCDate())), tz);
  if (cursor.getTime() < from.getTime()) {
    const wall = toTzWall(cursor, tz);
    cursor = fromTzWall(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1)), tz);
  }
  while (cursor.getTime() < to.getTime()) {
    const wall = toTzWall(cursor, tz);
    const key = wall.toISOString().slice(0, 10);
    const weekday = wall.getUTCDay();
    out.push({
      key,
      label: `${String(wall.getUTCDate()).padStart(2, "0")}.${String(wall.getUTCMonth() + 1).padStart(2, "0")}`,
      weekday,
      weekend: weekday === 0 || weekday === 6
    });
    cursor = fromTzWall(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1)), tz);
    if (out.length >= 400) break;
  }
  return out;
}

function dayBounds(key: string, tzOffsetMinutes: number): { start: Date; noon: Date; next: Date } {
  const [y, m, d] = key.split("-").map(Number);
  const start = fromTzWall(new Date(Date.UTC(y, m - 1, d)), tzOffsetMinutes);
  const noon = fromTzWall(new Date(Date.UTC(y, m - 1, d, 12)), tzOffsetMinutes);
  const next = fromTzWall(new Date(Date.UTC(y, m - 1, d + 1)), tzOffsetMinutes);
  return { start, noon, next };
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

export function occupancyForEvent(
  startAt: Date,
  endAt: Date,
  days: MonthlyPlanDay[],
  tzOffsetMinutes: number
): MonthlyPlanHalfFlags[] {
  const a0 = startAt.getTime();
  const a1 = endAt.getTime();
  return days.map((day) => {
    const { start, noon, next } = dayBounds(day.key, tzOffsetMinutes);
    return {
      day: overlaps(a0, a1, start.getTime(), noon.getTime()),
      evening: overlaps(a0, a1, noon.getTime(), next.getTime())
    };
  });
}

function metricHours(
  metrics: MonthlyBasePlanEventInput["metrics"],
  block: "WP_PLAN_MPS" | "LABOR_BUDGET"
): { day: number; evening: number } {
  let day = 0;
  let evening = 0;
  for (const m of metrics) {
    if (m.block !== block || m.manHours == null || !Number.isFinite(m.manHours)) continue;
    if (m.department === "INT") evening += m.manHours;
    else day += m.manHours;
  }
  return { day, evening };
}

function isEveningSkillOrShift(skillCode: string | null, shiftCode: string | null, shiftStartMin: number | null): boolean {
  if (skillCodeToDepartment(skillCode) === "INT") return true;
  const code = String(shiftCode ?? "").toUpperCase();
  if (code === "NIGHT" || code.includes("EVE") || code.includes("ВЕЧ")) return true;
  if (shiftStartMin != null && shiftStartMin >= 12 * 60) return true;
  return false;
}

function laborFromPlanLines(
  lines: MonthlyBasePlanEventInput["planLines"],
  days: MonthlyPlanDay[],
  tzOffsetMinutes: number,
  occupied: MonthlyPlanHalfFlags[]
): MonthlyPlanHalfHours[] | null {
  const byKey = new Map(days.map((d) => [d.key, { day: 0, evening: 0 }]));
  const occByKey = new Map(days.map((d, i) => [d.key, occupied[i] ?? { day: false, evening: false }]));
  let any = false;
  for (const line of lines) {
    const hours = line.plannedMinutes / 60;
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const key = tzDateKey(line.date, tzOffsetMinutes);
    const bucket = byKey.get(key);
    const occ = occByKey.get(key);
    if (!bucket || !occ) continue;
    const preferEvening = isEveningSkillOrShift(line.skillCode, line.shiftCode, line.shiftStartMin);
    const half = pickOccupiedHalf(occ, preferEvening);
    if (!half) continue;
    any = true;
    bucket[half] += hours;
  }
  if (!any) return null;
  return days.map((d) => {
    const v = byKey.get(d.key)!;
    return { day: round1(v.day), evening: round1(v.evening) };
  });
}

function pickOccupiedHalf(occ: MonthlyPlanHalfFlags, preferEvening: boolean): "day" | "evening" | null {
  if (preferEvening) {
    if (occ.evening) return "evening";
    if (occ.day) return "day";
    return null;
  }
  if (occ.day) return "day";
  if (occ.evening) return "evening";
  return null;
}

function spreadHours(
  dayHours: number,
  eveningHours: number,
  occupied: MonthlyPlanHalfFlags[]
): MonthlyPlanHalfHours[] {
  const dayIdx = occupied.flatMap((o, i) => (o.day ? [i] : []));
  const eveIdx = occupied.flatMap((o, i) => (o.evening ? [i] : []));
  const out = occupied.map(() => ({ day: 0, evening: 0 }));

  const add = (hours: number, indexes: number[], field: "day" | "evening") => {
    if (hours <= 0 || indexes.length === 0) return false;
    const per = hours / indexes.length;
    for (const i of indexes) out[i]![field] = round1(out[i]![field] + per);
    return true;
  };

  if (!add(dayHours, dayIdx, "day")) add(dayHours, eveIdx, "evening");
  if (!add(eveningHours, eveIdx, "evening")) add(eveningHours, dayIdx, "day");
  return out;
}

function laborTotalOf(labor: MonthlyPlanHalfHours[]): number {
  return round1(labor.reduce((s, x) => s + x.day + x.evening, 0));
}

function emptyQualifications(): MonthlyPlanQualifications {
  return { ME: 0, AV: 0, INT: 0, NDT: 0, SHOP: 0, CAB_REP: 0 };
}

function qualificationsFor(
  ev: MonthlyBasePlanEventInput,
  laborSource: MonthlyPlanLaborSource
): MonthlyPlanQualifications {
  const out = emptyQualifications();
  if (laborSource === "plan_lines") {
    for (const line of ev.planLines) {
      const hours = line.plannedMinutes / 60;
      if (!Number.isFinite(hours) || hours <= 0) continue;
      const dep = skillCodeToDepartment(line.skillCode) ?? "ME";
      out[dep] += hours;
    }
  } else {
    const block = laborSource === "budget" ? "LABOR_BUDGET" : "WP_PLAN_MPS";
    for (const m of ev.metrics) {
      if (m.block !== block || m.manHours == null || !Number.isFinite(m.manHours)) continue;
      if ((PRIMARY_METRIC_DEPARTMENTS as readonly string[]).includes(m.department)) {
        out[m.department as PrimaryMetricDepartmentCode] += m.manHours;
      }
    }
  }
  for (const dep of PRIMARY_METRIC_DEPARTMENTS) out[dep] = round1(out[dep]);
  return out;
}

export function buildMonthlyBasePlan(params: {
  from: Date;
  to: Date;
  tzOffsetMinutes: number;
  events: MonthlyBasePlanEventInput[];
}): MonthlyBasePlanResult {
  const days = buildTzDays(params.from, params.to, params.tzOffsetMinutes);
  const events: MonthlyBasePlanEventRow[] = [];

  for (const ev of params.events) {
    const occupied = occupancyForEvent(ev.startAt, ev.endAt, days, params.tzOffsetMinutes);
    if (!occupied.some((o) => o.day || o.evening)) continue;

    const fromLines = laborFromPlanLines(ev.planLines, days, params.tzOffsetMinutes, occupied);
    let labor: MonthlyPlanHalfHours[];
    let laborSource: MonthlyPlanLaborSource;
    if (fromLines) {
      labor = fromLines;
      laborSource = "plan_lines";
    } else {
      const mps = metricHours(ev.metrics, "WP_PLAN_MPS");
      const budget = metricHours(ev.metrics, "LABOR_BUDGET");
      if (mps.day + mps.evening > 0) {
        labor = spreadHours(mps.day, mps.evening, occupied);
        laborSource = "mps";
      } else if (budget.day + budget.evening > 0) {
        labor = spreadHours(budget.day, budget.evening, occupied);
        laborSource = "budget";
      } else {
        labor = occupied.map(() => ({ day: 0, evening: 0 }));
        laborSource = "none";
      }
    }

    events.push({
      eventId: ev.eventId,
      title: ev.title,
      aircraft: ev.aircraftLabel,
      aircraftType: ev.aircraftTypeName,
      operatorCode: ev.operatorCode,
      operatorId: ev.operatorId,
      aircraftId: ev.aircraftId,
      aircraftTypeId: ev.aircraftTypeId,
      eventTypeId: ev.eventTypeId,
      hangarId: ev.hangarId,
      hangarName: ev.hangarName || "Без ангара",
      workshopId: ev.workshopId,
      workshopName: ev.workshopName || "Без цеха",
      color: ev.color,
      startAt: ev.startAt.toISOString(),
      endAt: ev.endAt.toISOString(),
      laborSource,
      laborTotal: laborTotalOf(labor),
      qualifications: qualificationsFor(ev, laborSource),
      occupied,
      labor
    });
  }

  events.sort((a, b) => {
    const h = a.hangarName.localeCompare(b.hangarName, "ru");
    if (h !== 0) return h;
    const w = a.workshopName.localeCompare(b.workshopName, "ru");
    if (w !== 0) return w;
    return a.startAt.localeCompare(b.startAt);
  });

  const shopMap = new Map<string, MonthlyBasePlanShopRow>();
  for (const ev of events) {
    const id = ev.workshopId ?? `name:${ev.workshopName}`;
    let shop = shopMap.get(id);
    if (!shop) {
      shop = {
        workshopId: id,
        workshopName: ev.workshopName,
        planned: days.map(() => 0),
        plannedWithNrc: days.map(() => 0)
      };
      shopMap.set(id, shop);
    }
    for (let i = 0; i < days.length; i++) {
      shop.planned[i] += (ev.labor[i]?.day ?? 0) + (ev.labor[i]?.evening ?? 0);
    }
  }
  const shops = Array.from(shopMap.values())
    .map((s) => ({
      ...s,
      planned: s.planned.map(round1),
      plannedWithNrc: s.planned.map((v) => round1(v * MONTHLY_BASE_PLAN_NRC_FACTOR))
    }))
    .sort((a, b) => a.workshopName.localeCompare(b.workshopName, "ru"));

  const laborTotal = round1(events.reduce((s, e) => s + e.laborTotal, 0));
  return {
    nrcFactor: MONTHLY_BASE_PLAN_NRC_FACTOR,
    days,
    events,
    shops,
    summary: {
      events: events.length,
      shops: shops.length,
      laborTotal,
      laborWithNrc: round1(laborTotal * MONTHLY_BASE_PLAN_NRC_FACTOR),
      withPlanLines: events.filter((e) => e.laborSource === "plan_lines").length,
      withSpreadLabor: events.filter((e) => e.laborSource === "mps" || e.laborSource === "budget").length,
      withoutLabor: events.filter((e) => e.laborSource === "none").length
    }
  };
}
