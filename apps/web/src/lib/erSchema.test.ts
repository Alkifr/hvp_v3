import assert from "node:assert/strict";
import test from "node:test";

import { ER_EDGES, ER_TABLE_BY_ID, ER_TABLES, neighborIds, searchErTables } from "./erSchema.ts";

test("схема содержит таблицы и связи", () => {
  assert.ok(ER_TABLES.length >= 60);
  assert.ok(ER_EDGES.length >= 80);
});

test("поиск находит таблицу по имени модели", () => {
  const hits = searchErTables("MaintenanceEvent");
  assert.equal(hits[0]?.table.id, "MaintenanceEvent");
  assert.equal(hits[0]?.viaColumn, undefined);
});

test("поиск находит таблицу по русскому названию", () => {
  const hits = searchErTables("ангар");
  assert.ok(hits.some((h) => h.table.id === "Hangar"));
});

test("связи ссылаются на существующие таблицы и колонки", () => {
  const ids = new Set(ER_TABLES.map((t) => t.id));
  for (const edge of ER_EDGES) {
    assert.ok(ids.has(edge.from), edge.from);
    assert.ok(ids.has(edge.to), edge.to);
    const fromCols = new Set(ER_TABLE_BY_ID[edge.from]!.columns.map((c) => c.name));
    const toCols = new Set(ER_TABLE_BY_ID[edge.to]!.columns.map((c) => c.name));
    assert.ok(fromCols.has(edge.fromCol), `${edge.from}.${edge.fromCol}`);
    assert.ok(toCols.has(edge.toCol), `${edge.to}.${edge.toCol}`);
  }
});

test("у события ТО есть связанные таблицы", () => {
  const ids = neighborIds("MaintenanceEvent");
  assert.ok(ids.includes("Aircraft"));
  assert.ok(ids.includes("Hangar"));
  assert.ok(ids.includes("Sandbox"));
});
