import assert from "node:assert/strict";
import test from "node:test";

import {
  ALWAYS_PINNED_LEFT_IDS,
  DEFAULT_USER_PINNED_LEFT_IDS,
  buildGanttTableColumns,
  factoryColumnConfig,
  normalizeColOrder,
  resolvePinnedLeftIds,
  userPinnedLeftIds
} from "./ganttTableColumns.ts";

const columns = buildGanttTableColumns(null);

test("resolvePinnedLeftIds keeps actions and defaults Форма ТО", () => {
  const ids = resolvePinnedLeftIds(undefined, columns);
  assert.deepEqual(ids, [...ALWAYS_PINNED_LEFT_IDS, ...DEFAULT_USER_PINNED_LEFT_IDS]);
});

test("resolvePinnedLeftIds does not restore default after user unpins all", () => {
  const ids = resolvePinnedLeftIds([], columns, { fallbackToDefault: false });
  assert.deepEqual(ids, ALWAYS_PINNED_LEFT_IDS);
});

test("normalizeColOrder puts pinned columns first", () => {
  const order = normalizeColOrder(["level", "primary.k", "actions", "primary.g"], columns, ["primary.g"]);
  assert.equal(order[0], "actions");
  assert.equal(order[1], "primary.g");
  assert.ok(order.indexOf("primary.k") > order.indexOf("primary.g"));
});

test("factoryColumnConfig pins Форма ТО by default", () => {
  const cfg = factoryColumnConfig(columns);
  assert.deepEqual(cfg.pinnedLeft, DEFAULT_USER_PINNED_LEFT_IDS);
  assert.deepEqual(userPinnedLeftIds(resolvePinnedLeftIds(cfg.pinnedLeft, columns)), DEFAULT_USER_PINNED_LEFT_IDS);
});
