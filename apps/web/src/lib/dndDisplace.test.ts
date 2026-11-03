import assert from "node:assert/strict";
import test from "node:test";

import { planDndDisplace, planDndLayoutLock, type DndLayoutOccupant, type DndStandOccupant } from "./dndDisplace.ts";

const hour = 60 * 60 * 1000;

function occupant(patch: Partial<DndStandOccupant> & Pick<DndStandOccupant, "eventId">): DndStandOccupant {
  return {
    label: patch.eventId,
    startMs: 0,
    endMs: 2 * hour,
    placementCount: 1,
    status: "APPROVED_BY_CUSTOMER",
    ...patch
  };
}

const base = {
  draggedEventIds: ["drag"],
  previewStartMs: hour,
  previewEndMs: 3 * hour,
  standId: "stand-1",
  layoutId: "layout-1"
};

test("empty stand does not ask to displace anyone", () => {
  assert.deepEqual(planDndDisplace({ ...base, occupants: [] }), { kind: "none" });
});

test("overlapping event on the drop stand must be confirmed", () => {
  const plan = planDndDisplace({
    ...base,
    occupants: [occupant({ eventId: "other", label: "RA-1 · C-Check", startMs: 0, endMs: 2 * hour })]
  });
  assert.deepEqual(plan, {
    kind: "confirm",
    standId: "stand-1",
    layoutId: "layout-1",
    events: [{ eventId: "other", label: "RA-1 · C-Check" }]
  });
});

test("the dragged event itself and a non-overlapping neighbour are ignored", () => {
  assert.deepEqual(
    planDndDisplace({
      ...base,
      occupants: [
        occupant({ eventId: "drag", startMs: 0, endMs: 2 * hour }),
        occupant({ eventId: "later", startMs: 5 * hour, endMs: 6 * hour })
      ]
    }),
    { kind: "none" }
  );
});

test("a pack drop does not displace the event underneath", () => {
  assert.deepEqual(
    planDndDisplace({
      ...base,
      draggedEventIds: ["a", "b"],
      occupants: [occupant({ eventId: "other" })]
    }),
    { kind: "none" }
  );
});

test("completed and multi-stage events block the displace drop", () => {
  assert.equal(
    planDndDisplace({
      ...base,
      occupants: [occupant({ eventId: "done", status: "DONE", label: "борт · DONE" })]
    }).kind,
    "blocked"
  );
  assert.equal(
    planDndDisplace({
      ...base,
      occupants: [occupant({ eventId: "multi", placementCount: 2, label: "борт · этапы" })]
    }).kind,
    "blocked"
  );
});

test("several overlapping events are all listed", () => {
  const plan = planDndDisplace({
    ...base,
    occupants: [
      occupant({ eventId: "a", label: "A" }),
      occupant({ eventId: "a", label: "A-dup" }),
      occupant({ eventId: "b", label: "B", startMs: hour, endMs: 4 * hour })
    ]
  });
  assert.equal(plan.kind, "confirm");
  if (plan.kind !== "confirm") return;
  assert.deepEqual(
    plan.events.map((event) => event.eventId),
    ["a", "b"]
  );
});

function layoutOccupant(patch: Partial<DndLayoutOccupant> & Pick<DndLayoutOccupant, "eventId" | "layoutId">): DndLayoutOccupant {
  return {
    label: patch.eventId,
    hangarId: "hangar-1",
    layoutName: patch.layoutId,
    startMs: 0,
    endMs: 4 * hour,
    ...patch
  };
}

const layoutBase = {
  draggedEventIds: ["drag"],
  targetHangarId: "hangar-1",
  targetLayoutId: "layout-b",
  targetLayoutName: "Ночная",
  windows: [{ startMs: hour, endMs: 3 * hour }]
};

test("same layout in the hangar is not a conflict", () => {
  assert.equal(
    planDndLayoutLock({
      ...layoutBase,
      targetLayoutId: "layout-a",
      occupants: [layoutOccupant({ eventId: "other", layoutId: "layout-a", layoutName: "Дневная" })]
    }),
    null
  );
});

test("another layout overlapping the drop explains why the move is refused", () => {
  const plan = planDndLayoutLock({
    ...layoutBase,
    occupants: [
      layoutOccupant({ eventId: "drag", layoutId: "layout-a", layoutName: "Дневная" }),
      layoutOccupant({ eventId: "other", layoutId: "layout-a", layoutName: "Дневная", label: "RA-73130 · размен" })
    ]
  });
  assert.equal(
    plan?.message,
    "Схему «Ночная» занять нельзя: в этот период в ангаре уже используется «Дневная» (RA-73130 · размен)."
  );
});

test("a layout in another hangar or outside the new interval does not block", () => {
  assert.equal(
    planDndLayoutLock({
      ...layoutBase,
      occupants: [
        layoutOccupant({ eventId: "other-hangar", layoutId: "layout-a", hangarId: "hangar-2" }),
        layoutOccupant({ eventId: "later", layoutId: "layout-a", startMs: 5 * hour, endMs: 6 * hour })
      ]
    }),
    null
  );
});
