/** Планировщик краевых буксировок. Совпадает с apps/api/src/lib/edgeTows.ts. */

export const APRON_STAND_LABEL = "МС";

export type EdgePlacement = {
  id: string;
  origin: "MANUAL" | "AUTO_GAP";
  startAt: Date;
  endAt: Date;
  standCode: string | null;
};

export type ExistingTowWindow = {
  startAt: Date;
  endAt: Date;
};

export type PlannedEdgeTow = {
  role: "event-in" | "event-out" | "gap-out" | "gap-in";
  startAt: Date;
  endAt: Date;
  placementId: string;
  fromLabel: string;
  toLabel: string;
};

export type SkippedEdge = {
  label: string;
  reason: string;
};

export type EdgeTowPlan = {
  create: PlannedEdgeTow[];
  skipped: SkippedEdge[];
  kept: number;
};

function addMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

function overlaps(start: number, end: number, windows: Array<[number, number]>): boolean {
  return windows.some(([otherStart, otherEnd]) => start < otherEnd && otherStart < end);
}

function stageLabel(index: number): string {
  return `Этап ${index + 1}`;
}

export function planEdgeTows(params: {
  minutes: number;
  placements: EdgePlacement[];
  existing: ExistingTowWindow[];
}): EdgeTowPlan {
  const minutes = params.minutes;
  const stepMs = minutes * 60_000;
  const sorted = [...params.placements].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime() || a.endAt.getTime() - b.endAt.getTime()
  );
  const create: PlannedEdgeTow[] = [];
  const skipped: SkippedEdge[] = [];
  let kept = 0;
  const windows: Array<[number, number]> = params.existing.map((tow) => [tow.startAt.getTime(), tow.endAt.getTime()]);

  const claim = (tow: PlannedEdgeTow) => {
    if (overlaps(tow.startAt.getTime(), tow.endAt.getTime(), windows)) {
      kept += 1;
      return;
    }
    windows.push([tow.startAt.getTime(), tow.endAt.getTime()]);
    create.push(tow);
  };

  const manuals = sorted.filter((placement) => placement.origin !== "AUTO_GAP");
  const first = manuals[0];
  const last = manuals[manuals.length - 1];
  if (!first || !last) {
    skipped.push({ label: "Событие", reason: "нет ручного этапа размещения" });
    return { create, skipped, kept };
  }

  const sameStage = first.id === last.id;
  const inStart = first.startAt;
  const inEnd = addMs(first.startAt, stepMs);
  const outStart = addMs(last.endAt, -stepMs);
  const outEnd = last.endAt;
  const inFits = inEnd.getTime() <= first.endAt.getTime();
  const outFits = outStart.getTime() >= last.startAt.getTime();
  const pairCollides = sameStage && inFits && outFits && inEnd.getTime() > outStart.getTime();

  const claimIn = () =>
    claim({
      role: "event-in",
      startAt: inStart,
      endAt: inEnd,
      placementId: first.id,
      fromLabel: APRON_STAND_LABEL,
      toLabel: first.standCode ?? ""
    });
  const claimOut = () =>
    claim({
      role: "event-out",
      startAt: outStart,
      endAt: outEnd,
      placementId: last.id,
      fromLabel: last.standCode ?? "",
      toLabel: APRON_STAND_LABEL
    });

  if (sameStage && (!inFits || !outFits || pairCollides)) {
    skipped.push({
      label: stageLabel(sorted.findIndex((placement) => placement.id === first.id)),
      reason: `короче ${minutes * 2} мин — закатка и выкатка не помещаются`
    });
  } else if (sameStage) {
    claimIn();
    claimOut();
  } else {
    const firstIndex = sorted.findIndex((placement) => placement.id === first.id);
    const lastIndex = sorted.findIndex((placement) => placement.id === last.id);
    if (!inFits) {
      skipped.push({
        label: stageLabel(firstIndex),
        reason: `короче ${minutes} мин — закатка не помещается`
      });
    } else {
      claimIn();
    }
    if (!outFits) {
      skipped.push({
        label: stageLabel(lastIndex),
        reason: `короче ${minutes} мин — выкатка не помещается`
      });
    } else {
      claimOut();
    }
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const gap = sorted[index]!;
    if (gap.origin !== "AUTO_GAP") continue;
    const previous = [...sorted.slice(0, index)].reverse().find((placement) => placement.origin !== "AUTO_GAP");
    const next = sorted.slice(index + 1).find((placement) => placement.origin !== "AUTO_GAP");
    if (!previous || !next) {
      skipped.push({ label: stageLabel(index), reason: "разрыв без соседнего ручного этапа" });
      continue;
    }
    const gapMs = gap.endAt.getTime() - gap.startAt.getTime();
    if (gapMs < stepMs * 2) {
      skipped.push({
        label: stageLabel(index),
        reason: `короче ${minutes * 2} мин — выкатка и закатка в разрыв не помещаются`
      });
      continue;
    }
    claim({
      role: "gap-out",
      startAt: gap.startAt,
      endAt: addMs(gap.startAt, stepMs),
      placementId: previous.id,
      fromLabel: previous.standCode ?? "",
      toLabel: APRON_STAND_LABEL
    });
    claim({
      role: "gap-in",
      startAt: addMs(gap.endAt, -stepMs),
      endAt: gap.endAt,
      placementId: next.id,
      fromLabel: APRON_STAND_LABEL,
      toLabel: next.standCode ?? ""
    });
  }

  return { create, skipped, kept };
}
