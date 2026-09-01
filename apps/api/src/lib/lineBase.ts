export const LINE_BASE_VALUES = ["LINE", "BASE"] as const;
export type LineBase = (typeof LINE_BASE_VALUES)[number];

export function parseLineBase(value: unknown): LineBase | null {
  return value === "LINE" || value === "BASE" ? value : null;
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
