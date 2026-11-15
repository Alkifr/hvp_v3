import assert from "node:assert/strict";
import test from "node:test";

import { buildTowBoardRow, edgeActionLabel, type TowBoardInput } from "./towBoard.js";

const at = (iso: string) => new Date(iso);

function event(overrides: Partial<TowBoardInput> = {}): TowBoardInput {
  return {
    id: "e1",
    title: "C-check",
    status: "IN_PROGRESS",
    startAt: at("2026-10-01T07:00:00.000Z"),
    endAt: at("2026-10-01T15:00:00.000Z"),
    hangarId: "h1",
    hangarName: "Ангар 1",
    hangarCode: "1",
    tailNumber: "RA-100",
    aircraftId: "a1",
    virtual: false,
    aircraftTypeId: "t1",
    aircraftType: "320",
    operatorId: "o1",
    operator: "AFL",
    placements: [
      {
        id: "p1",
        origin: "MANUAL",
        startAt: at("2026-10-01T07:00:00.000Z"),
        endAt: at("2026-10-01T15:00:00.000Z"),
        hangarId: "h1",
        hangarName: "Ангар 1",
        hangarCode: "1",
        standCode: "A1"
      }
    ],
    tows: [],
    ...overrides
  };
}

test("edge label names the empty sides and the norm", () => {
  assert.equal(edgeActionLabel(30, ["event-in", "event-out"]), "Закатка и выкатка, 30 мин");
  assert.equal(edgeActionLabel(30, ["event-out"]), "Выкатка, 30 мин");
  assert.equal(edgeActionLabel(30, ["gap-out", "gap-in"]), "Закатка и выкатка, включая разрыв, 30 мин");
  assert.equal(edgeActionLabel(0, ["event-in"]), "");
});

test("open event offers both edges", () => {
  const row = buildTowBoardRow(event(), 30);
  assert.deepEqual(row.pendingEdges, ["event-in", "event-out"]);
  assert.equal(row.pending[0]?.fromLabel, "МС");
  assert.equal(row.pending[0]?.toLabel, "A1");
  assert.equal(row.placements[0]?.standCode, "A1");
  assert.equal(row.actionLabel, "Закатка и выкатка, 30 мин");
  assert.equal(row.edgeNote, "");
  assert.equal(row.locked, false);
  assert.equal(row.tailNumber, "RA-100");
  assert.equal(row.hangarNumber, "Ангар 1");
  assert.equal(row.standLabel, "A1");
});

test("filled inbound leaves only the outbound edge", () => {
  const row = buildTowBoardRow(
    event({
      tows: [
        {
          startAt: at("2026-10-01T07:00:00.000Z"),
          endAt: at("2026-10-01T07:30:00.000Z"),
          fromLabel: "МС",
          toLabel: "A1"
        }
      ]
    }),
    30
  );
  assert.deepEqual(row.pendingEdges, ["event-out"]);
  assert.equal(row.actionLabel, "Выкатка, 30 мин");
  assert.equal(row.towCount, 1);
  assert.match(row.existingTows[0] ?? "", /Закатка/);
});

test("short stage explains why the button is absent", () => {
  const row = buildTowBoardRow(
    event({
      endAt: at("2026-10-01T07:40:00.000Z"),
      placements: [
        {
          id: "p1",
          origin: "MANUAL",
          startAt: at("2026-10-01T07:00:00.000Z"),
          endAt: at("2026-10-01T07:40:00.000Z"),
          hangarId: "h1",
          hangarName: "Ангар 1",
          hangarCode: "1",
          standCode: "A1"
        }
      ]
    }),
    30
  );
  assert.deepEqual(row.pendingEdges, []);
  assert.equal(row.actionLabel, "");
  assert.match(row.edgeNote, /короче/);
});

test("finished event stays locked and a missing norm is named", () => {
  const done = buildTowBoardRow(event({ status: "DONE" }), 30);
  assert.equal(done.locked, true);
  assert.equal(done.actionLabel, "Закатка и выкатка, 30 мин");
  const missing = buildTowBoardRow(event(), null);
  assert.equal(missing.actionLabel, "");
  assert.equal(missing.edgeNote, "Не задан норматив буксировки");
});
