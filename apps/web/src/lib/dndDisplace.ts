import { rangesOverlap } from "./ganttVirtualize";

export type DndStandOccupant = {
  eventId: string;
  label: string;
  startMs: number;
  endMs: number;
  placementCount: number;
  status: string;
};

export type DndDisplacePlan =
  | { kind: "none" }
  | { kind: "blocked"; eventId: string; label: string }
  | {
      kind: "confirm";
      standId: string;
      layoutId: string;
      events: Array<{ eventId: string; label: string }>;
    };

const PROTECTED_STATUSES = new Set(["DONE", "CANCELLED", "DELETED"]);

function isProtected(occupant: DndStandOccupant): boolean {
  return occupant.placementCount > 1 || PROTECTED_STATUSES.has(occupant.status);
}

/** Одно событие, отпущенное на занятую стоянку: кого придётся сместить, либо почему перенос туда нельзя подтверждать. */
export function planDndDisplace(params: {
  draggedEventIds: string[];
  previewStartMs: number;
  previewEndMs: number;
  standId?: string;
  layoutId?: string;
  occupants: DndStandOccupant[];
}): DndDisplacePlan {
  if (params.draggedEventIds.length !== 1) return { kind: "none" };
  if (!params.standId || !params.layoutId) return { kind: "none" };
  if (!Number.isFinite(params.previewStartMs) || !Number.isFinite(params.previewEndMs)) return { kind: "none" };
  if (params.previewEndMs <= params.previewStartMs) return { kind: "none" };

  const dragged = new Set(params.draggedEventIds);
  const hits: DndStandOccupant[] = [];
  const seen = new Set<string>();
  for (const occupant of params.occupants) {
    if (!occupant.eventId || dragged.has(occupant.eventId) || seen.has(occupant.eventId)) continue;
    if (!Number.isFinite(occupant.startMs) || !Number.isFinite(occupant.endMs)) continue;
    if (!rangesOverlap(params.previewStartMs, params.previewEndMs, occupant.startMs, occupant.endMs)) continue;
    seen.add(occupant.eventId);
    hits.push(occupant);
  }
  if (hits.length === 0) return { kind: "none" };

  const blocked = hits.find(isProtected);
  if (blocked) return { kind: "blocked", eventId: blocked.eventId, label: blocked.label };

  return {
    kind: "confirm",
    standId: params.standId,
    layoutId: params.layoutId,
    events: hits.map((occupant) => ({ eventId: occupant.eventId, label: occupant.label }))
  };
}

export type DndLayoutOccupant = {
  eventId: string;
  label: string;
  hangarId: string;
  layoutId: string;
  layoutName: string;
  startMs: number;
  endMs: number;
};

/** В одном ангаре в один момент может быть только одна схема. Возвращает текст, если цель ей противоречит. */
export function planDndLayoutLock(params: {
  draggedEventIds: string[];
  targetHangarId: string;
  targetLayoutId: string;
  targetLayoutName: string;
  windows: Array<{ startMs: number; endMs: number }>;
  occupants: DndLayoutOccupant[];
}): { message: string } | null {
  if (!params.targetHangarId || !params.targetLayoutId) return null;
  const windows = params.windows.filter(
    (window) => Number.isFinite(window.startMs) && Number.isFinite(window.endMs) && window.endMs > window.startMs
  );
  if (windows.length === 0) return null;
  const dragged = new Set(params.draggedEventIds);
  let hit: DndLayoutOccupant | null = null;
  for (const occupant of params.occupants) {
    if (!occupant.eventId || dragged.has(occupant.eventId)) continue;
    if (occupant.hangarId !== params.targetHangarId || occupant.layoutId === params.targetLayoutId) continue;
    if (!Number.isFinite(occupant.startMs) || !Number.isFinite(occupant.endMs)) continue;
    const overlaps = windows.some((window) => rangesOverlap(window.startMs, window.endMs, occupant.startMs, occupant.endMs));
    if (!overlaps) continue;
    if (!hit || occupant.startMs < hit.startMs) hit = occupant;
  }
  if (!hit) return null;
  const used = hit.layoutName.trim() || "другая схема";
  const target = params.targetLayoutName.trim() || "выбранную схему";
  return {
    message: `Схему «${target}» занять нельзя: в этот период в ангаре уже используется «${used}» (${hit.label}).`
  };
}
