import assert from "node:assert/strict";
import test from "node:test";

import { buildTowPlanRows, type TowPlanEvent } from "./towPlan.js";

const from = new Date("2026-11-17T05:00:00.000Z");
const to = new Date("2026-11-18T05:00:00.000Z");

function event(partial: Partial<TowPlanEvent> & Pick<TowPlanEvent, "id">): TowPlanEvent {
  return {
    status: "IN_PROGRESS",
    startAt: new Date("2026-11-17T06:00:00.000Z"),
    endAt: new Date("2026-11-17T16:00:00.000Z"),
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    locked: false,
    hangarId: "h1",
    hangars: [{ id: "h1", label: "Ангар 1" }],
    aircraftTypeId: "type",
    aircraftType: "A320",
    aircraftId: "ac",
    tailNumber: "RA-100",
    operatorId: "op",
    operator: "AFL",
    eventTitle: "C-check",
    eventType: "Базовое ТО",
    placements: [
      {
        id: "p1",
        origin: "MANUAL",
        startAt: new Date("2026-11-17T06:00:00.000Z"),
        endAt: new Date("2026-11-17T16:00:00.000Z"),
        hangarId: "h1",
        hangarLabel: "Ангар 1",
        hangarNumber: "1",
        layoutName: "Базовая",
        standCode: "A1"
      }
    ],
    tows: [],
    ...partial
  };
}

test("plan keeps an event without a tow in the window and keys an intersecting tow by its id", () => {
  const rows = buildTowPlanRows(
    [
      event({ id: "long", startAt: new Date("2026-10-18T05:00:00.000Z"), endAt: new Date("2026-11-22T15:00:00.000Z"), tailNumber: "RA-73139", tows: [
        {
          id: "outside",
          startAt: new Date("2026-10-18T05:00:00.000Z"),
          endAt: new Date("2026-10-18T05:30:00.000Z"),
          fromLabel: "МС",
          toLabel: "A1",
          placementId: "p1",
          occupancyEndAt: null
        }
      ] }),
      event({
        id: "inside",
        tows: [
          {
            id: "tow-1",
            startAt: new Date("2026-11-17T07:00:00.000Z"),
            endAt: new Date("2026-11-17T07:30:00.000Z"),
            fromLabel: "МС",
            toLabel: "B2",
            placementId: "p1",
            occupancyEndAt: new Date("2026-11-17T16:00:00.000Z")
          }
        ]
      })
    ],
    from,
    to
  );
  assert.equal(rows.length, 2);
  const blank = rows.find((row) => row.eventId === "long");
  const assigned = rows.find((row) => row.towId === "tow-1");
  assert.equal(blank?.towId, "");
  assert.equal(blank?.fromStand, "");
  assert.equal(blank?.towStartAt, "");
  assert.equal(assigned?.id, "tow-1");
  assert.equal(assigned?.fromStand, "МС");
  assert.equal(assigned?.toStand, "B2");
  assert.ok(assigned?.standOccupancy);
  assert.equal(assigned?.eventStartMsk.includes("17.11.2026"), true);
  assert.deepEqual(assigned?.standOptions, ["МС", "A1"]);
});

test("stand list is МС plus parking stands that overlap the period", () => {
  const rows = buildTowPlanRows(
    [
      event({
        id: "stands",
        placements: [
          {
            id: "inside",
            origin: "MANUAL",
            startAt: new Date("2026-11-17T06:00:00.000Z"),
            endAt: new Date("2026-11-17T16:00:00.000Z"),
            hangarId: "h1",
            hangarLabel: "Ангар 1",
            hangarNumber: "1",
            layoutName: "Зима",
            standCode: "B2"
          },
          {
            id: "outside",
            origin: "MANUAL",
            startAt: new Date("2026-10-01T06:00:00.000Z"),
            endAt: new Date("2026-10-02T16:00:00.000Z"),
            hangarId: "h2",
            hangarLabel: "Ангар 2",
            hangarNumber: "2",
            layoutName: "Лето",
            standCode: "C9"
          }
        ]
      })
    ],
    from,
    to
  );
  assert.deepEqual(rows[0]?.standOptions, ["МС", "B2"]);
  assert.equal(rows[0]?.hangarNumber, "1");
  assert.equal(rows[0]?.layoutName, "Зима");
  assert.equal(rows[0]?.parkedStand, "B2");
});

test("two tows inside the window become two rows", () => {
  const rows = buildTowPlanRows(
    [
      event({
        id: "both",
        tows: [
          {
            id: "in",
            startAt: new Date("2026-11-17T06:00:00.000Z"),
            endAt: new Date("2026-11-17T06:30:00.000Z"),
            fromLabel: "МС",
            toLabel: "A1",
            placementId: "p1",
            occupancyEndAt: null
          },
          {
            id: "out",
            startAt: new Date("2026-11-17T15:30:00.000Z"),
            endAt: new Date("2026-11-17T16:00:00.000Z"),
            fromLabel: "A1",
            toLabel: "МС",
            placementId: "p1",
            occupancyEndAt: null
          }
        ]
      })
    ],
    from,
    to
  );
  assert.deepEqual(rows.map((row) => row.towId), ["in", "out"]);
});
