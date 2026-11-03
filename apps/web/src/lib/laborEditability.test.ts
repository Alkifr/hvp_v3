import assert from "node:assert/strict";
import test from "node:test";

import { laborBlockEditable } from "./laborEditability.ts";

test("budget and MPS stay editable through in progress, fact stays closed", () => {
  for (const status of ["PENDING_EXECUTOR_APPROVAL", "APPROVED_BY_CUSTOMER", "IN_PROGRESS"]) {
    assert.equal(laborBlockEditable({ status, block: "LABOR_BUDGET" }), true);
    assert.equal(laborBlockEditable({ status, block: "ADD_PLAN" }), true);
    assert.equal(laborBlockEditable({ status, block: "WP_ACTUAL" }), false);
    assert.equal(laborBlockEditable({ status, block: "NRC_ACTUAL" }), false);
  }
});

test("done unlocks only the actual block", () => {
  assert.equal(laborBlockEditable({ status: "DONE", block: "LABOR_BUDGET" }), false);
  assert.equal(laborBlockEditable({ status: "DONE", block: "WP_PLAN_MPS" }), false);
  assert.equal(laborBlockEditable({ status: "DONE", block: "NRC_PLAN" }), false);
  assert.equal(laborBlockEditable({ status: "DONE", block: "WP_ACTUAL" }), true);
  assert.equal(laborBlockEditable({ status: "DONE", block: "ADD_ACTUAL" }), true);
  assert.equal(laborBlockEditable({ status: "DONE", block: "NRC_ACTUAL" }), true);
});

test("cancelled and deleted lock every labor block", () => {
  for (const status of ["CANCELLED", "DELETED"]) {
    assert.equal(laborBlockEditable({ status, block: "LABOR_BUDGET" }), false);
    assert.equal(laborBlockEditable({ status, block: "WP_ACTUAL" }), false);
  }
});

test("custom status uses sort order against in progress", () => {
  assert.equal(
    laborBlockEditable({ status: "HOLD", block: "NRC_BUDGET", statusSortOrder: 45, inProgressSortOrder: 50 }),
    true
  );
  assert.equal(
    laborBlockEditable({ status: "HOLD", block: "WP_ACTUAL", statusSortOrder: 45, inProgressSortOrder: 50 }),
    false
  );
  assert.equal(
    laborBlockEditable({ status: "AFTER", block: "WP_PLAN_MPS", statusSortOrder: 55, inProgressSortOrder: 50 }),
    false
  );
  assert.equal(
    laborBlockEditable({ status: "AFTER", block: "WP_ACTUAL", statusSortOrder: 55, inProgressSortOrder: 50 }),
    false
  );
});
