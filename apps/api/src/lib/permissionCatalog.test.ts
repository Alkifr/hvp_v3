import assert from "node:assert/strict";
import test from "node:test";

import { expandPermissionCodes, hasPermission } from "./permissionCatalog.js";

test("gantt write implies view and event data access", () => {
  assert.deepEqual(expandPermissionCodes(["gantt:write"]).sort(), [
    "events:read",
    "events:write",
    "gantt:read",
    "gantt:write"
  ]);
});

test("legacy events:read is kept until module codes appear", () => {
  assert.deepEqual(expandPermissionCodes(["events:read"]), ["events:read"]);
});

test("analytics-only does not inherit gantt", () => {
  assert.equal(hasPermission(["analytics:read", "events:read"], "gantt:read"), false);
  assert.equal(hasPermission(["gantt:read"], "events:read"), true);
});
