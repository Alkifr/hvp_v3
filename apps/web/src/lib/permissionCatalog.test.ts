import assert from "node:assert/strict";
import test from "node:test";

import {
  PERMISSION_GROUPS,
  displayPermissionCodes,
  expandPermissionCodes,
  hasPermission,
  grantedGroupCount,
  summarizeGroupAccess,
  summarizeRolePermissions,
  nextCloneRoleCode,
  previewNavLabels
} from "./permissionCatalog.ts";

test("edit implies view and events data access", () => {
  assert.deepEqual(expandPermissionCodes(["gantt:write"]).sort(), [
    "events:read",
    "events:write",
    "gantt:read",
    "gantt:write"
  ]);
});

test("legacy events:read opens all planning modules in the matrix", () => {
  const shown = displayPermissionCodes(["events:read", "ref:read"]);
  for (const code of ["gantt:read", "hangar:read", "analytics:read", "itp:read", "ref:read"]) {
    assert.ok(shown.includes(code), code);
  }
});

test("legacy events:read is kept until module codes appear", () => {
  assert.deepEqual(expandPermissionCodes(["events:read"]), ["events:read"]);
});

test("granular analytics-only does not inherit gantt", () => {
  assert.equal(hasPermission(["analytics:read", "events:read"], "gantt:read"), false);
  assert.equal(hasPermission(["analytics:read", "events:read"], "analytics:read"), true);
});

test("write implies view even if read was not stored", () => {
  assert.equal(hasPermission(["hangar:write"], "hangar:read"), true);
  assert.equal(hasPermission(["hangar:write"], "gantt:write"), false);
  assert.equal(hasPermission(["gantt:read"], "events:read"), true);
});

test("legacy events:write opens planning editors", () => {
  assert.equal(hasPermission(["events:write"], "gantt:write"), true);
  assert.equal(hasPermission(["events:write"], "import:write"), true);
});

test("summarizeRolePermissions keeps a short role blurb", () => {
  assert.equal(
    summarizeRolePermissions(["gantt:write", "gantt:read", "analytics:read"]),
    "План (Гантт): редактирование · Аналитика"
  );
  assert.equal(summarizeRolePermissions([]), "Нет доступа к модулям");
});

test("grantedGroupCount ignores empty modules and implied events:*", () => {
  assert.equal(grantedGroupCount([]), 0);
  assert.equal(grantedGroupCount(["gantt:write", "gantt:read", "analytics:read"]), 2);
});

test("previewNavLabels follows App desktop menu rules", () => {
  assert.equal(
    previewNavLabels(["analytics:read"]),
    "Аналитика · Песочницы · Инструкция · Профиль"
  );
  assert.ok(previewNavLabels(["gantt:write"]).includes("План"));
  assert.ok(previewNavLabels(["admin:users"]).includes("Админка"));
  assert.ok(!previewNavLabels(["analytics:read"]).includes("РМ ИТП"));
});

test("nextCloneRoleCode stays unique and within 32 chars", () => {
  assert.equal(nextCloneRoleCode("VIEWER", []), "VIEWER_COPY");
  assert.equal(nextCloneRoleCode("VIEWER", ["VIEWER_COPY"]), "VIEWER_COPY2");
  assert.ok(nextCloneRoleCode("A".repeat(30), ["A".repeat(30) + "_C"]).length <= 32);
});

test("summarizeGroupAccess drops implied view when edit is on", () => {
  const gantt = PERMISSION_GROUPS.find((group) => group.id === "gantt");
  assert.ok(gantt);
  assert.equal(summarizeGroupAccess(gantt, ["gantt:write", "gantt:read"]), "редактирование");
  assert.equal(summarizeGroupAccess(gantt, []), "нет доступа");
});
