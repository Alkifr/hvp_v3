import dayjs from "dayjs";

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (n1 === 1) return one;
  if (n1 >= 2 && n1 <= 4) return few;
  return many;
}

/** Возраст ВС по дате производства: «12 лет» / «12 лет 3 месяца». */
export function formatAircraftAge(manufactureDate: string | Date | null | undefined, at: Date = new Date()): string | null {
  if (!manufactureDate) return null;
  const start = dayjs(manufactureDate).startOf("day");
  const now = dayjs(at).startOf("day");
  if (!start.isValid() || start.isAfter(now)) return null;

  const years = now.diff(start, "year");
  const months = now.diff(start.add(years, "year"), "month");
  const yearPart = `${years} ${pluralRu(years, "год", "года", "лет")}`;
  if (months <= 0) return yearPart;
  return `${yearPart} ${months} ${pluralRu(months, "месяц", "месяца", "месяцев")}`;
}

/** ISO / Date → значение для `<input type="date">`. */
export function toDateInputValue(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = dayjs(v);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
}

/** Значение date-input → ISO UTC midnight для API. */
export function dateInputToIso(v: string): string | null {
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = dayjs(s);
  if (!d.isValid() || d.format("YYYY-MM-DD") !== s) return null;
  return `${s}T00:00:00.000Z`;
}

export function formatManufactureDateRu(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = dayjs(v);
  return d.isValid() ? d.format("DD.MM.YYYY") : null;
}
