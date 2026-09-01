import assert from "node:assert/strict";
import test from "node:test";

import { isMutatingHttpMethod, isWriteBlockedExempt } from "./writeBlocked.js";

test("isMutatingHttpMethod skips reads", () => {
  assert.equal(isMutatingHttpMethod("GET"), false);
  assert.equal(isMutatingHttpMethod("head"), false);
  assert.equal(isMutatingHttpMethod("POST"), true);
  assert.equal(isMutatingHttpMethod("PATCH"), true);
});

test("write-blocked exempts admin and presence for admins", () => {
  assert.equal(isWriteBlockedExempt("/api/admin/runtime", ["admin:users"]), true);
  assert.equal(isWriteBlockedExempt("/api/admin/runtime", ["gantt:write"]), false);
  assert.equal(isWriteBlockedExempt("/api/planning/events", ["admin:users"]), false);
  assert.equal(isWriteBlockedExempt("/api/presence/ping", ["gantt:read"]), true);
  assert.equal(isWriteBlockedExempt("/api/auth/me", []), true);
});
