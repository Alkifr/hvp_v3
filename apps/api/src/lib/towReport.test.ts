import assert from "node:assert/strict";
import test from "node:test";

import { APRON_STAND_LABEL, buildTowReportRow, formatDurationLabel, formatMskDateTime, inferTowRoute } from "./towReport.js";

test("formatMskDateTime uses +3 offset", () => {
  assert.equal(formatMskDateTime(new Date("2026-09-18T09:00:00.000Z")), "18.09.2026 12:00");
});

test("formatDurationLabel", () => {
  assert.equal(formatDurationLabel(90 * 60_000), "1 ч 30 мин");
  assert.equal(formatDurationLabel(2 * 60 * 60_000), "2 ч");
  assert.equal(formatDurationLabel(15 * 60_000), "15 мин");
  assert.equal(formatDurationLabel(0), "");
});

test("infer inbound tow onto first placement from apron МС", () => {
  const placementStart = new Date("2026-09-18T10:00:00.000Z");
  const route = inferTowRoute(
    new Date("2026-09-18T09:30:00.000Z"),
    placementStart,
    [
      {
        id: "p1",
        startAt: placementStart,
        endAt: new Date("2026-09-18T18:00:00.000Z"),
        hangarId: "h1",
        hangarCode: "1",
        hangarName: "Ангар 1",
        standCode: "A1"
      }
    ]
  );
  assert.equal(route.direction, "IN");
  assert.equal(route.fromStand, APRON_STAND_LABEL);
  assert.equal(route.toStand, "A1");
  assert.equal(route.hangarCode, "1");
  assert.equal(route.placementId, "p1");
});

test("infer outbound to apron and transfer between placements", () => {
  const p1 = {
    id: "p1",
    startAt: new Date("2026-09-18T08:00:00.000Z"),
    endAt: new Date("2026-09-18T12:00:00.000Z"),
    hangarId: "h1",
    hangarCode: "1",
    hangarName: "Ангар 1",
    standCode: "A1"
  };
  const p2 = {
    id: "p2",
    startAt: new Date("2026-09-18T13:00:00.000Z"),
    endAt: new Date("2026-09-18T18:00:00.000Z"),
    hangarId: "h2",
    hangarCode: "2",
    hangarName: "Ангар 2",
    standCode: "B2"
  };
  const out = inferTowRoute(p1.endAt, new Date("2026-09-18T12:20:00.000Z"), [p1, p2]);
  assert.equal(out.direction, "OUT");
  assert.equal(out.fromStand, "A1");
  assert.equal(out.toStand, APRON_STAND_LABEL);

  const xfer = inferTowRoute(p1.endAt, p2.startAt, [p1, p2]);
  assert.equal(xfer.direction, "TRANSFER");
  assert.equal(xfer.fromStand, "A1");
  assert.equal(xfer.toStand, "B2");
  assert.equal(xfer.hangarCode, "2");
  assert.equal(xfer.placementId, "p2");
});

test("bound placement on split event uses that stand for inbound", () => {
  const p1 = {
    id: "p1",
    startAt: new Date("2026-09-18T08:00:00.000Z"),
    endAt: new Date("2026-09-18T12:00:00.000Z"),
    hangarId: "h1",
    hangarCode: "1",
    hangarName: "Ангар 1",
    standCode: "A1"
  };
  const p2 = {
    id: "p2",
    startAt: new Date("2026-09-18T13:00:00.000Z"),
    endAt: new Date("2026-09-18T18:00:00.000Z"),
    hangarId: "h2",
    hangarCode: "2",
    hangarName: "Ангар 2",
    standCode: "B2"
  };
  const route = inferTowRoute(
    new Date("2026-09-18T12:30:00.000Z"),
    p2.startAt,
    [p1, p2],
    undefined,
    p2
  );
  assert.equal(route.direction, "IN");
  assert.equal(route.fromStand, APRON_STAND_LABEL);
  assert.equal(route.toStand, "B2");
  assert.equal(route.hangarCode, "2");
  assert.equal(route.placementId, "p2");
});

test("buildTowReportRow prefers stored labels and customer slot", () => {
  const row = buildTowReportRow({
    id: "t1",
    eventId: "e1",
    startAt: new Date("2026-09-18T09:30:00.000Z"),
    endAt: new Date("2026-09-18T10:00:00.000Z"),
    fromLabel: "МС 12",
    toLabel: "",
    notes: "ночь",
    positionComment: "у ворот",
    startChangeReason: "сдвиг слота",
    occupancyEndAt: null,
    fromStandCode: null,
    toStandCode: "A1",
    placementId: "p1",
    eventTitle: "C-check",
    eventStatus: "IN_PROGRESS",
    eventTypeId: "et1",
    eventType: "C-check",
    eventNotes: "событие",
    eventStartAt: new Date("2026-09-18T10:00:00.000Z"),
    eventEndAt: new Date("2026-09-18T18:00:00.000Z"),
    hangarId: "h1",
    hangarCode: "1",
    hangarName: "Ангар 1",
    reservationStandCode: "A1",
    tailNumber: "VP-BXX",
    aircraftId: "ac1",
    aircraftType: "A320",
    aircraftTypeId: "t1",
    operator: "AFL",
    operatorId: "op1",
    customerSlotStartAt: new Date("2026-09-18T10:00:00.000Z"),
    customerSlotEndAt: new Date("2026-09-18T16:00:00.000Z"),
    placements: [
      {
        id: "p1",
        startAt: new Date("2026-09-18T10:00:00.000Z"),
        endAt: new Date("2026-09-18T18:00:00.000Z"),
        hangarId: "h1",
        hangarCode: "1",
        hangarName: "Ангар 1",
        standCode: "A1"
      }
    ]
  });
  assert.equal(row.fromStand, "МС 12");
  assert.equal(row.toStand, "A1");
  assert.equal(row.hangarNumber, "Ангар 1");
  assert.equal(row.aircraftId, "ac1");
  assert.equal(row.plannedStartMsk, "18.09.2026 12:30");
  assert.equal(row.occupancyEndMsk, "18.09.2026 21:00");
  assert.equal(row.standOccupancy, "8 ч 30 мин");
  assert.equal(row.toSlotEndMsk, "18.09.2026 21:00");
  assert.equal(row.notes, "ночь");
  assert.equal(row.directionLabel, "Закатка");
  assert.equal(row.eventType, "C-check");
  assert.equal(row.towDurationMinutes, 30);
});
