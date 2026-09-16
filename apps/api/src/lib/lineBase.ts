export const LINE_BASE_VALUES = ["LINE", "BASE"] as const;
export type LineBase = (typeof LINE_BASE_VALUES)[number];

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

export function resolveEventLineBase(params: {
  requested?: LineBase | null;
  requestedProvided: boolean;
  workshopDefault: LineBase | null;
  stored?: LineBase | null;
  workshopChanged?: boolean;
}): LineBase | null {
  if (params.requestedProvided) return params.requested ?? null;
  if (params.workshopChanged) return params.workshopDefault ?? params.stored ?? null;
  if (params.stored !== undefined) return params.stored;
  return params.workshopDefault;
}

export async function loadWorkshopLineBase(
  prisma: any,
  workshopId: string | null | undefined
): Promise<LineBase | null> {
  if (!workshopId) return null;
  const workshop = await prisma.workshop.findUnique({
    where: { id: workshopId },
    select: { defaultLineBase: true }
  });
  return parseLineBase(workshop?.defaultLineBase);
}
