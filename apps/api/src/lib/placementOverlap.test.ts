import assert from "node:assert/strict";
import test from "node:test";

import { gateAllowOverlapRequest, resolveAllowOverlap, standOccupancyWindow } from "./placementOverlap.js";

test("resolveAllowOverlap skips checks and sticks the flag when slots already overlap", () => {
  assert.deepEqual(resolveAllowOverlap({ requested: false, stored: false, existingOverlap: true }), {
    skipChecks: true,
    storedValue: true
  });
});

test("resolveAllowOverlap keeps the stored flag when the client sends true", () => {
  assert.deepEqual(resolveAllowOverlap({ requested: true, stored: true, existingOverlap: false }), {
    skipChecks: true,
    storedValue: true
  });
});

test("resolveAllowOverlap keeps the stored flag when the client omits the field", () => {
  assert.deepEqual(resolveAllowOverlap({ stored: true, existingOverlap: false }), {
    skipChecks: true,
    storedValue: true
  });
});

test("resolveAllowOverlap lets the user turn the flag off after overlap is gone", () => {
  assert.deepEqual(resolveAllowOverlap({ requested: false, stored: true, existingOverlap: false }), {
    skipChecks: true,
    storedValue: false
  });
});

test("gateAllowOverlapRequest drops the client flag without the extended planner right", () => {
  assert.equal(gateAllowOverlapRequest(true, false), undefined);
  assert.equal(gateAllowOverlapRequest(false, false), undefined);
  assert.equal(gateAllowOverlapRequest(true, true), true);
  assert.equal(gateAllowOverlapRequest(undefined, true), undefined);
});

test("standOccupancyWindow keeps the plan when fact is missing or inside it", () => {
  const plan = { startAt: new Date("2026-09-01T08:00:00.000Z"), endAt: new Date("2026-09-10T18:00:00.000Z") };
  assert.deepEqual(standOccupancyWindow(plan), plan);
  assert.deepEqual(
    standOccupancyWindow({
      ...plan,
      actualStartAt: new Date("2026-09-02T08:00:00.000Z"),
      actualEndAt: new Date("2026-09-09T18:00:00.000Z")
    }),
    plan
  );
  assert.deepEqual(
    standOccupancyWindow({ ...plan, actualStartAt: new Date("2026-09-12T08:00:00.000Z"), actualEndAt: null }),
    plan
  );
});

test("standOccupancyWindow extends the stand through a later fact close", () => {
  const window = standOccupancyWindow({
    startAt: new Date("2026-09-01T08:00:00.000Z"),
    endAt: new Date("2026-09-10T18:00:00.000Z"),
    actualStartAt: new Date("2026-09-01T08:00:00.000Z"),
    actualEndAt: new Date("2026-09-18T18:00:00.000Z")
  });
  assert.equal(window.startAt.toISOString(), "2026-09-01T08:00:00.000Z");
  assert.equal(window.endAt.toISOString(), "2026-09-18T18:00:00.000Z");
});

test("standOccupancyWindow also covers an earlier fact start", () => {
  const window = standOccupancyWindow({
    startAt: new Date("2026-09-05T08:00:00.000Z"),
    endAt: new Date("2026-09-10T18:00:00.000Z"),
    actualStartAt: new Date("2026-09-01T08:00:00.000Z"),
    actualEndAt: new Date("2026-09-10T18:00:00.000Z")
  });
  assert.equal(window.startAt.toISOString(), "2026-09-01T08:00:00.000Z");
  assert.equal(window.endAt.toISOString(), "2026-09-10T18:00:00.000Z");
});

test("resolveAllowOverlap still requires an explicit flag for a new overlap", () => {
  assert.deepEqual(resolveAllowOverlap({ requested: false, stored: false, existingOverlap: false }), {
    skipChecks: false,
    storedValue: false
  });
});
