import dayjs from "dayjs";

/** MSK fixed offset (no DST since 2014). East of UTC, minutes. */
export const MSK_OFFSET_MINUTES = 180;

const IMPORT_DATE_KEYS = [
  "startAt",
  "endAt",
  "budgetStartAt",
  "budgetEndAt",
  "actualStartAt",
  "actualEndAt",
  "towStartAt",
  "towEndAt"
] as const;

function fromWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  tzOffsetMinutes: number
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  return new Date(asUtc - tzOffsetMinutes * 60_000);
}

function hasExplicitOffset(s: string): boolean {
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(s.trim());
}

type DateParts = {
  y: number;
  m: number;
  d: number;
  H: number;
  M: number;
  S: number;
  ms: number;
};

function excelSerialToParts(serial: number): DateParts | null {
  if (!Number.isFinite(serial)) return null;
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  const wall = new Date(utcMs);
  if (!Number.isFinite(wall.valueOf())) return null;
  return {
    y: wall.getUTCFullYear(),
    m: wall.getUTCMonth() + 1,
    d: wall.getUTCDate(),
    H: wall.getUTCHours(),
    M: wall.getUTCMinutes(),
    S: wall.getUTCSeconds(),
    ms: wall.getUTCMilliseconds()
  };
}

function parseNaiveParts(raw: string): DateParts | null {
  const s = raw.trim();
  if (!s) return null;

  let m = s.match(
    /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?)?$/
  );
  if (m) {
    return {
      y: Number(m[1]),
      m: Number(m[2]),
      d: Number(m[3]),
      H: Number(m[4] ?? 0),
      M: Number(m[5] ?? 0),
      S: Number(m[6] ?? 0),
      ms: Number((m[7] ?? "0").padEnd(3, "0"))
    };
  }

  m = s.match(
    /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?)?$/
  );
  if (m) {
    const yRaw = m[3]!;
    const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    return {
      y,
      m: Number(m[2]),
      d: Number(m[1]),
      H: Number(m[4] ?? 0),
      M: Number(m[5] ?? 0),
      S: Number(m[6] ?? 0),
      ms: Number((m[7] ?? "0").padEnd(3, "0"))
    };
  }

  return null;
}

/**
 * Convert a cell value to an absolute ISO instant.
 * Naive Excel serial / date strings → MSK wall clock. Absolute ISO left as-is.
 * Date instances (e.g. from SheetJS cellDates) are already absolute.
 */
export function cellToIsoLocal(
  v: unknown,
  tzOffsetMinutes: number = MSK_OFFSET_MINUTES
): string | null {
  if (v == null) return null;
  if (typeof v === "string" && v.trim() === "") return null;

  if (v instanceof Date) {
    if (!Number.isFinite(v.valueOf())) return null;
    return v.toISOString();
  }

  if (typeof v === "number") {
    const parts = excelSerialToParts(v);
    if (!parts) return null;
    return fromWallClock(parts.y, parts.m, parts.d, parts.H, parts.M, parts.S, parts.ms, tzOffsetMinutes).toISOString();
  }

  const s = String(v).trim();
  if (hasExplicitOffset(s)) {
    const d = new Date(s);
    return Number.isFinite(d.valueOf()) ? d.toISOString() : null;
  }

  const parts = parseNaiveParts(s);
  if (parts) {
    return fromWallClock(parts.y, parts.m, parts.d, parts.H, parts.M, parts.S, parts.ms, tzOffsetMinutes).toISOString();
  }

  const d = dayjs(s);
  return d.isValid() ? d.toISOString() : null;
}

/** Normalize import row date columns to ISO strings (MSK for naive values). */
export function normalizeImportRowDates<T extends Record<string, unknown>>(row: T): T {
  const next: Record<string, unknown> = { ...row };
  for (const key of IMPORT_DATE_KEYS) {
    if (!(key in next)) continue;
    const iso = cellToIsoLocal(next[key]);
    if (iso != null) next[key] = iso;
  }
  return next as T;
}

export function normalizeImportRowsDates(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => normalizeImportRowDates(row));
}

/** YYYY-MM-DD → 00:00:00.000 MSK as ISO. */
export function startOfMskDayIso(dateStr: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return fromWallClock(y!, m!, d!, 0, 0, 0, 0, MSK_OFFSET_MINUTES).toISOString();
}

/** YYYY-MM-DD → 23:59:59.999 MSK as ISO. */
export function endOfMskDayIso(dateStr: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return fromWallClock(y!, m!, d!, 23, 59, 59, 999, MSK_OFFSET_MINUTES).toISOString();
}

/** `datetime-local` / naive string → ISO instant in MSK. */
export function fromInputMskOptional(value: string): string | null {
  if (!value) return null;
  return cellToIsoLocal(value.replace("T", " "));
}
