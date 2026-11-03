import assert from "node:assert/strict";
import test from "node:test";

import { planEdgeTows, remapTowPlacementId, type EdgePlacement } from "./edgeTows.js";

const at = (iso: string) => new Date(iso);

function stage(
  id: string,
  origin: EdgePlacement["origin"],
  start: string,
  end: string,
  standCode: string | null
): EdgePlacement {
  return { id, origin, startAt: at(start), endAt: at(end), standCode };
}

test("plans inbound and outbound inside a single stage", () => {
  const plan = planEdgeTows({
    minutes: 30,
    placements: [stage("p1", "MANUAL", "2026-10-01T07:00:00.000Z", "2026-10-01T15:00:00.000Z", "A1")],
    existing: []
  });
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.create.length, 2);
  assert.equal(plan.create[0]?.role, "event-in");
  assert.equal(plan.create[0]?.fromLabel, "МС");
  assert.equal(plan.create[0]?.toLabel, "A1");
  assert.equal(plan.create[0]?.endAt.toISOString(), "2026-10-01T07:30:00.000Z");
  assert.equal(plan.create[1]?.role, "event-out");
  assert.equal(plan.create[1]?.fromLabel, "A1");
  assert.equal(plan.create[1]?.toLabel, "МС");
  assert.equal(plan.create[1]?.startAt.toISOString(), "2026-10-01T14:30:00.000Z");
});

test("repeat fills only an empty edge", () => {
  const plan = planEdgeTows({
    minutes: 30,
    placements: [stage("p1", "MANUAL", "2026-10-01T07:00:00.000Z", "2026-10-01T15:00:00.000Z", "A1")],
    existing: [{ startAt: at("2026-10-01T07:00:00.000Z"), endAt: at("2026-10-01T07:30:00.000Z") }]
  });
  assert.equal(plan.kept, 1);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0]?.role, "event-out");
});

test("skips a stage shorter than two steps", () => {
  const plan = planEdgeTows({
    minutes: 30,
    placements: [stage("p1", "MANUAL", "2026-10-01T07:00:00.000Z", "2026-10-01T07:45:00.000Z", "A1")],
    existing: []
  });
  assert.equal(plan.create.length, 0);
  assert.match(plan.skipped[0]?.reason ?? "", /короче 60 мин/);
});

test("plans rollout and roll-in inside an automatic gap", () => {
  const plan = planEdgeTows({
    minutes: 30,
    placements: [
      stage("p1", "MANUAL", "2026-10-01T07:00:00.000Z", "2026-10-01T11:00:00.000Z", "A1"),
      stage("gap", "AUTO_GAP", "2026-10-01T11:00:00.000Z", "2026-10-01T13:00:00.000Z", null),
      stage("p3", "MANUAL", "2026-10-01T13:00:00.000Z", "2026-10-01T17:00:00.000Z", "B2")
    ],
    existing: []
  });
  assert.equal(plan.skipped.length, 0);
  assert.deepEqual(
    plan.create.map((tow) => tow.role),
    ["event-in", "event-out", "gap-out", "gap-in"]
  );
  const gapOut = plan.create.find((tow) => tow.role === "gap-out");
  const gapIn = plan.create.find((tow) => tow.role === "gap-in");
  assert.equal(gapOut?.placementId, "p1");
  assert.equal(gapOut?.fromLabel, "A1");
  assert.equal(gapOut?.toLabel, "МС");
  assert.equal(gapOut?.startAt.toISOString(), "2026-10-01T11:00:00.000Z");
  assert.equal(gapIn?.placementId, "p3");
  assert.equal(gapIn?.fromLabel, "МС");
  assert.equal(gapIn?.toLabel, "B2");
  assert.equal(gapIn?.endAt.toISOString(), "2026-10-01T13:00:00.000Z");
});

test("skips an automatic gap shorter than two steps and still fills event edges", () => {
  const plan = planEdgeTows({
    minutes: 30,
    placements: [
      stage("p1", "MANUAL", "2026-10-01T07:00:00.000Z", "2026-10-01T11:00:00.000Z", "A1"),
      stage("gap", "AUTO_GAP", "2026-10-01T11:00:00.000Z", "2026-10-01T11:20:00.000Z", null),
      stage("p3", "MANUAL", "2026-10-01T11:20:00.000Z", "2026-10-01T15:00:00.000Z", "B2")
    ],
    existing: []
  });
  assert.equal(plan.create.length, 2);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0]?.label, "Этап 2");
});

test("remaps a tow onto the recreated stage with the same stand and edge", () => {
  const tow = {
    id: "t1",
    placementId: "old",
    startAt: at("2026-10-01T07:00:00.000Z"),
    endAt: at("2026-10-01T07:30:00.000Z")
  };
  const previous = [
    {
      id: "old",
      origin: "MANUAL" as const,
      startAt: at("2026-10-01T07:00:00.000Z"),
      endAt: at("2026-10-01T15:00:00.000Z"),
      standId: "s1",
      hangarId: "h1"
    }
  ];
  const next = [
    {
      id: "new",
      origin: "MANUAL" as const,
      startAt: at("2026-10-01T07:00:00.000Z"),
      endAt: at("2026-10-01T15:00:00.000Z"),
      standId: "s1",
      hangarId: "h1"
    }
  ];
  assert.equal(remapTowPlacementId(tow, previous, next), "new");
});

test("drops the placement link when the stand changed", () => {
  const tow = {
    id: "t1",
    placementId: "old",
    startAt: at("2026-10-01T14:30:00.000Z"),
    endAt: at("2026-10-01T15:00:00.000Z")
  };
  const previous = [
    {
      id: "old",
      origin: "MANUAL" as const,
      startAt: at("2026-10-01T07:00:00.000Z"),
      endAt: at("2026-10-01T15:00:00.000Z"),
      standId: "s1",
      hangarId: "h1"
    }
  ];
  const next = [
    {
      id: "new",
      origin: "MANUAL" as const,
      startAt: at("2026-10-01T07:00:00.000Z"),
      endAt: at("2026-10-01T15:00:00.000Z"),
      standId: "s2",
      hangarId: "h1"
    }
  ];
  assert.equal(remapTowPlacementId(tow, previous, next), null);
});
