const MS_HOUR = 3_600_000;
const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь"
];

type Row = Record<string, unknown>;

function date(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function num(row: Row, column: string): number | null {
  const value = row[`primary.${column.toLowerCase()}`];
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function set(row: Row, column: string, value: unknown): void {
  row[`primary.${column.toLowerCase()}`] = value;
}

function sum(row: Row, columns: string[]): number | null {
  const values = columns.map((column) => num(row, column)).filter((value): value is number => value != null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function ratio(numerator: number | null, denominator: number | null, minusOne = false): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator - (minusOne ? 1 : 0);
}

function elapsedMs(start: unknown, end: unknown): number | null {
  const from = date(start);
  const to = date(end);
  if (!from || !to || to < from) return null;
  return to.getTime() - from.getTime();
}

export function durationHours(start: unknown, end: unknown): number | null {
  const ms = elapsedMs(start, end);
  if (ms == null) return null;
  return Math.round((ms / MS_HOUR) * 100) / 100;
}

export function durationDays(start: unknown, end: unknown): number | null {
  const ms = elapsedMs(start, end);
  if (ms == null) return null;
  return Math.round((ms / (24 * MS_HOUR)) * 100) / 100;
}

const SLOT_DURATION_KEYS = new Set([
  "primary.t",
  "primary.w",
  "primary.ab",
  "primary.ac",
  "primary.ao",
  "primary.ap",
  "primary.aq",
  "primary.as",
  "primary.at"
]);

export function isSlotDurationColumn(column: { key?: string; label?: string | null }): boolean {
  if (column.label && /продолжительность/i.test(column.label)) return true;
  return Boolean(column.key && SLOT_DURATION_KEYS.has(column.key));
}

export function inclusiveCalendarDays(start: unknown, end: unknown): number | null {
  const from = date(start);
  const to = date(end);
  if (!from || !to) return null;
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  if (toDay < fromDay) return null;
  return Math.floor((toDay - fromDay) / (24 * MS_HOUR)) + 1;
}

function weekLabel(value: unknown): string | null {
  const d = date(value);
  if (!d) return null;
  const day = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1));
  const sunday = new Date(monday.getTime() + 6 * 24 * MS_HOUR);
  const dd = (x: Date) => String(x.getUTCDate()).padStart(2, "0");
  const mm = (x: Date) => String(x.getUTCMonth() + 1).padStart(2, "0");
  return `${dd(monday)}-${dd(sunday)}.${mm(sunday)}.${sunday.getUTCFullYear()}`;
}

function yearsBetween(start: unknown, end: unknown): number | null {
  const from = date(start);
  const to = date(end);
  if (!from || !to || to < from) return null;
  const years = (to.getTime() - from.getTime()) / (365.2425 * 24 * MS_HOUR);
  return Math.round(years * 10) / 10;
}

export function applyPrimaryTableFormulas(row: Row): Row {
  const planStart = row["primary.y"];
  const planEnd = row["primary.z"];
  const budgetStart = row["primary.u"];
  const budgetEnd = row["primary.v"];
  const actualStart = row["primary.al"];
  const actualEnd = row["primary.am"];
  const customerStart = row["primary.q"];
  const customerEnd = row["primary.r"];
  const calendarBasis = date(actualEnd) ?? date(planEnd);

  set(row, "B", calendarBasis?.getUTCFullYear() ?? null);
  set(row, "C", calendarBasis ? MONTHS_RU[calendarBasis.getUTCMonth()] : null);
  set(row, "D", weekLabel(planEnd));
  set(row, "J", yearsBetween(row["primary.i"], planStart));
  set(row, "T", inclusiveCalendarDays(customerStart, customerEnd));
  set(row, "W", inclusiveCalendarDays(budgetStart, budgetEnd));
  set(row, "AB", durationDays(planStart, planEnd));
  set(row, "AC", durationHours(planStart, planEnd));
  set(row, "AO", durationDays(actualStart, actualEnd));
  set(row, "AP", durationHours(actualStart, actualEnd));
  set(row, "AQ", num(row, "W") != null && num(row, "AO") != null ? num(row, "W")! - num(row, "AO")! : null);
  set(row, "AS", num(row, "AB") != null && num(row, "AO") != null ? num(row, "AB")! - num(row, "AO")! : null);
  set(row, "AT", num(row, "AC") != null && num(row, "AP") != null ? num(row, "AC")! - num(row, "AP")! : null);
  set(
    row,
    "AV",
    date(actualStart) && date(budgetStart)
      ? date(actualStart)!.toISOString().slice(0, 10) === date(budgetStart)!.toISOString().slice(0, 10)
        ? "Нет отклонений"
        : "Есть отклонение"
      : null
  );

  set(row, "BD", sum(row, ["AX", "AY", "AZ", "BA", "BB", "BC"]));
  set(row, "BE", ratio(num(row, "BD"), num(row, "AB")));
  set(row, "BL", sum(row, ["BF", "BG", "BH", "BI", "BJ", "BK"]));
  set(row, "BM", ratio(num(row, "BL"), num(row, "AO")));
  set(row, "BN", num(row, "BD") != null && num(row, "BL") != null ? num(row, "BD")! - num(row, "BL")! : null);

  for (const [total, columns] of [
    ["BU", ["BO", "BP", "BQ", "BR", "BS", "BT"]],
    ["CB", ["BV", "BW", "BX", "BY", "BZ", "CA"]],
    ["CI", ["CC", "CD", "CE", "CF", "CG", "CH"]],
    ["CP", ["CJ", "CK", "CL", "CM", "CN", "CO"]],
    ["CX", ["CR", "CS", "CT", "CU", "CV", "CW"]],
    ["DN", ["DH", "DI", "DJ", "DK", "DL", "DM"]],
    ["DU", ["DO", "DP", "DQ", "DR", "DS", "DT"]],
    ["EB", ["DV", "DW", "DX", "DY", "DZ", "EA"]],
    ["EJ", ["ED", "EE", "EF", "EG", "EH", "EI"]],
    ["FV", ["FP", "FQ", "FR", "FS", "FT", "FU"]]
  ] as const) {
    set(row, total, sum(row, [...columns]));
  }

  set(row, "CZ", sum(row, ["BU", "CB", "CI", "CP", "CX"]));
  const planDept = [
    ["DA", ["BO", "BV", "CC", "CJ", "CR"]],
    ["DB", ["BP", "BW", "CD", "CK", "CS"]],
    ["DD", ["BQ", "BX", "CE", "CL", "CT"]],
    ["DE", ["BR", "BY", "CF", "CM", "CU"]],
    ["DF", ["BS", "BZ", "CG", "CN", "CV"]],
    ["DG", ["BT", "CA", "CH", "CO", "CW"]]
  ] as const;
  for (const [column, inputs] of planDept) set(row, column, sum(row, [...inputs]));
  set(row, "DC", sum(row, ["DA", "DB"]));

  set(row, "EC", (() => {
    const value = ratio(num(row, "EB"), sum(row, ["DN", "DU", "EJ"]));
    return value == null ? null : value * 100;
  })());
  set(row, "EK", num(row, "EJ"));
  set(row, "EL", sum(row, ["DN", "DU", "EB", "EJ"]));
  for (const [column, left, right] of [
    ["EM", "CQ", "EC"],
    ["EN", "CY", "EK"],
    ["EO", "CZ", "EL"],
    ["FW", "FV", "EL"]
  ]) {
    set(row, column, num(row, left) != null && num(row, right) != null ? num(row, left)! - num(row, right)! : null);
  }
  set(
    row,
    "EP",
    calendarBasis ? `${Math.ceil((calendarBasis.getUTCMonth() + 1) / 3)}кв.${calendarBasis.getUTCFullYear()}` : null
  );

  const actualDept = [
    ["EQ", ["DH", "DI", "DO", "DP", "ED", "EE"]],
    ["ER", ["DV", "DW"]],
    ["ET", ["DJ", "DQ", "EF"]],
    ["EU", ["DX"]],
    ["EW", ["DK", "DR", "EG"]],
    ["EX", ["DY"]],
    ["EZ", ["DL", "DS", "EH"]],
    ["FA", ["DZ"]],
    ["FC", ["DM", "DT", "EI"]],
    ["FD", ["EA"]]
  ] as const;
  for (const [column, inputs] of actualDept) set(row, column, sum(row, [...inputs]));

  for (const [column, actual, planned] of [
    ["ES", ["EQ", "ER"], ["AX", "AY"]],
    ["EV", ["ET", "EU"], ["AZ"]],
    ["EY", ["EW", "EX"], ["BA"]],
    ["FB", ["EZ", "FA"], ["BB"]],
    ["FE", ["FC", "FD"], ["BC"]]
  ] as const) {
    set(row, column, ratio(sum(row, [...actual]), sum(row, [...planned]), true));
  }
  for (const [column, inputs] of [
    ["FF", ["EQ", "ER"]],
    ["FG", ["ET", "EU"]],
    ["FH", ["EW", "EX"]],
    ["FI", ["EZ", "FA"]],
    ["FJ", ["FC", "FD"]]
  ] as const) {
    set(row, column, ratio(sum(row, [...inputs]), num(row, "AO")));
  }
  set(row, "FK", sum(row, ["FF", "FG", "FH", "FI", "FJ"]));
  set(row, "FL", sum(row, ["EQ", "ER", "ET", "EU", "EW", "EX", "FC", "FD"]));
  set(row, "FM", sum(row, ["EQ", "ER", "ET", "EU", "EW", "EX", "EZ", "FA", "FC", "FD"]));
  set(row, "FN", ratio(num(row, "FL"), sum(row, ["AX", "AY", "AZ", "BA", "BC"]), true));
  set(row, "FO", ratio(num(row, "FM"), num(row, "BD"), true));

  return row;
}
