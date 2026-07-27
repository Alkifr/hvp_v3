export const AUTO_GAP_MIN_MS = 60_000;

export type PlacementOrigin = "MANUAL" | "AUTO_GAP";

export type PlacementGapInput = {
  startAt: Date;
  endAt: Date;
  origin?: PlacementOrigin;
  sortOrder?: number;
  budgetStartAt?: Date | null;
  budgetEndAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  hangarId?: string | null;
  layoutId?: string | null;
  standId?: string | null;
};

export function normalizePlacementGaps(
  placements: PlacementGapInput[],
  options: { enabled: boolean; minGapMs?: number }
): PlacementGapInput[] {
  const minGapMs = Math.max(1, options.minGapMs ?? AUTO_GAP_MIN_MS);
  const manual = placements
    .filter((placement) => placement.origin !== "AUTO_GAP")
    .map((placement) => ({ ...placement, origin: "MANUAL" as const }))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.endAt.getTime() - b.endAt.getTime());

  if (!options.enabled || manual.length < 2) {
    return manual.map((placement, sortOrder) => ({ ...placement, sortOrder }));
  }

  const normalized: PlacementGapInput[] = [];
  for (const placement of manual) {
    const previous = normalized[normalized.length - 1];
    if (previous) {
      const gapMs = placement.startAt.getTime() - previous.endAt.getTime();
      if (gapMs >= minGapMs) {
        normalized.push({
          origin: "AUTO_GAP",
          startAt: previous.endAt,
          endAt: placement.startAt,
          budgetStartAt: null,
          budgetEndAt: null,
          actualStartAt: null,
          actualEndAt: null,
          hangarId: null,
          layoutId: null,
          standId: null
        });
      }
    }
    normalized.push(placement);
  }

  return normalized.map((placement, sortOrder) => ({ ...placement, sortOrder }));
}
