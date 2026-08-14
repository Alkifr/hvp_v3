import dayjs from "dayjs";

import { formatDateTimeDisplay, isValidDateTimeLocal } from "./dateInput";

export type PlacementOrigin = "MANUAL" | "AUTO_GAP";

export type PlacementDraft = {
  clientKey: string;
  id?: string;
  origin?: PlacementOrigin;
  startAtLocal: string;
  endAtLocal: string;
  budgetStartAtLocal: string;
  budgetEndAtLocal: string;
  actualStartAtLocal: string;
  actualEndAtLocal: string;
  hangarId: string;
  layoutId: string;
  standId: string;
};

export type PlacementDisplayItem =
  | { kind: "manual"; placement: PlacementDraft; index: number }
  | { kind: "auto"; placement: PlacementDraft; index: number };

let placementKeySeq = 0;

export function newPlacementClientKey(seed?: string): string {
  placementKeySeq += 1;
  if (seed && seed !== "legacy") return seed;
  return `pl-${Date.now().toString(36)}-${placementKeySeq}`;
}

export function ensurePlacementClientKey(placement: Omit<PlacementDraft, "clientKey"> & { clientKey?: string }): PlacementDraft {
  return {
    ...placement,
    origin: placement.origin ?? "MANUAL",
    clientKey: placement.clientKey || newPlacementClientKey(placement.id)
  };
}

export function manualPlacements(placements: PlacementDraft[]): PlacementDraft[] {
  return placements
    .filter((placement) => placement.origin !== "AUTO_GAP")
    .map((placement) => ensurePlacementClientKey({ ...placement, origin: "MANUAL" }));
}

function emptyAutoGap(prev: PlacementDraft, next: PlacementDraft): PlacementDraft {
  return {
    clientKey: `auto:${prev.clientKey}:${next.clientKey}`,
    origin: "AUTO_GAP",
    startAtLocal: prev.endAtLocal,
    endAtLocal: next.startAtLocal,
    budgetStartAtLocal: "",
    budgetEndAtLocal: "",
    actualStartAtLocal: "",
    actualEndAtLocal: "",
    hangarId: "",
    layoutId: "",
    standId: ""
  };
}

/** Вставляет автоэтапы между ручными, не меняя порядок и не трогая незавершённый ввод. */
export function interleaveAutoGaps(placements: PlacementDraft[], enabled: boolean): PlacementDisplayItem[] {
  const manual = manualPlacements(placements);
  const items: PlacementDisplayItem[] = [];
  for (let i = 0; i < manual.length; i++) {
    const current = manual[i]!;
    const previous = manual[i - 1];
    if (enabled && previous && isValidDateTimeLocal(previous.endAtLocal) && isValidDateTimeLocal(current.startAtLocal)) {
      const gapMinutes = dayjs(current.startAtLocal).diff(dayjs(previous.endAtLocal), "minute");
      if (gapMinutes >= 1) {
        items.push({ kind: "auto", placement: emptyAutoGap(previous, current), index: items.length });
      }
    }
    items.push({ kind: "manual", placement: current, index: items.length });
  }
  return items;
}

export function placementWarnings(params: {
  placements: PlacementDraft[];
  eventStartAtLocal: string;
  eventEndAtLocal: string;
  autoFillGapPlacements?: boolean;
}): string[] {
  const manuals = manualPlacements(params.placements);
  const displayIndex = new Map(
    interleaveAutoGaps(params.placements, params.autoFillGapPlacements !== false)
      .filter((item) => item.kind === "manual")
      .map((item) => [item.placement.clientKey, item.index + 1])
  );
  const warnings: string[] = [];
  const eventStart = isValidDateTimeLocal(params.eventStartAtLocal) ? dayjs(params.eventStartAtLocal) : null;
  const eventEnd = isValidDateTimeLocal(params.eventEndAtLocal) ? dayjs(params.eventEndAtLocal) : null;

  manuals.forEach((placement) => {
    const label = `Этап ${displayIndex.get(placement.clientKey) ?? "?"}`;
    const startOk = isValidDateTimeLocal(placement.startAtLocal);
    const endOk = isValidDateTimeLocal(placement.endAtLocal);
    if (!startOk || !endOk) {
      warnings.push(`${label}: укажите даты начала и окончания`);
      return;
    }
    const start = dayjs(placement.startAtLocal);
    const end = dayjs(placement.endAtLocal);
    if (!end.isAfter(start)) warnings.push(`${label}: окончание должно быть позже начала`);
    if (eventStart && start.isBefore(eventStart)) {
      warnings.push(`${label}: начало раньше оперативной даты события (${formatDateTimeDisplay(params.eventStartAtLocal)})`);
    }
    if (eventEnd && end.isAfter(eventEnd)) {
      warnings.push(`${label}: окончание позже оперативной даты события (${formatDateTimeDisplay(params.eventEndAtLocal)})`);
    }
  });

  for (let i = 1; i < manuals.length; i++) {
    const prev = manuals[i - 1]!;
    const current = manuals[i]!;
    if (!isValidDateTimeLocal(prev.endAtLocal) || !isValidDateTimeLocal(current.startAtLocal)) continue;
    if (dayjs(current.startAtLocal).isBefore(dayjs(prev.endAtLocal))) {
      const label = `Этап ${displayIndex.get(current.clientKey) ?? i + 1}`;
      warnings.push(`${label} пересекается с предыдущим или стоит раньше по времени`);
    }
  }

  const first = manuals[0];
  if (first && eventStart && isValidDateTimeLocal(first.startAtLocal)) {
    const firstStart = dayjs(first.startAtLocal);
    if (!firstStart.isBefore(eventStart) && firstStart.valueOf() !== eventStart.valueOf()) {
      warnings.push(
        `Начало первого этапа (${formatDateTimeDisplay(first.startAtLocal)}) не совпадает с оперативным началом события (${formatDateTimeDisplay(params.eventStartAtLocal)})`
      );
    }
  }

  const last = manuals[manuals.length - 1];
  if (last && eventEnd && isValidDateTimeLocal(last.endAtLocal)) {
    const lastEnd = dayjs(last.endAtLocal);
    if (!lastEnd.isAfter(eventEnd) && lastEnd.valueOf() !== eventEnd.valueOf()) {
      warnings.push(
        `Окончание последнего этапа (${formatDateTimeDisplay(last.endAtLocal)}) не совпадает с оперативным окончанием события (${formatDateTimeDisplay(params.eventEndAtLocal)})`
      );
    }
  }

  return warnings;
}
