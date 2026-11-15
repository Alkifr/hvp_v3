import assert from "node:assert/strict";
import test from "node:test";

import { slotStartAfterDeadline } from "./deadline.ts";

test("slot start after the deadline date is a hint condition", () => {
  assert.equal(slotStartAfterDeadline("2026-10-24T08:00", "2026-10-23"), true);
  assert.equal(slotStartAfterDeadline("2026-10-23T18:00", "2026-10-23"), false);
  assert.equal(slotStartAfterDeadline("2026-10-23T00:00", "2026-10-23T18:00"), false);
  assert.equal(slotStartAfterDeadline("2026-10-22T18:00", "2026-10-23"), false);
  assert.equal(slotStartAfterDeadline("", "2026-10-23"), false);
  assert.equal(slotStartAfterDeadline("2026-10-24T08:00", ""), false);
});
