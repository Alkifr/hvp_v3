import assert from "node:assert/strict";
import test from "node:test";

import { applyDefaultHidden, columnWidth, estimateLines, hiddenColumnKeys, readTowColumnPref, visibleColumnKeys, wrappedBlockSize } from "./towColumnLayout.ts";

const ALL = ["status", "tail", "title", "actions"];

test("column prefs ignore junk and keep widths in range", () => {
  assert.deepEqual(readTowColumnPref(null), { hidden: [], widths: {}, appliedHidden: [] });
  assert.deepEqual(readTowColumnPref({ hidden: ["tail", 1], widths: { tail: 180, title: 10, status: "240" }, appliedHidden: ["end", 2] }), {
    hidden: ["tail", "1"],
    widths: { tail: 180, status: 240 },
    appliedHidden: ["end", "2"]
  });
  assert.equal(columnWidth(undefined, 120), 120);
  assert.equal(columnWidth(400, 120), 400);
});

test("default hidden column is applied once and stays visible after the user shows it", () => {
  const once = applyDefaultHidden({ hidden: ["tail"], widths: {}, appliedHidden: [] }, ["end"]);
  assert.deepEqual(once.hidden, ["tail", "end"]);
  assert.deepEqual(once.appliedHidden, ["end"]);
  const shown = applyDefaultHidden({ ...once, hidden: ["tail"] }, ["end"]);
  assert.deepEqual(shown.hidden, ["tail"]);
  assert.equal(applyDefaultHidden(once, ["end"]), once);
});

test("hiding keeps at least one data column and never hides a locked one", () => {
  assert.deepEqual(hiddenColumnKeys(ALL, ["tail", "actions", "missing"], ["actions"]), ["tail"]);
  assert.deepEqual(visibleColumnKeys(ALL, ["status", "tail", "title"], ["actions"]), ["status", "actions"]);
  assert.deepEqual(visibleColumnKeys(ALL, [], ["actions"]), ALL);
});

test("wrapped text grows with narrow columns and stays one line when it fits", () => {
  assert.equal(estimateLines("", 200), 1);
  assert.equal(estimateLines("Борт", 120), 1);
  assert.ok(estimateLines("Причина изменения времени начала буксировки (<60 мин)", 120) >= 3);
  assert.equal(estimateLines("Причина изменения времени начала буксировки (<60 мин)", 520), 1);
  assert.equal(wrappedBlockSize([{ text: "Борт", width: 120 }], 42, 240), 42);
  assert.ok(wrappedBlockSize([{ text: "Причина изменения времени начала буксировки", width: 90 }]) > 42);
});
