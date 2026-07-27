import assert from "node:assert/strict";
import test from "node:test";

import { formatPrimaryDateDisplay, toExcelDateValue } from "./dateFormat.js";

test("formats primary dates for display without ISO noise", () => {
  assert.equal(formatPrimaryDateDisplay("2026-01-16T20:58:43.000Z", "date"), "16.01.2026");
  assert.equal(formatPrimaryDateDisplay("2026-01-16T20:58:43.000Z", "datetime"), "16.01.2026 20:58");
});

test("exports excel Date values with Russian numFmt", () => {
  const dateOnly = toExcelDateValue("2026-01-16T20:58:43.000Z", "date");
  assert.ok(dateOnly);
  assert.equal(dateOnly.numFmt, "dd.mm.yyyy");
  assert.ok(dateOnly.value instanceof Date);
  assert.equal(dateOnly.value.getFullYear(), 2026);
  assert.equal(dateOnly.value.getMonth(), 0);
  assert.equal(dateOnly.value.getDate(), 16);

  const dateTime = toExcelDateValue("2026-01-16T20:58:43.000Z", "datetime");
  assert.ok(dateTime);
  assert.equal(dateTime.numFmt, "dd.mm.yyyy hh:mm");
  assert.equal(dateTime.value.getHours(), 20);
  assert.equal(dateTime.value.getMinutes(), 58);
});
