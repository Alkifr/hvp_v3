import assert from "node:assert/strict";
import test from "node:test";

import { applyPermissionOverrides, diffPermissionOverrides, expandPermissionCodes, hasPermission } from "./permissionCatalog.js";

test("gantt write implies view and event data access", () => {
  assert.deepEqual(expandPermissionCodes(["gantt:write"]).sort(), [
    "change_maintenanceevent",
    "events:read",
    "events:write",
    "gantt:read",
    "gantt:write",
    "view_maintenanceevent"
  ]);
});

test("legacy events:read is kept until module codes appear", () => {
  assert.deepEqual(expandPermissionCodes(["events:read"]), ["events:read"]);
});

test("analytics-only does not inherit gantt", () => {
  assert.equal(hasPermission(["analytics:read", "events:read"], "gantt:read"), false);
  assert.equal(hasPermission(["gantt:read"], "events:read"), true);
});

test("applyPermissionOverrides grants extras and honors denials after expand", () => {
  assert.deepEqual(
    applyPermissionOverrides(["gantt:read"], [{ code: "analytics:read", effect: "GRANT" }]).sort(),
    ["analytics:read", "events:read", "gantt:read", "view_maintenanceevent"]
  );
  assert.deepEqual(applyPermissionOverrides(["gantt:write"], [{ code: "gantt:write", effect: "DENY" }]).sort(), [
    "change_maintenanceevent",
    "events:read",
    "events:write",
    "gantt:read",
    "view_maintenanceevent"
  ]);
});

test("django model permission is implied by legacy ref:read bundle", () => {
  assert.equal(hasPermission(["ref:read"], "view_aircraft"), true);
  assert.equal(hasPermission(["view_aircraft"], "ref:read"), true);
  assert.equal(hasPermission(["view_aircraft"], "view_operator"), false);
});

test("diffPermissionOverrides stores only extras vs role baseline", () => {
  assert.deepEqual(diffPermissionOverrides(["gantt:read"], ["gantt:read", "analytics:read"]).sort((a, b) => a.code.localeCompare(b.code)), [
    { code: "analytics:read", effect: "GRANT" }
  ]);
  const denied = diffPermissionOverrides(["gantt:write"], ["gantt:read"]);
  assert.ok(denied.some((row) => row.code === "gantt:write" && row.effect === "DENY"));
});
