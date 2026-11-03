import assert from "node:assert/strict";
import test from "node:test";

import { eventDiffNeedsChangeReason } from "./eventChangeReason.ts";

test("notes and comment save without a change-reason dialog", () => {
  assert.equal(eventDiffNeedsChangeReason(["notes"]), false);
  assert.equal(eventDiffNeedsChangeReason(["comment"]), false);
  assert.equal(eventDiffNeedsChangeReason(["notes", "comment"]), false);
  assert.equal(eventDiffNeedsChangeReason([]), false);
});

test("schedule and status edits still require a change reason", () => {
  assert.equal(eventDiffNeedsChangeReason(["startAtLocal"]), true);
  assert.equal(eventDiffNeedsChangeReason(["status", "comment"]), true);
  assert.equal(eventDiffNeedsChangeReason(["notes", "placements"]), true);
});
