import assert from "node:assert/strict";
import test from "node:test";

import {
  firstAllowedPage,
  isHomePageAllowed,
  parseHomePage,
  parseMutedNotificationKinds,
  resolveStartPage
} from "./userPrefs.ts";

test("parseHomePage accepts known modules and treats auto as empty", () => {
  assert.equal(parseHomePage("analytics"), "analytics");
  assert.equal(parseHomePage("auto"), null);
  assert.equal(parseHomePage("profile"), null);
});

test("isHomePageAllowed hides desktop modules on mobile", () => {
  assert.equal(isHomePageAllowed("itp", ["itp:read"], true), false);
  assert.equal(isHomePageAllowed("itp", ["itp:read"], false), true);
  assert.equal(isHomePageAllowed("gantt", ["gantt:read"], true), true);
  assert.equal(isHomePageAllowed("gantt", ["hangar:read"], false), false);
});

test("resolveStartPage uses preferred when allowed, otherwise first available", () => {
  assert.equal(resolveStartPage("hangar", ["hangar:read", "gantt:read"], false), "hangar");
  assert.equal(resolveStartPage("gantt", ["hangar:read"], false), "hangar");
  assert.equal(resolveStartPage(null, ["gantt:read"], false), "gantt");
  assert.equal(firstAllowedPage(["analytics:read"], false), "analytics");
  assert.equal(firstAllowedPage([], false), "help");
  assert.notEqual(firstAllowedPage([], false), "sandboxes");
});

test("parseMutedNotificationKinds drops unknown kinds", () => {
  assert.deepEqual(parseMutedNotificationKinds(["EVENT_OVERDUE_NO_FACT", "x"]), ["EVENT_OVERDUE_NO_FACT"]);
});
