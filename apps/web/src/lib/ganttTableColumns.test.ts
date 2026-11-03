import assert from "node:assert/strict";
import test from "node:test";

import {
  ALWAYS_PINNED_LEFT_IDS,
  DEADLINE_COL_ID,
  DEFAULT_USER_PINNED_LEFT_IDS,
  buildGanttTableColumns,
  ensureDeadlineColumn,
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

test("factory column set shows DeadLine after L/B", () => {
  const visible = factoryColumnConfig(columns).visible ?? [];
  assert.equal(visible[visible.indexOf("lineBase") + 1], DEADLINE_COL_ID);
});

test("saved column set gains DeadLine until the user hides it", () => {
  const inserted = ensureDeadlineColumn({
    widths: {},
    hidden: ["primary.ae"],
    visible: ["actions", "lineBase", "primary.y"],
    order: ["actions", "lineBase", "primary.y"]
  });
  assert.equal(inserted?.visible?.[inserted.visible.indexOf("lineBase") + 1], DEADLINE_COL_ID);
  assert.equal(inserted?.order?.[inserted.order.indexOf("lineBase") + 1], DEADLINE_COL_ID);
  const hidden = ensureDeadlineColumn({
    widths: {},
    hidden: [DEADLINE_COL_ID],
    visible: ["actions", "lineBase"],
    order: ["actions", "lineBase"]
  });
  assert.equal(hidden?.visible?.includes(DEADLINE_COL_ID), false);
});

test("factoryColumnConfig pins Форма ТО by default", () => {
  const cfg = factoryColumnConfig(columns);
  assert.deepEqual(cfg.pinnedLeft, DEFAULT_USER_PINNED_LEFT_IDS);
  assert.deepEqual(userPinnedLeftIds(resolvePinnedLeftIds(cfg.pinnedLeft, columns)), DEFAULT_USER_PINNED_LEFT_IDS);
});
