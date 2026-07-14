import dayjs from "dayjs";

/** Для `<input type="date">`: пусто или неполный ввод — ещё не валидная дата. */
export function isValidDateInput(v: string): boolean {
  if (!v) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = dayjs(v);
  return d.isValid() && d.format("YYYY-MM-DD") === v;
}

export function parseDateInputStart(v: string): dayjs.Dayjs | null {
  if (!isValidDateInput(v)) return null;
  return dayjs(v).startOf("day");
}

export function parseDateInputEnd(v: string): dayjs.Dayjs | null {
  if (!isValidDateInput(v)) return null;
  return dayjs(v).endOf("day");
}
