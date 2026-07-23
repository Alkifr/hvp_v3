/** MSK fixed offset (no DST since 2014). East of UTC, minutes. */
export const MSK_OFFSET_MINUTES = 180;

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
  // Wall clock in target TZ → absolute instant
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
  // Excel serial days since 1899-12-30; fractional part = time of day (UTC wall via epoch math).
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

  // YYYY-MM-DD[ T]HH:mm[:ss[.sss]]
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

  // DD.MM.YYYY[ ]HH:mm[:ss]  or DD/MM/YYYY
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
 * Parse import date/time. Naive values (Excel serial, date-only, datetime without offset)
 * are wall-clock in MSK by default. Values with Z / numeric offset stay absolute.
 */
export function parseImportDateTime(
  v: string | number | Date,
  tzOffsetMinutes: number = MSK_OFFSET_MINUTES
): Date {
  if (v instanceof Date) {
    if (!Number.isFinite(v.valueOf())) throw new Error(`Некорректная дата: ${String(v)}`);
    return v;
  }

  if (typeof v === "number") {
    const parts = excelSerialToParts(v);
    if (!parts) throw new Error(`Некорректная дата (Excel): ${String(v)}`);
    return fromWallClock(parts.y, parts.m, parts.d, parts.H, parts.M, parts.S, parts.ms, tzOffsetMinutes);
  }

  const s = String(v).trim();
  if (!s) throw new Error("Пустая дата");

  if (hasExplicitOffset(s)) {
    const d = new Date(s);
    if (!Number.isFinite(d.valueOf())) throw new Error(`Некорректная дата: ${s}`);
    return d;
  }

  const parts = parseNaiveParts(s);
  if (parts) {
    return fromWallClock(parts.y, parts.m, parts.d, parts.H, parts.M, parts.S, parts.ms, tzOffsetMinutes);
  }

  // Last resort: Date ctor (may use process TZ for some shapes)
  const d = new Date(s);
  if (!Number.isFinite(d.valueOf())) throw new Error(`Некорректная дата: ${s}`);
  return d;
}
