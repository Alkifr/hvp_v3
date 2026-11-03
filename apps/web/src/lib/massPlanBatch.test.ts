import assert from "node:assert/strict";
import test from "node:test";

import {
  massPlanBlockMessage,
  parseImportNumber,
  scheduleModeFromToken,
  uniformValue,
  type MassBatchGapRow
} from "./massPlanBatch.ts";

test("parseImportNumber keeps explicit zero and falls back on blank", () => {
  assert.equal(parseImportNumber(0, 12), 0);
  assert.equal(parseImportNumber("0", 12), 0);
  assert.equal(parseImportNumber(" 24,5 ", 0), 24.5);
  assert.equal(parseImportNumber("", 168), 168);
  assert.equal(parseImportNumber("  ", 7), 7);
  assert.equal(parseImportNumber("нет", 3), 3);
});

test("scheduleModeFromToken maps template aliases", () => {
  assert.deepEqual(scheduleModeFromToken("", "compact"), { mode: "compact", recognized: true });
  assert.deepEqual(scheduleModeFromToken("fixedcadence", "compact"), { mode: "fixedCadence", recognized: true });
  assert.deepEqual(scheduleModeFromToken("последовательно", "compact"), { mode: "sequential", recognized: true });
  assert.deepEqual(scheduleModeFromToken("неизвестно", "sequential"), { mode: "sequential", recognized: false });
});

test("uniformValue returns the shared value only when every row matches", () => {
  assert.equal(uniformValue([12, 12, 12]), 12);
  assert.equal(uniformValue([0, 0]), 0);
  assert.equal(uniformValue([12, 24]), undefined);
  assert.equal(uniformValue([]), undefined);
});

test("single mode names the missing required fields", () => {
  assert.equal(
    massPlanBlockMessage({ mode: "single", operatorId: "op", aircraftTypeId: "", eventTypeId: "" }),
    "Предпросмотр недоступен: укажите тип ВС и вид события."
  );
  assert.equal(
    massPlanBlockMessage({ mode: "single", operatorId: "op", aircraftTypeId: "at", eventTypeId: "et" }),
    null
  );
});

test("batch mode explains empty aircraft types and unresolved template values", () => {
  const ready: MassBatchGapRow = {
    operatorId: "op",
    aircraftTypeId: "at",
    eventTypeId: "et",
    startFrom: "2026-07-01",
    endTo: "2026-08-01",
    scheduleMode: "compact",
    cadenceHours: 168
  };
  const broken: MassBatchGapRow = {
    ...ready,
    aircraftTypeId: "",
    unresolved: { aircraftType: "B738" }
  };
  const message = massPlanBlockMessage({ mode: "batch", rows: [broken, ready, { ...broken }] });
  assert.match(message ?? "", /Предпросмотр недоступен/);
  assert.match(message ?? "", /тип ВС: 2 строки \(1, 3\)/);
  assert.match(message ?? "", /не найден тип ВС «B738»: 2 строки \(1, 3\)/);
  assert.equal(massPlanBlockMessage({ mode: "batch", rows: [ready] }), null);
  assert.match(massPlanBlockMessage({ mode: "batch", rows: [] }) ?? "", /добавьте хотя бы одну строку/);
});

test("fixed cadence requires a positive step", () => {
  const row: MassBatchGapRow = {
    operatorId: "op",
    aircraftTypeId: "at",
    eventTypeId: "et",
    startFrom: "2026-07-01",
    endTo: "2026-08-01",
    scheduleMode: "fixedCadence",
    cadenceHours: 0
  };
  assert.match(massPlanBlockMessage({ mode: "batch", rows: [row] }) ?? "", /шаг запуска: 1 строка \(1\)/);
});
