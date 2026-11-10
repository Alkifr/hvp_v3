import assert from "node:assert/strict";
import test from "node:test";

import {
  eventDiffNeedsChangeReason,
  eventDraftNeedsChangeReason,
  moveNeedsChangeReason
} from "./eventChangeReason.ts";

const draft = {
  status: "IN_PROGRESS",
  aircraftId: "ac-1",
  startAtLocal: "2026-11-10T13:00",
  endAtLocal: "2026-11-12T13:00",
  budgetStartAtLocal: "",
  budgetEndAtLocal: "",
  actualStartAtLocal: "",
  actualEndAtLocal: "",
  deadlineAtLocal: "2026-11-20T13:00",
  hangarId: "hangar-1",
  placements: [
    {
      startAtLocal: "2026-11-10T13:00",
      endAtLocal: "2026-11-12T13:00",
      hangarId: "hangar-1",
      layoutId: "layout-1",
      standId: "stand-1"
    }
  ]
};

test("technical card edits do not require a change reason", () => {
  assert.equal(eventDiffNeedsChangeReason(["notes"]), false);
  assert.equal(eventDiffNeedsChangeReason(["comment", "title", "workshopId", "layoutId", "standId"]), false);
  assert.equal(eventDiffNeedsChangeReason([{ field: "status", from: "IN_PROGRESS", to: "DONE" }]), false);
  assert.equal(eventDiffNeedsChangeReason([]), false);
  assert.equal(eventDraftNeedsChangeReason(draft, { ...draft, status: "APPROVED_BY_EXECUTOR" }), false);
});

test("dates, board, deadline, hangar and cancellation require a change reason", () => {
  assert.equal(eventDiffNeedsChangeReason(["startAtLocal"]), true);
  assert.equal(eventDiffNeedsChangeReason(["aircraftId"]), true);
  assert.equal(eventDiffNeedsChangeReason(["deadlineAtLocal"]), true);
  assert.equal(eventDiffNeedsChangeReason(["hangarId", "comment"]), true);
  assert.equal(eventDiffNeedsChangeReason([{ field: "status", from: "IN_PROGRESS", to: "CANCELLED" }]), true);
  assert.equal(eventDiffNeedsChangeReason([{ field: "status", from: "CANCELLED", to: "IN_PROGRESS" }]), false);
  assert.equal(eventDraftNeedsChangeReason(draft, { ...draft, hangarId: "hangar-2" }), true);
  assert.equal(
    eventDraftNeedsChangeReason(draft, {
      ...draft,
      placements: [{ ...draft.placements[0], hangarId: "hangar-2" }]
    }),
    true
  );
  assert.equal(
    eventDraftNeedsChangeReason(draft, {
      ...draft,
      placements: [{ ...draft.placements[0], standId: "stand-9", layoutId: "layout-2" }]
    }),
    false
  );
});

test("a diagram move needs a reason only for dates, hangar or displace", () => {
  const start = "2026-11-10T10:00:00.000Z";
  const end = "2026-11-12T10:00:00.000Z";
  assert.equal(
    moveNeedsChangeReason({
      fromStart: start,
      fromEnd: end,
      toStart: start,
      toEnd: end,
      fromHangarId: "hangar-1",
      toHangarId: "hangar-1"
    }),
    false
  );
  assert.equal(
    moveNeedsChangeReason({
      fromStart: start,
      fromEnd: end,
      toStart: "2026-11-11T10:00:00.000Z",
      toEnd: end,
      fromHangarId: "hangar-1",
      toHangarId: "hangar-1"
    }),
    true
  );
  assert.equal(
    moveNeedsChangeReason({
      fromStart: start,
      fromEnd: end,
      toStart: start,
      toEnd: end,
      fromHangarId: "hangar-1",
      toHangarId: "",
      displace: true
    }),
    true
  );
});
