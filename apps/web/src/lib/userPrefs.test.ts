import assert from "node:assert/strict";
import test from "node:test";

import {
  browserDocumentTitle,
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

test("isHomePageAllowed follows module permissions", () => {
  assert.equal(isHomePageAllowed("tows", ["tows:read"]), true);
  assert.equal(isHomePageAllowed("personnel", ["personnel:read"]), true);
  assert.equal(isHomePageAllowed("gantt", ["gantt:read"]), true);
  assert.equal(isHomePageAllowed("gantt", ["hangar:read"]), false);
});

test("resolveStartPage uses preferred when allowed, otherwise first available", () => {
  assert.equal(resolveStartPage("hangar", ["hangar:read", "gantt:read"]), "hangar");
  assert.equal(resolveStartPage("gantt", ["hangar:read"]), "hangar");
  assert.equal(resolveStartPage(null, ["gantt:read"]), "gantt");
  assert.equal(firstAllowedPage(["analytics:read"]), "analytics");
  assert.equal(firstAllowedPage([]), "help");
  assert.notEqual(firstAllowedPage([]), "sandboxes");
});

test("parseMutedNotificationKinds drops unknown kinds", () => {
  assert.deepEqual(parseMutedNotificationKinds(["EVENT_OVERDUE_NO_FACT", "x"]), ["EVENT_OVERDUE_NO_FACT"]);
});

test("browserDocumentTitle includes the current section", () => {
  assert.equal(browserDocumentTitle("gantt"), "HVP · Гантт");
  assert.equal(browserDocumentTitle("analytics"), "HVP · Аналитика");
  assert.equal(browserDocumentTitle(null), "HVP");
});
