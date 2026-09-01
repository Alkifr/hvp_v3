import assert from "node:assert/strict";
import test from "node:test";

import { adminTabFromHash, buildAdminHash, parseHashPage } from "./eventDeepLink.ts";

test("parseHashPage keeps gantt query without treating it as a subpath", () => {
  const parsed = parseHashPage("#gantt?event=abc&sandbox=s1");
  assert.equal(parsed.page, "gantt");
  assert.equal(parsed.rest, "");
  assert.equal(parsed.query.get("event"), "abc");
  assert.equal(parsed.query.get("sandbox"), "s1");
});

test("parseHashPage splits admin tab and invite query", () => {
  const parsed = parseHashPage("#admin/users?invite=1");
  assert.equal(parsed.page, "admin");
  assert.equal(parsed.rest, "users");
  assert.equal(parsed.query.get("invite"), "1");
});

test("parseHashPage reads #admin/roles", () => {
  const parsed = parseHashPage("#admin/roles");
  assert.equal(parsed.page, "admin");
  assert.equal(parsed.rest, "roles");
  assert.equal(parsed.query.toString(), "");
});

test("adminTabFromHash accepts known tabs and ignores unknown", () => {
  assert.equal(adminTabFromHash("#admin/overview"), "overview");
  assert.equal(adminTabFromHash("#admin/sandboxes"), "sandboxes");
  assert.equal(adminTabFromHash("#admin/reports"), "reports");
  assert.equal(adminTabFromHash("#admin/cleanup"), "cleanup");
  assert.equal(adminTabFromHash("#admin"), null);
  assert.equal(adminTabFromHash("#admin/unknown"), null);
  assert.equal(adminTabFromHash("#gantt"), null);
});

test("buildAdminHash writes tab path and optional invite", () => {
  assert.equal(buildAdminHash("users"), "admin/users");
  assert.equal(buildAdminHash("users", { invite: true }), "admin/users?invite=1");
  assert.equal(buildAdminHash("roles", { invite: true }), "admin/roles?invite=1");
});
