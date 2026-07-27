import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrimaryHeaderPlan,
  contiguousRanges,
  primaryExportHeaderDepth,
  writePrimaryTableHeaderRows
} from "./exportHeaders.js";

test("builds contiguous merge ranges for group headers", () => {
  assert.deepEqual(contiguousRanges(["A", "A", "B", null, "C", "C", "C"]), [
    { start: 0, end: 1, value: "A" },
    { start: 2, end: 2, value: "B" },
    { start: 4, end: 6, value: "C" }
  ]);
});

test("always uses 4 header rows including index row", () => {
  assert.equal(primaryExportHeaderDepth([{ key: "a", label: "L", group: "G", subgroup: null }]), 4);
  assert.equal(primaryExportHeaderDepth([{ key: "a", label: "MAIN", group: "G", subgroup: "ME+AV" }]), 4);
});

test("builds HTML-like header plan with rowspan/colspan and index row", () => {
  const plan = buildPrimaryHeaderPlan([
    { key: "a", label: "ME", group: "Плановая трудоемкость WP согласно MPS", subgroup: null },
    { key: "b", label: "AV", group: "Плановая трудоемкость WP согласно MPS", subgroup: null },
    { key: "c", label: "MAIN", group: "Фактическая трудоемкость по подразделениям", subgroup: "ME+AV" },
    { key: "d", label: "NRC", group: "Фактическая трудоемкость по подразделениям", subgroup: "ME+AV" }
  ]);
  assert.equal(plan.depth, 4);
  assert.equal(plan.groupRow.length, 2);
  assert.equal(plan.groupRow[0]?.colSpan, 2);
  assert.equal(plan.groupRow[1]?.colSpan, 2);
  assert.equal(plan.midRow.length, 3);
  assert.equal(plan.midRow[0]?.rowSpan, 2);
  assert.equal(plan.midRow[1]?.rowSpan, 2);
  assert.equal(plan.midRow[2]?.colSpan, 2);
  assert.equal(plan.midRow[2]?.label, "ME+AV");
  assert.deepEqual(
    plan.labelRow.map((c) => c.label),
    ["MAIN", "NRC"]
  );
  assert.deepEqual(
    plan.indexRow.map((c) => c.label),
    ["1", "2", "3", "4"]
  );
});

test("writes group/subgroup merges before commit", () => {
  const merges: string[] = [];
  const rows: unknown[][] = [];
  const commits: number[] = [];
  let rowNumber = 0;
  const worksheet = {
    addRow(values: unknown[]) {
      rowNumber += 1;
      rows.push(values);
      const number = rowNumber;
      return {
        number,
        commit() {
          commits.push(number);
        },
        getCell(n: number) {
          return { alignment: null as unknown, font: null as unknown, value: values[n - 1] };
        }
      };
    },
    mergeCells(r1: number, c1: number, r2: number, c2: number) {
      if (commits.includes(r1) || commits.includes(r2)) {
        throw new Error("Out of bounds: this row has been committed");
      }
      merges.push(`${r1},${c1}:${r2},${c2}`);
    }
  };

  const next = writePrimaryTableHeaderRows(worksheet, [
    { key: "a", label: "ME", group: "Плановая трудоемкость WP согласно MPS", subgroup: null },
    { key: "b", label: "AV", group: "Плановая трудоемкость WP согласно MPS", subgroup: null },
    { key: "c", label: "MAIN", group: "Фактическая трудоемкость по подразделениям", subgroup: "ME+AV" },
    { key: "d", label: "NRC", group: "Фактическая трудоемкость по подразделениям", subgroup: "ME+AV" },
    { key: "e", label: "Прирост %", group: "Фактическая трудоемкость по подразделениям", subgroup: "ME+AV" }
  ]);

  assert.equal(next, 5);
  assert.deepEqual(commits, [1, 2, 3, 4]);
  assert.deepEqual(rows[3], ["1", "2", "3", "4", "5"]);
  assert.ok(merges.includes("1,1:1,2"));
  assert.ok(merges.includes("1,3:1,5"));
  assert.ok(merges.includes("2,3:2,5"));
  assert.ok(merges.includes("2,1:3,1"));
  assert.ok(merges.includes("2,2:3,2"));
  assert.equal(merges.includes("2,3:3,3"), false);
});
