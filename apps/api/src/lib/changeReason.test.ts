import assert from "node:assert/strict";
import test from "node:test";

import { patchNeedsChangeReason } from "./changeReason.js";

test("notes and comment do not require a change reason", () => {
  assert.equal(patchNeedsChangeReason(["notes"]), false);
  assert.equal(patchNeedsChangeReason(["comment"]), false);
  assert.equal(patchNeedsChangeReason(["notes", "comment"]), false);
  assert.equal(patchNeedsChangeReason([]), false);
});

test("any other event field still requires a change reason", () => {
  assert.equal(patchNeedsChangeReason(["status"]), true);
  assert.equal(patchNeedsChangeReason(["comment", "startAt"]), true);
  assert.equal(patchNeedsChangeReason(["placements"]), true);
});
