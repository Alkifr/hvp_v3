export const LINE_BASE_VALUES = ["LINE", "BASE"] as const;
export type LineBase = (typeof LINE_BASE_VALUES)[number];

export const LINE_BASE_LABEL: Record<LineBase, string> = {
  LINE: "L (Line)",
  BASE: "B (Base)"
};

export function parseLineBase(value: unknown): LineBase | null {
  return value === "LINE" || value === "BASE" ? value : null;
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
