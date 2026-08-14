import assert from "node:assert/strict";
import test from "node:test";

import { PRIMARY_TABLE_COLUMNS } from "./columnCatalog.generated.js";
import { applyPrimaryTableFormulas, durationDays, durationHours, inclusiveCalendarDays, isSlotDurationColumn } from "./formulaEngine.js";

test("catalog contains the complete A:GH specification", () => {
  assert.equal(PRIMARY_TABLE_COLUMNS.length, 190);
  assert.equal(PRIMARY_TABLE_COLUMNS[0]?.excelColumn, "A");
  assert.equal(PRIMARY_TABLE_COLUMNS.at(-1)?.excelColumn, "GH");
  assert.equal(PRIMARY_TABLE_COLUMNS.filter((column) => column.formula).length, 70);
  assert.equal(new Set(PRIMARY_TABLE_COLUMNS.map((column) => column.key)).size, 190);
});

test("keeps inclusive calendar days separate from elapsed duration", () => {
  const start = "2026-07-01T12:00:00.000Z";
  const end = "2026-07-02T18:00:00.000Z";
  assert.equal(inclusiveCalendarDays(start, end), 2);
  assert.equal(durationHours(start, end), 30);
  assert.equal(durationDays(start, end), 1.25);
});

test("uses the XLSX plan-minus-fact deviation convention", () => {
  const row = applyPrimaryTableFormulas({
    "primary.u": "2026-07-01T00:00:00.000Z",
    "primary.v": "2026-07-05T00:00:00.000Z",
    "primary.y": "2026-07-01T00:00:00.000Z",
    "primary.z": "2026-07-04T00:00:00.000Z",
    "primary.al": "2026-07-01T00:00:00.000Z",
    "primary.am": "2026-07-06T00:00:00.000Z"
  });
  assert.equal(row["primary.aq"], 0);
  assert.equal(row["primary.as"], -2);
  assert.equal(row["primary.at"], -48);
  assert.equal(row["primary.ab"], 3);
  assert.equal(row["primary.ao"], 5);
});

test("duration hours are rounded to 2 decimal places", () => {
  const start = "2026-07-01T08:00:00.000Z";
  const end = "2026-07-01T08:20:00.000Z";
  assert.equal(durationHours(start, end), 0.33);
  assert.equal(isSlotDurationColumn({ key: "primary.ab", label: "Продолжительность слота (Дни) (План)" }), true);
});

test("returns null for division by zero instead of Excel errors", () => {
  const row = applyPrimaryTableFormulas({
    "primary.ax": 10
  });
  assert.equal(row["primary.be"], null);
  assert.equal(row["primary.ec"], null);
});
