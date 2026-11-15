import assert from "node:assert/strict";
import test from "node:test";

import { buildTowRegistryLetter } from "./towRegistryMail.js";
import type { TowReportRow } from "./towReport.js";

function row(partial: Partial<TowReportRow>): TowReportRow {
  return {
    id: "t1",
    eventId: "e1",
    eventTitle: "C-check",
    eventStatus: "IN_PROGRESS",
    eventTypeId: "",
    eventType: "",
    seq: 1,
    direction: "IN",
    directionLabel: "Закатка",
    towDurationMinutes: 30,
    hangarId: "h1",
    hangarNumber: "Ангар 1",
    aircraftTypeId: "t1",
    aircraftType: "320",
    aircraftId: "a1",
    tailNumber: "RA-100",
    operatorId: "o1",
    operator: "AFL",
    fromStand: "МС",
    toStand: "A1",
    plannedStartAt: "2026-11-01T07:00:00.000Z",
    plannedStartMsk: "01.11.2026 10:00",
    plannedEndAt: "2026-11-01T07:30:00.000Z",
    plannedEndMsk: "01.11.2026 10:30",
    occupancyEndAt: "",
    occupancyEndMsk: "05.11.2026 18:00",
    inferredOccupancyEndAt: "2026-11-05T15:00:00.000Z",
    standOccupancy: "4 д",
    standOccupancyMinutes: 5760,
    notes: "",
    toSlotEndAt: "2026-11-05T15:00:00.000Z",
    toSlotEndMsk: "05.11.2026 18:00",
    toSlotDuration: "",
    toSlotMinutes: null,
    positionComment: "",
    startChangeReason: "",
    fromLabel: "МС",
    toLabel: "A1",
    placementId: "p1",
    ...partial
  };
}

test("registry letter uses the dispatcher columns and the period", () => {
  const letter = buildTowRegistryLetter({
    rows: [row({}), row({ id: "t2", seq: 2, direction: "OUT", tailNumber: "RA-200", fromStand: "A1", toStand: "МС" })],
    periodLabel: "01.11.2026–30.11.2026",
    contour: "Рабочий контур",
    note: "Смена А"
  });
  assert.equal(letter.subject, "Реестр буксировок 01.11.2026–30.11.2026");
  assert.match(letter.text, /Смена А/);
  assert.match(letter.text, /закаток: 1, выкаток: 1/);
  assert.match(letter.text, /Ангар/);
  assert.match(letter.text, /RA-100/);
  assert.match(letter.html, /RA-200/);
  assert.match(letter.html, /Бортовой номер/);
  assert.doesNotMatch(letter.html, /<script/);
});
