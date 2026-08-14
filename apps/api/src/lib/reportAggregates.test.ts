import assert from "node:assert/strict";
import test from "node:test";

import { PRIMARY_TABLE_COLUMNS } from "./primaryTable/columnCatalog.generated.js";
import {
  EVENT_COUNT_FIELD,
  aggregateColumnKey,
  applyGroupAggregates,
  computeAggregate,
  isSummaryConfig
} from "./reportAggregates.js";
import { primaryMappingStatus } from "./reportFieldMapping.js";

const fields = [
  { key: "hangar", label: "Ангар", type: "string" as const },
  { key: "acType", label: "Тип ВС", type: "string" as const },
  { key: "tatH", label: "TAT, ч", type: "number" as const },
  { key: "cost", label: "Стоимость", type: "number" as const }
];

const rows = [
  { hangar: "H1", acType: "A320", tatH: 10, cost: 100 },
  { hangar: "H1", acType: "A320", tatH: 20, cost: 50 },
  { hangar: "H1", acType: "B737", tatH: 30, cost: null },
  { hangar: "H2", acType: "A320", tatH: 40, cost: 200 }
];

test("un-stubs primary columns that already have a DB source", () => {
  const labor = PRIMARY_TABLE_COLUMNS.find((column) => column.excelColumn === "AX");
  const cost = PRIMARY_TABLE_COLUMNS.find((column) => column.excelColumn === "BO");
  const rolling = PRIMARY_TABLE_COLUMNS.find((column) => column.excelColumn === "FY");
  const aCheck = PRIMARY_TABLE_COLUMNS.find((column) => column.excelColumn === "GF");
  assert.equal(primaryMappingStatus(labor!), "mapped");
  assert.equal(primaryMappingStatus(cost!), "mapped");
  assert.equal(primaryMappingStatus(rolling!), "mapped");
  assert.equal(primaryMappingStatus(aCheck!), "mapped");
  assert.equal(
    PRIMARY_TABLE_COLUMNS.filter((column) => primaryMappingStatus(column) === "stub").length,
    0
  );
});

test("counts events by dimension when only groupBy is set", () => {
  const result = applyGroupAggregates(rows, ["acType"], [], fields);
  const byType = new Map(result.rows.map((row) => [String(row.acType), row[EVENT_COUNT_FIELD]]));
  assert.equal(byType.get("A320"), 3);
  assert.equal(byType.get("B737"), 1);
  assert.equal(result.total, 2);
});

test("sums and averages numeric fields and skips empty values", () => {
  const result = applyGroupAggregates(
    rows,
    ["hangar"],
    [
      { field: EVENT_COUNT_FIELD, fn: "count" },
      { field: "tatH", fn: "sum" },
      { field: "tatH", fn: "avg" },
      { field: "cost", fn: "sum" },
      { field: "cost", fn: "count" }
    ],
    fields
  );
  const h1 = result.rows.find((row) => row.hangar === "H1")!;
  assert.equal(h1[EVENT_COUNT_FIELD], 3);
  assert.equal(h1["tatH__sum"], 60);
  assert.equal(h1["tatH__avg"], 20);
  assert.equal(h1["cost__sum"], 150);
  assert.equal(h1["cost__count"], 2);
});

test("grand total without groupBy returns a single row", () => {
  const result = applyGroupAggregates(rows, [], [{ field: EVENT_COUNT_FIELD, fn: "count" }], fields);
  assert.equal(result.total, 1);
  assert.equal(result.rows[0]?.[EVENT_COUNT_FIELD], 4);
});

test("computeAggregate count of events ignores field values", () => {
  assert.equal(computeAggregate(rows, { field: EVENT_COUNT_FIELD, fn: "count" }), 4);
  assert.equal(aggregateColumnKey({ field: "*", fn: "count" }), EVENT_COUNT_FIELD);
  assert.equal(isSummaryConfig({ groupBy: ["hangar"], aggregates: [] }), true);
  assert.equal(isSummaryConfig({ groupBy: [], aggregates: [] }), false);
});
