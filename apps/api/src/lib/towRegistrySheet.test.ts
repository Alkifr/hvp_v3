import assert from "node:assert/strict";
import test from "node:test";

import type { TowPlanRow } from "./towPlan.js";
import { composeRegistrySheet, markRegistryChanges, REGISTRY_ADDED, REGISTRY_REMOVED, REGISTRY_UPDATED } from "./towRegistrySheet.js";
import type { TowReportRow } from "./towReport.js";

function plan(partial: Partial<TowPlanRow> & Pick<TowPlanRow, "id" | "eventId">): TowPlanRow {
  return {
    towId: "",
    locked: false,
    hangarId: "h2",
    hangars: [{ id: "h2", label: "Ангар 2" }],
    aircraftTypeId: "t",
    aircraftType: "320",
    aircraftId: "a",
    tailNumber: "RA-1",
    operatorId: "o",
    operator: "AFL",
    eventTitle: "Хранение",
    eventType: "Хранение",
    hangarNumber: "",
    layoutName: "",
    parkedStand: "МС",
    fromStand: "",
    toStand: "",
    eventStartAt: "2026-11-01T05:00:00.000Z",
    eventEndAt: "2026-11-02T05:00:00.000Z",
    eventStartMsk: "01.11.2026 08:00",
    eventEndMsk: "02.11.2026 08:00",
    towStartAt: "",
    towEndAt: "",
    standOccupancy: "",
    placementId: "p",
    createdAt: "2026-11-01T05:00:00.000Z",
    isNew: false,
    standOptions: [],
    skipped: false,
    registryNotes: "",
    registryPosition: "конфигурация",
    registryStartReason: "",
    ...partial
  };
}

function report(partial: Partial<TowReportRow> & Pick<TowReportRow, "id" | "eventId">): TowReportRow {
  return {
    eventTitle: "C-check",
    eventStatus: "",
    eventTypeId: "",
    eventType: "",
    seq: 1,
    direction: "IN",
    directionLabel: "Закатка",
    towDurationMinutes: 30,
    hangarId: "h1",
    hangarNumber: "Ангар 1",
    aircraftTypeId: "t",
    aircraftType: "320",
    aircraftId: "a",
    tailNumber: "RA-2",
    operatorId: "o",
    operator: "AFL",
    fromStand: "МС",
    toStand: "MC-1",
    plannedStartAt: "2026-11-01T07:00:00.000Z",
    plannedStartMsk: "01.11.2026 10:00",
    plannedEndAt: "2026-11-01T07:30:00.000Z",
    plannedEndMsk: "01.11.2026 10:30",
    occupancyEndAt: "",
    occupancyEndMsk: "",
    inferredOccupancyEndAt: "",
    standOccupancy: "1 д",
    standOccupancyMinutes: 1440,
    notes: "",
    toSlotEndAt: "",
    toSlotEndMsk: "02.11.2026 08:00",
    toSlotDuration: "Слот до 02.11.2026 08:00 мск",
    toSlotMinutes: null,
    positionComment: "",
    startChangeReason: "",
    fromLabel: "МС",
    toLabel: "MC-1",
    placementId: "p",
    ...partial
  };
}

test("registry sheet keeps an event without a tow and fills the visible note", () => {
  const rows = composeRegistrySheet(
    [
      plan({ id: "event:e1", eventId: "e1" }),
      plan({ id: "event:skip", eventId: "skip", skipped: true, tailNumber: "RA-9" }),
      plan({
        id: "tow-1",
        eventId: "e2",
        towId: "tow-1",
        tailNumber: "RA-2",
        eventTitle: "ТО",
        eventType: "ТО",
        hangarNumber: "Ангар 1",
        parkedStand: "MC-1",
        registryPosition: ""
      })
    ],
    [report({ id: "tow-1", eventId: "e2" })]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.id, "plan:e1");
  assert.equal(rows[0]?.notes, "ВС на МС");
  assert.equal(rows[0]?.positionComment, "конфигурация");
  assert.equal(rows[1]?.notes, "Требуется буксировочная бригада");
  assert.equal(rows.some((row) => row.eventId === "skip"), false);
});

test("registry changes mark added and updated rows and name removed ones", () => {
  const current = composeRegistrySheet(
    [plan({ id: "event:e1", eventId: "e1", tailNumber: "RA-1", registryNotes: "ночь" })],
    []
  );
  const first = markRegistryChanges(null, current);
  assert.equal(first.rows[0]?.changeStatus, REGISTRY_ADDED);
  assert.match(first.lines.join("\n"), /Первая фиксация/);
  assert.match(first.lines.join("\n"), /\+ RA-1 · Хранение/);

  const next = current.map((row) => ({ ...row, notes: "день" }));
  const second = markRegistryChanges(
    first.rows.map((row) => ({ ...row, notes: "ночь" })),
    next
  );
  assert.equal(second.rows[0]?.changeStatus, REGISTRY_UPDATED);
  assert.match(second.lines.join("\n"), /Обновлено/);
  assert.match(second.lines.join("\n"), /~ RA-1 · Хранение/);
  assert.doesNotMatch(second.lines.join("\n"), /Примечание/);

  const gone = markRegistryChanges(
    second.rows.map((row) => ({ id: row.id, tailNumber: row.tailNumber, fromStand: "МС", toStand: "MC-1", plannedStartMsk: "01.11.2026 10:00", notes: row.notes })),
    []
  );
  assert.equal(gone.rows[0]?.changeStatus, REGISTRY_REMOVED);
  assert.match(gone.lines.join("\n"), /Удалено/);
  assert.match(gone.lines.join("\n"), /RA-1, МС → MC-1, 01\.11\.2026 10:00 — Удалено/);
  assert.doesNotMatch(gone.lines.join("\n"), /Снято/);
});

test("a tow that still exists outside the period is not deleted", () => {
  const sheet = composeRegistrySheet([plan({ id: "event:e1", eventId: "e1", tailNumber: "73724", eventTitle: "ТО", eventType: "ТО" })], []);
  const previous = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      eventId: "e1",
      tailNumber: "73724",
      eventTitle: "ТО",
      fromStand: "МС",
      toStand: "MC-1",
      plannedStartMsk: "06.11.2026 10:00",
      hangarNumber: "",
      notes: "бригада"
    }
  ];
  const moved = markRegistryChanges(previous, sheet, new Set(["11111111-1111-4111-8111-111111111111"]));
  assert.equal(moved.rows.some((row) => row.changeStatus === REGISTRY_REMOVED), false);
  assert.equal(moved.rows[0]?.id, "plan:e1");
  assert.equal(moved.rows[0]?.changeStatus, REGISTRY_UPDATED);
  assert.doesNotMatch(moved.lines.join("\n"), /Удалено/);
  assert.match(moved.lines.join("\n"), /Обновлено/);
});
