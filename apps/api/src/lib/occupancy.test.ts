import assert from "node:assert/strict";
import test from "node:test";

import { buildOccupancyReport, buildYearBuckets } from "./occupancy.js";
import type { OccupancyHangar, OccupancyReservation } from "./occupancy.js";

const MSK = 180;

function hangar(events: OccupancyHangar["events"]): OccupancyHangar {
  return {
    hangarId: "h1",
    layoutIds: ["active", "idle"],
    standCountByLayoutId: new Map([
      ["active", 2],
      ["idle", 4]
    ]),
    events
  };
}

test("RRJ place-days split by check and ignore the idle layout", () => {
  const from = new Date("2026-03-01T00:00:00.000Z");
  const to = new Date("2026-03-11T00:00:00.000Z");
  const mid = new Date("2026-03-06T00:00:00.000Z");
  const reservations: OccupancyReservation[] = [
    {
      hangarId: "h1",
      startAt: from,
      endAt: to,
      aircraftTypeId: "rrj",
      operatorId: "op1",
      eventTypeId: "a-check"
    },
    {
      hangarId: "h1",
      startAt: from,
      endAt: mid,
      aircraftTypeId: "rrj",
      operatorId: "op1",
      eventTypeId: "c-check"
    },
    {
      hangarId: "h1",
      startAt: mid,
      endAt: to,
      aircraftTypeId: "a320",
      operatorId: "op2",
      eventTypeId: "a-check"
    }
  ];
  const report = buildOccupancyReport({
    from,
    to,
    grain: "month",
    groupBy: "aircraftType",
    hangars: [hangar([{ startAt: from, endAt: to, layoutId: "active" }])],
    reservations,
    filters: { aircraftTypeIds: ["rrj"], operatorIds: [], eventTypeIds: [] }
  });

  assert.equal(report.capacityPlaceDays, 20);
  assert.equal(report.occupiedPlaceDays, 20);
  assert.equal(report.slicePlaceDays, 15);
  assert.equal(report.shareOfCapacityPct, 75);
  assert.equal(report.shareOfOccupiedPct, 75);
  assert.deepEqual(
    report.byEventType.map((part) => [part.id, part.placeDays]),
    [
      ["a-check", 10],
      ["c-check", 5]
    ]
  );
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0]?.id, "rrj");
  assert.equal(report.rows[0]?.lines, 1.5);
  assert.equal(report.periodDays, 10);
  assert.equal(report.sliceLines, 1.5);
  assert.equal(report.capacityLines, 2);
  assert.deepEqual(
    report.byEventType.map((part) => [part.id, part.lines]),
    [
      ["a-check", 1],
      ["c-check", 0.5]
    ]
  );
  assert.equal(report.buckets.length, 1);
  assert.equal(report.buckets[0]?.slicePlaceDays, 15);
  assert.equal(report.buckets[0]?.dayCount, 10);
  assert.equal(report.buckets[0]?.sliceLines, 1.5);
  assert.deepEqual(
    report.buckets[0]?.byAircraftType.map((part) => [part.id, part.lines]),
    [["rrj", 1.5]]
  );
});

test("one place held for a whole month is one line", () => {
  const from = new Date("2026-03-01T00:00:00.000Z");
  const to = new Date("2026-04-01T00:00:00.000Z");
  const report = buildOccupancyReport({
    from,
    to,
    grain: "month",
    groupBy: "aircraftType",
    hangars: [hangar([{ startAt: from, endAt: to, layoutId: "active" }])],
    reservations: [
      {
        hangarId: "h1",
        startAt: from,
        endAt: to,
        aircraftTypeId: "rrj",
        operatorId: "op1",
        eventTypeId: "a-check"
      }
    ]
  });

  assert.equal(report.periodDays, 31);
  assert.equal(report.slicePlaceDays, 31);
  assert.equal(report.sliceLines, 1);
  assert.equal(report.capacityLines, 2);
  assert.equal(report.buckets[0]?.dayCount, 31);
  assert.equal(report.buckets[0]?.sliceLines, 1);
});

test("a period that ends one millisecond before the next midnight still counts the calendar day", () => {
  const from = new Date("2026-02-01T00:00:00.000Z");
  const to = new Date("2026-02-28T23:59:59.999Z");
  const report = buildOccupancyReport({
    from,
    to,
    grain: "month",
    groupBy: "aircraftType",
    hangars: [hangar([{ startAt: from, endAt: new Date("2026-03-01T00:00:00.000Z"), layoutId: "active" }])],
    reservations: [
      {
        hangarId: "h1",
        startAt: from,
        endAt: new Date("2026-03-01T00:00:00.000Z"),
        aircraftTypeId: "rrj",
        operatorId: "op1",
        eventTypeId: "c-check"
      }
    ]
  });

  assert.equal(report.periodDays, 28);
  assert.ok(Math.abs(report.sliceLines - 1) < 1e-6);
});

test("operator grouping keeps capacity when the event type filter narrows the slice", () => {
  const from = new Date("2026-03-01T00:00:00.000Z");
  const to = new Date("2026-03-11T00:00:00.000Z");
  const reservations: OccupancyReservation[] = [
    {
      hangarId: "h1",
      startAt: from,
      endAt: to,
      aircraftTypeId: "rrj",
      operatorId: "op1",
      eventTypeId: "a-check"
    },
    {
      hangarId: "h1",
      startAt: from,
      endAt: new Date("2026-03-06T00:00:00.000Z"),
      aircraftTypeId: "rrj",
      operatorId: "op2",
      eventTypeId: "c-check"
    }
  ];
  const report = buildOccupancyReport({
    from,
    to,
    grain: "month",
    groupBy: "operator",
    hangars: [hangar([{ startAt: from, endAt: to, layoutId: "active" }])],
    reservations,
    filters: { aircraftTypeIds: [], operatorIds: [], eventTypeIds: ["c-check"] }
  });

  assert.equal(report.capacityPlaceDays, 20);
  assert.equal(report.occupiedPlaceDays, 15);
  assert.equal(report.slicePlaceDays, 5);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0]?.id, "op2");
  assert.equal(report.shareOfCapacityPct, 25);
  assert.ok(Math.abs(report.shareOfOccupiedPct - (5 / 15) * 100) < 1e-9);
});

test("year buckets follow the local calendar", () => {
  const from = new Date("2025-06-01T00:00:00+03:00");
  const to = new Date("2027-02-01T00:00:00+03:00");
  const years = buildYearBuckets(from, to, MSK);
  assert.deepEqual(
    years.map((bucket) => bucket.label),
    ["2025", "2026", "2027"]
  );
  assert.equal(years[0]?.from.toISOString(), from.toISOString());
  assert.equal(years.at(-1)?.to.toISOString(), to.toISOString());
});
