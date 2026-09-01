import assert from "node:assert/strict";
import test from "node:test";

import { eventAllowsOverlap, eventHasSlotOverlap, type OverlapSlotEvent } from "./eventSlotOverlap.ts";

function ev(partial: Partial<OverlapSlotEvent> & Pick<OverlapSlotEvent, "id" | "startAt" | "endAt">): OverlapSlotEvent {
  return { status: "IN_PROGRESS", ...partial };
}

test("eventHasSlotOverlap detects two events on the same stand", () => {
  const a = ev({
    id: "a",
    startAt: "2026-09-01T08:00:00.000Z",
    endAt: "2026-09-03T18:00:00.000Z",
    reservation: { stand: { id: "s1" } }
  });
  const b = ev({
    id: "b",
    startAt: "2026-09-02T08:00:00.000Z",
    endAt: "2026-09-04T18:00:00.000Z",
    reservation: { stand: { id: "s1" } }
  });
  assert.equal(eventHasSlotOverlap(a, [a, b]), true);
  assert.equal(eventHasSlotOverlap(b, [a, b]), true);
});

test("eventHasSlotOverlap ignores cancelled events and non-overlapping stands", () => {
  const a = ev({
    id: "a",
    startAt: "2026-09-01T08:00:00.000Z",
    endAt: "2026-09-03T18:00:00.000Z",
    reservation: { stand: { id: "s1" } }
  });
  const cancelled = ev({
    id: "c",
    status: "CANCELLED",
    startAt: "2026-09-01T08:00:00.000Z",
    endAt: "2026-09-03T18:00:00.000Z",
    reservation: { stand: { id: "s1" } }
  });
  const otherStand = ev({
    id: "d",
    startAt: "2026-09-01T08:00:00.000Z",
    endAt: "2026-09-03T18:00:00.000Z",
    reservation: { stand: { id: "s2" } }
  });
  assert.equal(eventHasSlotOverlap(a, [a, cancelled, otherStand]), false);
});

test("eventAllowsOverlap is sticky from the stored flag", () => {
  const a = ev({
    id: "a",
    startAt: "2026-09-01T08:00:00.000Z",
    endAt: "2026-09-03T18:00:00.000Z",
    allowOverlap: true,
    reservation: { stand: { id: "s1" } }
  });
  assert.equal(eventAllowsOverlap(a, [a]), true);
});
