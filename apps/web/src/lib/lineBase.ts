export const LINE_BASE_VALUES = ["LINE", "BASE"] as const;
export type LineBase = (typeof LINE_BASE_VALUES)[number];

export const LINE_BASE_LABEL: Record<LineBase, string> = {
  LINE: "L (Line)",
  BASE: "B (Base)"
};

export function parseLineBase(value: unknown): LineBase | null {
  return value === "LINE" || value === "BASE" ? value : null;
}

/** Разбор L/B из Excel/формы: LINE, L, Line, «L (Line)», линейный / BASE, B, Base и т.п. */
export function parseImportLineBase(value: unknown): LineBase | null {
  if (parseLineBase(value)) return parseLineBase(value);
  const raw = String(value ?? "")
    .normalize("NFKC")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!raw) return null;
  const compact = raw
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "");
  if (compact === "l" || compact === "line" || compact === "lline" || compact === "линейный" || compact === "линия") {
    return "LINE";
  }
  if (compact === "b" || compact === "base" || compact === "bbase" || compact === "базовый" || compact === "база") {
    return "BASE";
  }
  return parseLineBase(raw.toLocaleUpperCase("en-US"));
}

export function importLineBaseProvided(value: unknown): boolean {
  return String(value ?? "").trim() !== "";
}

export function formatLineBase(value: unknown): string {
  const parsed = parseLineBase(value);
  return parsed ? LINE_BASE_LABEL[parsed] : "—";
}

export function lineBaseFromWorkshop(
  workshop: { defaultLineBase?: string | null } | null | undefined
): LineBase | null {
  return parseLineBase(workshop?.defaultLineBase);
}

export function lineBaseAfterWorkshopChange(
  workshopId: string,
  workshops: Array<{ id: string; defaultLineBase?: string | null }>,
  current: LineBase | ""
): LineBase | "" {
  if (!workshopId) return current;
  return lineBaseFromWorkshop(workshops.find((w) => w.id === workshopId)) ?? current;
}
