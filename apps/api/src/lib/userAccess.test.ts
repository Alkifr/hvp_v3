import assert from "node:assert/strict";
import test from "node:test";

import { effectivePermissionCodes } from "./userAccess.js";

test("effectivePermissionCodes unions roles then applies grants and denials", () => {
  const user = {
    roles: [
      {
        role: {
          permissions: [{ permission: { code: "gantt:read" } }, { permission: { code: "events:read" } }]
        }
      }
    ],
    permissionOverrides: [
      { effect: "GRANT" as const, permission: { code: "analytics:read" } },
      { effect: "DENY" as const, permission: { code: "gantt:read" } }
    ]
  };
  const codes = effectivePermissionCodes(user);
  assert.equal(codes.includes("analytics:read"), true);
  assert.equal(codes.includes("gantt:read"), false);
  assert.equal(codes.includes("events:read"), true);
});
