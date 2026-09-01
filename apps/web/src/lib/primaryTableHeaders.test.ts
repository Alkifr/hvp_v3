import assert from "node:assert/strict";
import test from "node:test";

import {
  clampFreezeRows,
  columnIndexLabels,
  defaultReportFreezeRows,
  defaultShowColumnIndex,
  freezeHeaderRowStyle,
  syncReportFrozenHeader
} from "./primaryTableHeaders.ts";

test("primary reports freeze 2 rows and show column numbers by default", () => {
  assert.equal(defaultReportFreezeRows("primary_events"), 2);
  assert.equal(defaultShowColumnIndex("primary_events"), true);
  assert.equal(defaultReportFreezeRows("tat_events"), 1);
  assert.equal(defaultShowColumnIndex("tat_events"), false);
});

test("clampFreezeRows keeps 0..20", () => {
  assert.equal(clampFreezeRows(-3, 2), 0);
  assert.equal(clampFreezeRows(2, 1), 2);
  assert.equal(clampFreezeRows(99, 2), 20);
  assert.equal(clampFreezeRows("nope", 2), 2);
});

test("freezeHeaderRowStyle sticks only rows below the freeze count", () => {
  const frozen = freezeHeaderRowStyle(1, 2);
  assert.equal(frozen.className, "isFrozen");
  assert.equal(frozen.style?.["--report-freeze-top"], "34px");
  const scrolled = freezeHeaderRowStyle(2, 2);
  assert.equal(scrolled.className, "");
  assert.equal(scrolled.style, undefined);
});

test("columnIndexLabels matches report_all_in numbering", () => {
  assert.deepEqual(columnIndexLabels(3), ["1", "2", "3"]);
});

test("syncReportFrozenHeader is a no-op without a table", () => {
  assert.doesNotThrow(() => syncReportFrozenHeader(null, 4));
});
