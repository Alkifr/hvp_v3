export const PERSONNEL_DEPARTMENTS = ["ME", "AV", "INT", "NDT", "SHOP", "CAB_REP", "PAINT"] as const;
export type PersonnelDepartment = (typeof PERSONNEL_DEPARTMENTS)[number];

export function departmentForSkillCode(code: string): PersonnelDepartment | null {
  return (PERSONNEL_DEPARTMENTS as readonly string[]).includes(code) ? (code as PersonnelDepartment) : null;
}

export type BalanceLine = {
  key: string;
  label: string;
  /** Отдел MPS, если справочник связывает категорию с плановой трудоёмкостью. */
  planDepartment: PersonnelDepartment | null;
  /** Откуда брать доступность: сумма отдела или часы самой категории. */
  supply: "department" | "qualification";
};

type BalanceCategory = {
  code: string;
  department: string | null;
  sortOrder?: number;
};

/** Колонки план/доступность повторяют категории справочника выбранных цехов. */
export function balanceColumns(categories: readonly BalanceCategory[]): {
  departments: PersonnelDepartment[];
  lines: BalanceLine[];
} {
  const grouped = new Map<string, BalanceLine & { sortOrder: number }>();
  for (const row of categories) {
    const sortOrder = row.sortOrder ?? 0;
    if (row.department && (PERSONNEL_DEPARTMENTS as readonly string[]).includes(row.department)) {
      const department = row.department as PersonnelDepartment;
      const existing = grouped.get(department);
      grouped.set(department, {
        key: department,
        label: department,
        planDepartment: department,
        supply: "department",
        sortOrder: Math.min(existing?.sortOrder ?? sortOrder, sortOrder)
      });
      continue;
    }
    if (grouped.has(row.code)) continue;
    grouped.set(row.code, {
      key: row.code,
      label: row.code,
      planDepartment: departmentForSkillCode(row.code),
      supply: "qualification",
      sortOrder
    });
  }
  const lines = [...grouped.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map(({ sortOrder: _sortOrder, ...line }) => line);
  const departments = PERSONNEL_DEPARTMENTS.filter((department) => lines.some((line) => line.planDepartment === department));
  return { departments, lines };
}

export type CatalogQualification = {
  code: string;
  department: string | null;
  isAuthorized: boolean;
  sortOrder?: number;
  name?: string;
};

/** Квалификации справочника, входящие в выбранные категории. Состав категорий в коде не задаётся. */
export function qualificationsForDepartments<T extends CatalogQualification>(
  qualifications: readonly T[],
  departments: readonly string[]
): T[] {
  const wanted = new Set(departments);
  return qualifications
    .filter((row) => row.department != null && wanted.has(row.department))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.code.localeCompare(b.code));
}

