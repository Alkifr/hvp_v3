import assert from "node:assert/strict";
import test from "node:test";

import { parseHomePage, parseMutedNotificationKinds } from "./userPrefs.js";

test("parseHomePage accepts known modules and treats auto as empty", () => {
  assert.equal(parseHomePage("gantt"), "gantt");
  assert.equal(parseHomePage("hangar"), "hangar");
  assert.equal(parseHomePage("auto"), null);
  assert.equal(parseHomePage(""), null);
  assert.equal(parseHomePage(null), null);
  assert.equal(parseHomePage("profile"), null);
  assert.equal(parseHomePage("mass"), null);
});

test("parseMutedNotificationKinds keeps known kinds and drops junk", () => {
  assert.deepEqual(parseMutedNotificationKinds(["EVENT_OVERDUE_NO_FACT", "nope", "EVENT_OVERDUE_NO_FACT"]), [
    "EVENT_OVERDUE_NO_FACT"
  ]);
  assert.deepEqual(parseMutedNotificationKinds("all"), []);
  assert.deepEqual(parseMutedNotificationKinds(["USER_ERROR", "EVENT_STATUS_DONE"]), [
    "USER_ERROR",
    "EVENT_STATUS_DONE"
  ]);
});
