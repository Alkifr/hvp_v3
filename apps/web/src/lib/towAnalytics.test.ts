import assert from "node:assert/strict";
import test from "node:test";

import { median, peakConcurrent, summarizeTowAnalytics, type TowAnalyticsRow } from "./towAnalytics.ts";

function row(partial: Partial<TowAnalyticsRow> & Pick<TowAnalyticsRow, "id" | "startAt" | "endAt">): TowAnalyticsRow {
  return {
    eventId: "e1",
    eventTitle: "C-check",
    eventStatus: "PLANNED",
    eventTypeId: "et1",
    eventType: "C-check",
    hangarId: "h1",
    hangar: "Ангар 1",
    aircraftId: "ac1",
    aircraft: "VP-BXX",
    aircraftTypeId: "t1",
    aircraftType: "A320",
    operatorId: "op1",
    operator: "AFL",
    direction: "IN",
    directionLabel: "Закатка",
    fromStand: "МС",
    toStand: "A1",
    occupancyEndAt: null,
    towDurationMin: 30,
    occupancyMin: 480,
    slotMin: 600,
    startChangeReason: "",
    notes: "",
    positionComment: "",
    ...partial
  };
}

test("median of even and odd lists", () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([10, 20]), 15);
  assert.equal(median([]), null);
});

test("peak concurrent counts overlapping tow windows", () => {
  const peak = peakConcurrent([
    { start: 0, end: 10 },
    { start: 5, end: 15 },
    { start: 10, end: 20 }
  ]);
  assert.equal(peak.peak, 2);
  assert.equal(peak.at, 5);
});

test("summarize tows: volume, directions, occupancy ratio, plan shifts", () => {
  const computed = summarizeTowAnalytics([
    row({
      id: "t1",
      startAt: "2026-09-18T09:00:00.000Z",
      endAt: "2026-09-18T09:30:00.000Z",
      occupancyEndAt: "2026-09-18T17:00:00.000Z",
      occupancyMin: 480,
      slotMin: 600,
      startChangeReason: "сдвиг слота"
    }),
    row({
      id: "t2",
      eventId: "e1",
      direction: "OUT",
      directionLabel: "Выкатка",
      fromStand: "A1",
      toStand: "МС",
      startAt: "2026-09-18T09:15:00.000Z",
      endAt: "2026-09-18T09:45:00.000Z",
      towDurationMin: 30,
      occupancyMin: 30,
      slotMin: 600
    }),
    row({
      id: "t3",
      eventId: "e2",
      direction: "TRANSFER",
      directionLabel: "Перестановка",
      fromStand: "A1",
      toStand: "B2",
      hangarId: "h2",
      hangar: "Ангар 2",
      startAt: "2026-09-18T12:00:00.000Z",
      endAt: "2026-09-18T12:20:00.000Z",
      towDurationMin: 20,
      occupancyMin: 120,
      slotMin: 240
    })
  ]);

  assert.equal(computed.summary.tows, 3);
  assert.equal(computed.summary.events, 2);
  assert.equal(computed.summary.inCount, 1);
  assert.equal(computed.summary.outCount, 1);
  assert.equal(computed.summary.transferCount, 1);
  assert.equal(computed.summary.avgTowsPerEvent, 1.5);
  assert.equal(computed.summary.avgTowDurationMin, 80 / 3);
  assert.ok(computed.summary.changedStartPct != null);
  assert.equal(Math.round(computed.summary.changedStartPct), 33);
  assert.equal(computed.summary.peakConcurrent, 2);
  assert.equal(computed.hangars.length, 2);
  assert.equal(computed.routes[0]?.label, "МС → A1");
});

test("hour-of-day uses MSK offset", () => {
  const computed = summarizeTowAnalytics([
    row({
      id: "t1",
      startAt: "2026-09-18T09:00:00.000Z",
      endAt: "2026-09-18T09:30:00.000Z"
    })
  ]);
  const hour12 = computed.hours.find((h) => h.hour === 12);
  assert.equal(hour12?.count, 1);
});
