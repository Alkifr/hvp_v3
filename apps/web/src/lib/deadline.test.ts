import assert from "node:assert/strict";
import test from "node:test";

import { slotExitAfterDeadline } from "./deadline.ts";

test("slot exit after deadline is a hint condition", () => {
  assert.equal(slotExitAfterDeadline("2026-10-23T18:00", "2026-10-23T12:00"), true);
  assert.equal(slotExitAfterDeadline("2026-10-23T12:00", "2026-10-23T18:00"), false);
  assert.equal(slotExitAfterDeadline("2026-10-23T12:00", "2026-10-23T12:00"), false);
  assert.equal(slotExitAfterDeadline("", "2026-10-23T12:00"), false);
  assert.equal(slotExitAfterDeadline("2026-10-23T18:00", ""), false);
});
