import assert from "node:assert/strict";
import test from "node:test";

import { registryAutoNote, registryNoteText, registryPositionText } from "./towRegistryNote.ts";

const empty = {
  notes: "",
  hangarNumber: "",
  fromStand: "",
  toStand: "",
  plannedStartAt: null as string | null
};

test("закатка и выкатка требуют бригаду", () => {
  assert.equal(registryAutoNote({
    ...empty,
    id: "tow-1",
    plannedStartAt: "2026-06-02T06:00:00.000Z",
    direction: "IN",
    fromStand: "МС",
    toStand: "MC-2"
  }), "Требуется буксировочная бригада");
  assert.equal(registryAutoNote({
    ...empty,
    id: "tow-2",
    plannedStartAt: "2026-06-02T08:00:00.000Z",
    directionLabel: "Выкатка",
    fromStand: "MC-1",
    toStand: "МС"
  }), "Требуется буксировочная бригада");
});

test("перестановка бригаду не требует", () => {
  assert.equal(registryAutoNote({
    ...empty,
    id: "tow-3",
    plannedStartAt: "2026-06-02T08:00:00.000Z",
    direction: "TRANSFER",
    fromStand: "MC-1",
    toStand: "MC-2",
    hangarNumber: "2"
  }), "");
});

test("борт в ангаре без выкатки", () => {
  assert.equal(registryAutoNote({
    ...empty,
    id: "plan:event-1",
    hangarNumber: "2",
    parkedStand: "МС-2"
  }), "ВС в Ангаре №2 на МС-2");
  assert.equal(registryAutoNote({
    ...empty,
    id: "plan:event-2",
    hangarNumber: "Ангар 4",
    parkedStand: "MC-1"
  }), "ВС в Ангаре №4 на MC-1");
});

test("хранение вне ангара", () => {
  assert.equal(registryAutoNote({
    ...empty,
    id: "plan:event-3",
    eventType: "Хранение",
    parkedStand: "МС"
  }), "ВС на МС");
  assert.equal(registryAutoNote({
    ...empty,
    id: "plan:event-4",
    eventTitle: "ВС на хранении",
    hangarNumber: ""
  }), "ВС на МС");
});

test("обычное событие вне ангара остаётся пустым", () => {
  assert.equal(registryAutoNote({
    ...empty,
    id: "plan:event-5",
    eventType: "C-Check",
    eventTitle: "Форма"
  }), "");
});

test("позиция события важнее комментария буксировки", () => {
  assert.equal(registryPositionText("конфигурация", "старый текст буксировки"), "конфигурация");
  assert.equal(registryPositionText("  ", "старый текст буксировки"), "старый текст буксировки");
  assert.equal(registryPositionText("", ""), "");
});

test("своя запись важнее автотекста", () => {
  const row = {
    ...empty,
    id: "tow-1",
    notes: "  Своя пометка  ",
    plannedStartAt: "2026-06-02T06:00:00.000Z",
    direction: "OUT"
  };
  assert.equal(registryNoteText(row), "Своя пометка");
  assert.equal(registryNoteText({ ...row, notes: "  " }), "Требуется буксировочная бригада");
});