/** Категория цеха ME раскрывается в B1 и LBMM. Код вроде AM, не входящий в категорию, остаётся отдельной строкой. */
export function qualificationsForWorkshopSkills<T extends CatalogQualification>(
  qualifications: readonly T[],
  skillCodes: readonly string[]
): T[] {
  const departments = skillCodes
    .map((code) => departmentForSkillCode(code))
    .filter((code): code is PersonnelDepartment => Boolean(code));
  const direct = new Set(skillCodes);
  const seen = new Set<string>();
  return [...qualificationsForDepartments(qualifications, departments), ...qualifications.filter((row) => direct.has(row.code))]
    .filter((row) => {
      if (seen.has(row.code)) return false;
      seen.add(row.code);
      return true;
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.code.localeCompare(b.code));
}

export const DEFAULT_PERSONNEL_HOURS_NORM = 11;
export const DEFAULT_AIRCRAFT_MPS_FACTOR = 1.4;
const DAY_MS = 86_400_000;

export type EffectiveValue = { effectiveFrom: string; value: number };
export type PersonnelCategoryRule = {
  code: string;
  department: PersonnelDepartment | null;
  isAuthorized: boolean;
};
export type PersonnelDemandEvent = {
  id: string;
  startAt: Date;
  endAt: Date;
  status: string;
  aircraftTypeId: string;
  mpsHours: Partial<Record<PersonnelDepartment, number>>;
  title?: string;
  aircraftLabel?: string;
  eventType?: string;
  operator?: string;
  workshopId?: string | null;
  placements?: Array<{ startAt: Date; endAt: Date; label: string }>;
};
export type PersonnelAvailabilityInput = {
  date: string;
  categoryCode: string;
  headcount: number;
};

export function localDateKey(value: Date, timezoneOffsetMinutes = 180): string {
  return new Date(value.getTime() + timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function mondayOfLocalWeek(value: Date | string, timezoneOffsetMinutes = 180): string {
  const key = typeof value === "string" ? value.slice(0, 10) : localDateKey(value, timezoneOffsetMinutes);
  const day = new Date(`${key}T00:00:00.000Z`);
  const isoDay = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - isoDay + 1);
  return day.toISOString().slice(0, 10);
}

export function weekDateKeys(weekStart: string): string[] {
  const monday = mondayOfLocalWeek(weekStart);
  const start = new Date(`${monday}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * DAY_MS).toISOString().slice(0, 10));
}

/** Inclusive calendar dates, at most 31. */
export function periodDateKeys(from: string, to: string): string[] {
  const start = new Date(`${from.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${to.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const dates: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime() && dates.length < 31; cursor += DAY_MS) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

export function mondaysCovering(from: string, to: string): string[] {
  const mondays: string[] = [];
  for (const date of periodDateKeys(from, to)) {
    const monday = mondayOfLocalWeek(date);
    if (!mondays.includes(monday)) mondays.push(monday);
  }
  return mondays;
}

export function effectiveValue(
  rows: EffectiveValue[],
  date: string,
  fallback: number
): number {
  let selected = fallback;
  let selectedDate = "";
  for (const row of rows) {
    const effectiveFrom = row.effectiveFrom.slice(0, 10);
    if (effectiveFrom <= date && effectiveFrom >= selectedDate) {
      selected = row.value;
      selectedDate = effectiveFrom;
    }
  }
  return selected;
}

function dayBounds(date: string, timezoneOffsetMinutes: number): [number, number] {
  const start = new Date(`${date}T00:00:00.000Z`).getTime() - timezoneOffsetMinutes * 60_000;
  return [start, start + DAY_MS];
}

function zeroByDepartment(): Record<PersonnelDepartment, number> {
  return Object.fromEntries(PERSONNEL_DEPARTMENTS.map((department) => [department, 0])) as Record<
    PersonnelDepartment,
    number
  >;
}

export function summarizeResourceSlices(input: {
  weekStart: string;
  dates?: string[];
  events: PersonnelDemandEvent[];
  availability: Array<PersonnelAvailabilityInput & { workshopId: string; aircraftTypeId: string }>;
  categories: PersonnelCategoryRule[];
  demandDepartments?: PersonnelDepartment[];
  norms: EffectiveValue[];
  factorsByAircraftType: Record<string, EffectiveValue[]>;
  timezoneOffsetMinutes?: number;
}) {
  const keys = new Set<string>();
  for (const row of input.availability) keys.add(`${row.workshopId}|${row.aircraftTypeId}`);
  for (const event of input.events) keys.add(`${event.workshopId || ""}|${event.aircraftTypeId}`);
  return [...keys].flatMap((key) => {
    const splitAt = key.indexOf("|");
    const workshopId = key.slice(0, splitAt);
    const aircraftTypeId = key.slice(splitAt + 1);
    const days = calculatePersonnelWeek({
      weekStart: input.weekStart,
      dates: input.dates,
      events: input.events.filter((event) => event.aircraftTypeId === aircraftTypeId && (event.workshopId || "") === workshopId),
      availability: input.availability
        .filter((row) => row.workshopId === workshopId && row.aircraftTypeId === aircraftTypeId)
        .map((row) => ({ date: row.date, categoryCode: row.categoryCode, headcount: row.headcount })),
      categories: input.categories,
      demandDepartments: input.demandDepartments,
      norms: input.norms,
      factorsByAircraftType: input.factorsByAircraftType,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes
    });
    const planned = days.reduce((sum, day) => sum + day.overallDemand, 0);
    const available = days.reduce((sum, day) => sum + day.overallSupply, 0);
    if (planned <= 0.05 && available <= 0.05) return [];
    return [{ workshopId, aircraftTypeId, planned, available, difference: available - planned }];
  });
}

export function calculatePersonnelWeek(input: {
  weekStart: string;
  dates?: string[];
  events: PersonnelDemandEvent[];
  availability: PersonnelAvailabilityInput[];
  categories: PersonnelCategoryRule[];
  demandDepartments?: PersonnelDepartment[];
  norms: EffectiveValue[];
  factorsByAircraftType: Record<string, EffectiveValue[]>;
  timezoneOffsetMinutes?: number;
  includeEventDemand?: boolean;
}) {
  const timezoneOffsetMinutes = input.timezoneOffsetMinutes ?? 180;
  const demandDepartments = input.demandDepartments ?? [...PERSONNEL_DEPARTMENTS];
  const categoryByCode = new Map(input.categories.map((row) => [row.code, row]));
  const availabilityByDate = new Map<string, PersonnelAvailabilityInput[]>();
  for (const row of input.availability) {
    const date = row.date.slice(0, 10);
    availabilityByDate.set(date, [...(availabilityByDate.get(date) ?? []), row]);
  }
  const dates = input.dates?.length ? input.dates : weekDateKeys(input.weekStart);

  return dates.map((date) => {
    const demand = zeroByDepartment();
    const eventDemand: Array<{
      id: string;
      title: string;
      aircraftLabel: string;
      eventType: string;
      operator: string;
      placement: string;
      hours: number;
      byDepartment: Record<PersonnelDepartment, number>;
    }> = [];
    for (const event of input.events) {
      if (event.status === "CANCELLED" || event.status === "DELETED") continue;
      const duration = event.endAt.getTime() - event.startAt.getTime();
      if (duration <= 0) continue;
      const [dayStart, dayEnd] = dayBounds(date, timezoneOffsetMinutes);
      const overlap = Math.max(0, Math.min(event.endAt.getTime(), dayEnd) - Math.max(event.startAt.getTime(), dayStart));
      if (!overlap) continue;
      const factor = effectiveValue(
        input.factorsByAircraftType[event.aircraftTypeId] ?? [],
        date,
        DEFAULT_AIRCRAFT_MPS_FACTOR
      );
      const byDepartment = zeroByDepartment();
      for (const department of demandDepartments) {
        const hours = (event.mpsHours[department] ?? 0) * (overlap / duration) * factor;
        byDepartment[department] = hours;
        demand[department] += hours;
      }
      const hours = demandDepartments.reduce((sum, department) => sum + byDepartment[department], 0);
      if (input.includeEventDemand && hours > 0) {
        const overlapping = (event.placements ?? []).filter(
          (placement) => placement.endAt.getTime() > dayStart && placement.startAt.getTime() < dayEnd
        );
        const shown = overlapping.length ? overlapping : (event.placements ?? []);
        eventDemand.push({
          id: event.id,
          title: event.title ?? "",
          aircraftLabel: event.aircraftLabel ?? "",
          eventType: event.eventType ?? "",
          operator: event.operator ?? "",
          placement: shown.map((placement) => placement.label).filter(Boolean).join("; "),
          hours,
          byDepartment
        });
      }
    }
    eventDemand.sort((a, b) => b.hours - a.hours || a.title.localeCompare(b.title, "ru"));

    const authorizedSupply = zeroByDepartment();
    const qualificationSupply: Record<string, number> = {};
    let overallSupply = 0;
    const norm = effectiveValue(input.norms, date, DEFAULT_PERSONNEL_HOURS_NORM);
    for (const row of availabilityByDate.get(date) ?? []) {
      const category = categoryByCode.get(row.categoryCode);
      if (!category) continue;
      const hours = row.headcount * norm;
      overallSupply += hours;
      if (category.department) authorizedSupply[category.department] += hours;
      else qualificationSupply[category.code] = (qualificationSupply[category.code] ?? 0) + hours;
    }
    const strictBalance = zeroByDepartment();
    for (const department of PERSONNEL_DEPARTMENTS) {
      strictBalance[department] = authorizedSupply[department] - demand[department];
    }
    const overallDemand = demandDepartments.reduce((sum, department) => sum + demand[department], 0);
    const overallBalance = overallSupply - overallDemand;
    return {
      date,
      normHours: norm,
      demand,
      authorizedSupply,
      strictBalance,
      overallDemand,
      overallSupply,
      overallBalance,
      qualificationSupply,
      /** Backward-compatible name; value is workshop-scoped, not always PTO. */
      overallPtoBalance: overallBalance,
      ...(input.includeEventDemand ? { eventDemand } : {})
    };
  });
}
