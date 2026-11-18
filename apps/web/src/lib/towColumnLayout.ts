export type TowColumnPref = {
  hidden: string[];
  widths: Record<string, number>;
};

const MIN_WIDTH = 56;
const MAX_WIDTH = 1200;

export function readTowColumnPref(raw: unknown): TowColumnPref {
  if (!raw || typeof raw !== "object") return { hidden: [], widths: {} };
  const value = raw as { hidden?: unknown; widths?: unknown };
  const hidden = Array.isArray(value.hidden) ? value.hidden.map(String).filter(Boolean) : [];
  const widths: Record<string, number> = {};
  if (value.widths && typeof value.widths === "object") {
    for (const [key, width] of Object.entries(value.widths as Record<string, unknown>)) {
      const n = typeof width === "number" ? width : Number(width);
      if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) widths[key] = Math.round(n);
    }
  }
  return { hidden, widths };
}

export function columnWidth(saved: number | undefined, fallback: number): number {
  const source = typeof saved === "number" && Number.isFinite(saved) ? saved : fallback;
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, source)));
}

/** Hidden keys that are not locked. At least one data column stays visible. Order follows `all`. */
export function hiddenColumnKeys(all: readonly string[], hidden: readonly string[], locked: readonly string[]): string[] {
  const lockedSet = new Set(locked);
  const hiddenSet = new Set(hidden.filter((key) => all.includes(key) && !lockedSet.has(key)));
  const dataVisible = all.filter((key) => !lockedSet.has(key) && !hiddenSet.has(key));
  if (dataVisible.length === 0) {
    const fallback = all.find((key) => !lockedSet.has(key));
    if (fallback) hiddenSet.delete(fallback);
  }
  return all.filter((key) => hiddenSet.has(key));
}

export function visibleColumnKeys(all: readonly string[], hidden: readonly string[], locked: readonly string[] = []): string[] {
  const hiddenSet = new Set(hiddenColumnKeys(all, hidden, locked));
  const lockedSet = new Set(locked);
  return all.filter((key) => lockedSet.has(key) || !hiddenSet.has(key));
}

/** How many lines a string needs inside a column of `widthPx`. */
export function estimateLines(text: string, widthPx: number): number {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return 1;
  const chars = Math.max(4, Math.floor((Math.max(MIN_WIDTH, widthPx) - 24) / 7.2));
  const words = value.split(" ");
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (word.length > chars) {
      if (used > 0) {
        lines += 1;
        used = 0;
      }
      const chunks = Math.ceil(word.length / chars);
      lines += chunks - 1;
      used = word.length % chars;
      continue;
    }
    const next = used === 0 ? word.length : used + 1 + word.length;
    if (next > chars) {
      lines += 1;
      used = word.length;
    } else {
      used = next;
    }
  }
  return lines;
}

export function wrappedBlockSize(cells: Array<{ text: string; width: number }>, min = 42, max = 240): number {
  let lines = 1;
  for (const cell of cells) lines = Math.max(lines, estimateLines(cell.text, cell.width));
  return Math.min(max, Math.max(min, 16 + lines * 20));
}
