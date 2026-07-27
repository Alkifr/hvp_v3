import type { PrimaryFieldType } from "./types.js";

export function parsePrimaryDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return null;

  const text = value.trim();
  const iso = new Date(text);
  if (Number.isFinite(iso.getTime())) return iso;

  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Пользовательский формат для preview/CSV: дата или дата+время. */
export function formatPrimaryDateDisplay(value: unknown, type: PrimaryFieldType): string | null {
  const date = parsePrimaryDate(value);
  if (!date) return null;
  const day = pad2(date.getUTCDate());
  const month = pad2(date.getUTCMonth() + 1);
  const year = date.getUTCFullYear();
  if (type === "date") return `${day}.${month}.${year}`;
  const hour = pad2(date.getUTCHours());
  const minute = pad2(date.getUTCMinutes());
  return `${day}.${month}.${year} ${hour}:${minute}`;
}

/** Значение для Excel: Date + numFmt (нужен useStyles у WorkbookWriter). */
export function toExcelDateValue(value: unknown, type: PrimaryFieldType): { value: Date; numFmt: string } | null {
  const date = parsePrimaryDate(value);
  if (!date) return null;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const hh = type === "date" ? 0 : date.getUTCHours();
  const mm = type === "date" ? 0 : date.getUTCMinutes();
  const ss = type === "date" ? 0 : date.getUTCSeconds();
  // Локальный Date с UTC wall-clock числами — ExcelJS пишет их как дату без сдвига дня.
  return {
    value: new Date(y, m, d, hh, mm, ss),
    numFmt: type === "date" ? "dd.mm.yyyy" : "dd.mm.yyyy hh:mm"
  };
}

export function isTemporalPrimaryType(type: PrimaryFieldType): type is "date" | "datetime" {
  return type === "date" || type === "datetime";
}
