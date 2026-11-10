const COMPLETE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** Число из черновика поля. Пустая и незаконченная строка — не число. */
export function parseDraftNumber(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text || !COMPLETE_NUMBER.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Число, которое можно записать в состояние прямо во время набора.
 * Пустая строка, минус и «12.» сюда не попадают: иначе поле нельзя очистить
 * и набрать другое число.
 */
export function liveDraftNumber(raw: string, min: number, max: number, decimal = false): number | null {
  const pattern = decimal
    ? min < 0
      ? /^-?\d+(\.\d+)?$/
      : /^\d+(\.\d+)?$/
    : min < 0
      ? /^-?\d+$/
      : /^\d+$/;
  if (!pattern.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export function liveDraftInteger(raw: string, min: number, max: number): number | null {
  return liveDraftNumber(raw, min, max, false);
}

/** Значение после ухода из поля: пустой ввод оставляет прежнее число, выход за границы поджимается. */
export function commitDraftNumber(
  raw: string,
  current: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  decimal = false
): number {
  const n = parseDraftNumber(raw);
  if (n == null) return current;
  const next = decimal ? n : Math.round(n);
  return Math.min(max, Math.max(min, next));
}
