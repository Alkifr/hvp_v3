import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DAY_BUCKETS,
  buildExclusiveLayoutSegments,
  buildUtilizationBuckets,
  clipHangarWindow
} from "./utilizationSeries.js";

const MSK = 180;

test("a local calendar year of days is not cut off in May", () => {
  const from = new Date("2025-01-01T00:00:00+03:00");
  const to = new Date("2026-01-01T00:00:00+03:00");
  const days = buildUtilizationBuckets(from, to, "day", MSK);
  assert.equal(days.length, 365);
  assert.ok(days.length <= MAX_DAY_BUCKETS);
  assert.equal(days[0]?.label, "2025-01-01");
  assert.equal(days.at(-1)?.label, "2025-12-31");
});

test("a leap year of days includes 29 February", () => {
  const from = new Date("2024-01-01T00:00:00+03:00");
  const to = new Date("2025-01-01T00:00:00+03:00");
  const days = buildUtilizationBuckets(from, to, "day", MSK);
  assert.equal(days.length, 366);
  assert.equal(days.some((d) => d.label === "2024-02-29"), true);
  assert.equal(days.at(-1)?.label, "2024-12-31");
});

test("day buckets stay capped just past one year", () => {
  const from = new Date("2024-01-01T00:00:00Z");
  const to = new Date("2027-01-01T00:00:00Z");
  const days = buildUtilizationBuckets(from, to, "day", 0);
  assert.equal(days.length, MAX_DAY_BUCKETS);
  assert.equal(days.at(-1)?.label, "2025-01-06");
});

test("clipping a year of days matches one full-period sweep", () => {
  const from = new Date("2025-01-01T00:00:00Z");
  const to = new Date("2026-01-01T00:00:00Z");
  const { segments } = buildExclusiveLayoutSegments({
    from,
    to,
    standCountByLayoutId: new Map([
      ["wide", 4],
      ["narrow", 2]
    ]),
    hangarLayoutIds: ["wide", "narrow"],
    events: [
      { startAt: new Date("2025-01-10T00:00:00Z"), endAt: new Date("2025-01-20T00:00:00Z"), layoutId: "wide" },
      { startAt: new Date("2025-01-18T00:00:00Z"), endAt: new Date("2025-02-02T00:00:00Z"), layoutId: "narrow" },
      { startAt: new Date("2025-06-01T06:00:00Z"), endAt: new Date("2025-06-01T18:00:00Z"), layoutId: "wide" },
      { startAt: new Date("2025-11-15T00:00:00Z"), endAt: new Date("2025-12-01T00:00:00Z"), layoutId: "wide" }
    ]
  });
  const reservations = [
    { startMs: new Date("2025-01-12T00:00:00Z").getTime(), endMs: new Date("2025-01-16T00:00:00Z").getTime() },
    { startMs: new Date("2025-06-01T00:00:00Z").getTime(), endMs: new Date("2025-06-03T00:00:00Z").getTime() }
  ];
  const full = clipHangarWindow(segments, reservations, from.getTime(), to.getTime());
  const days = buildUtilizationBuckets(from, to, "day", 0);
  let aircraftHours = 0;
  let capacityHours = 0;
  let occupiedH = 0;
  let conflictMs = 0;
  let cursor = 0;
  for (const day of days) {
    const clip = clipHangarWindow(segments, reservations, day.from.getTime(), day.to.getTime(), cursor);
    cursor = clip.segFromIdx;
    aircraftHours += clip.aircraftHours;
    capacityHours += clip.capacityHours;
    occupiedH += clip.occupiedH;
    conflictMs += clip.conflictMs;
  }
  assert.ok(Math.abs(aircraftHours - full.aircraftHours) < 1e-6);
  assert.ok(Math.abs(capacityHours - full.capacityHours) < 1e-6);
  assert.ok(Math.abs(occupiedH - full.occupiedH) < 1e-6);
  assert.ok(Math.abs(conflictMs - full.conflictMs) < 1e-6);
  assert.ok(full.conflictMs > 0);
  assert.ok(full.aircraftHours > 0);
});
