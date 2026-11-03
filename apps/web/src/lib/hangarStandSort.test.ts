import assert from "node:assert/strict";
import test from "node:test";

import { compareHangarStandRows, hangarStandLayoutSortKey, parseHangarStandSort, type HangarStandSortKey } from "./hangarStandSort.ts";

const rows: HangarStandSortKey[] = [
  { hangarName: "Ангар 2", standCode: "1", layoutName: "Схема 1" },
  { hangarName: "Ангар 1", standCode: "2", layoutName: "Схема 1" },
  { hangarName: "Ангар 1", standCode: "1", layoutName: "Схема 2" },
  { hangarName: "Ангар 1", standCode: "1", layoutName: "Схема 1" }
];

function order(mode: "stand-layout" | "layout-stand") {
  return [...rows]
    .sort((a, b) => compareHangarStandRows(a, b, mode))
    .map((row) => `${row.hangarName}|${row.standCode}|${row.layoutName}`);
}

test("default sort is hangar, then stand, then layout", () => {
  assert.deepEqual(order("stand-layout"), [
    "Ангар 1|1|Схема 1",
    "Ангар 1|1|Схема 2",
    "Ангар 1|2|Схема 1",
    "Ангар 2|1|Схема 1"
  ]);
});

test("alternate sort is hangar, then layout, then stand", () => {
  assert.deepEqual(order("layout-stand"), [
    "Ангар 1|1|Схема 1",
    "Ангар 1|2|Схема 1",
    "Ангар 1|1|Схема 2",
    "Ангар 2|1|Схема 1"
  ]);
});

test("layout sort key prefers name and ignores a blank name", () => {
  assert.equal(hangarStandLayoutSortKey("  Схема А  ", "A"), "Схема А");
  assert.equal(hangarStandLayoutSortKey("  ", "A"), "A");
  assert.equal(hangarStandLayoutSortKey(null, null), "");
});

test("unknown sort falls back to the current order", () => {
  assert.equal(parseHangarStandSort(undefined), "stand-layout");
  assert.equal(parseHangarStandSort("layout"), "stand-layout");
  assert.equal(parseHangarStandSort("layout-stand"), "layout-stand");
});
