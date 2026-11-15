import assert from "node:assert/strict";
import test from "node:test";

import { buildHangarDay, buildWeekEdges, chipBox, conflictKeys, mondayOfMskDay, weekEdgeSpan, type DayEvent } from "./towPlanGeometry.ts";

const dayStart = Date.parse("2026-11-04T21:00:00.000Z");
const dayEnd = Date.parse("2026-11-05T21:00:00.000Z");

test("chip near the end of the bar anchors to the end", () => {
  const start = Date.parse("2026-11-01T07:00:00.000Z");
  const end = Date.parse("2026-11-08T07:00:00.000Z");
  const inbound = chipBox(start, start + 30 * 60_000, start, end);
  const outbound = chipBox(end - 30 * 60_000, end, start, end);
  assert.equal(inbound?.anchor, "start");
  assert.equal(outbound?.anchor, "end");
  assert.equal(chipBox(end, end + 60_000, start, end), null);
});

test("conflict marks both overlapping movements", () => {
  const keys = conflictKeys([
    { key: "a", startMs: 10, endMs: 20 },
    { key: "b", startMs: 19, endMs: 30 },
    { key: "c", startMs: 40, endMs: 50 }
  ]);
  assert.deepEqual([...keys].sort(), ["a", "b"]);
});

test("hangar day keeps the aircraft in its hangar and flags a shared hour", () => {
  const stay = (id: string, tail: string, towStart: string, towEnd: string): DayEvent => ({
    eventId: id,
    title: "C-check",
    tailNumber: tail,
    startAt: "2026-11-01T07:00:00.000Z",
    endAt: "2026-11-08T15:00:00.000Z",
    hangars: [{ id: "h1", label: "Ангар 1" }],
    placements: [
      {
        id: "p1",
        origin: "MANUAL",
        startAt: "2026-11-04T21:00:00.000Z",
        endAt: "2026-11-05T18:00:00.000Z",
        hangarId: "h1",
        hangarLabel: "Ангар 1",
        standCode: "A1"
      }
    ],
    tows: [
      {
        id: `${id}-tow`,
        placementId: "p1",
        startAt: towStart,
        endAt: towEnd,
        fromLabel: "A1",
        toLabel: "МС",
        directionLabel: "Выкатка"
      }
    ],
    pending: [],
    locked: false
  });
  const groups = buildHangarDay(
    [
      stay("e1", "RA-100", "2026-11-05T14:00:00.000Z", "2026-11-05T14:30:00.000Z"),
      stay("e2", "RA-200", "2026-11-05T14:20:00.000Z", "2026-11-05T14:50:00.000Z")
    ],
    dayStart,
    dayEnd
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.hangarLabel, "Ангар 1");
  assert.equal(groups[0]?.rows.length, 2);
  assert.equal(groups[0]?.rows.every((row) => row.chips.some((chip) => chip.conflict)), true);
});

test("week matrix keeps only placement edges inside the week and stretches an assigned tow", () => {
  const weekStart = Date.parse("2027-01-03T21:00:00.000Z");
  const event: DayEvent = {
    eventId: "e1",
    title: "C+2C",
    tailNumber: "RA-73722",
    startAt: "2027-01-07T05:00:00.000Z",
    endAt: "2027-01-22T20:59:59.000Z",
    hangars: [{ id: "h1", label: "Ангар 1" }],
    placements: [
      {
        id: "p1",
        origin: "MANUAL",
        startAt: "2027-01-07T05:00:00.000Z",
        endAt: "2027-01-22T20:59:59.000Z",
        hangarId: "h1",
        hangarLabel: "Ангар 1",
        standCode: "MC-1"
      }
    ],
    tows: [
      {
        id: "t1",
        placementId: "p1",
        startAt: "2027-01-07T05:00:00.000Z",
        endAt: "2027-01-07T05:30:00.000Z",
        fromLabel: "МС",
        toLabel: "MC-1",
        directionLabel: "Закатка"
      }
    ],
    pending: [],
    locked: false
  };
  const edges = buildWeekEdges([event], weekStart);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]?.side, "start");
  assert.equal(edges[0]?.day, "2027-01-07");
  assert.equal(edges[0]?.minute, 8 * 60);
  assert.equal(edges[0]?.towId, "t1");
  assert.deepEqual(weekEdgeSpan(edges[0]!, 5), { start: 8 * 60, minutes: 30 });
  assert.equal(mondayOfMskDay("2027-01-07"), "2027-01-04");
  assert.equal(buildWeekEdges([event], Date.parse("2027-01-10T21:00:00.000Z")).length, 0);
});
