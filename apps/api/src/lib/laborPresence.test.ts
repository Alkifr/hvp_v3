import assert from "node:assert/strict";
import test from "node:test";

import { laborPresenceFromMetrics } from "./laborPresence.js";

test("any stored hours in a series count as filled, including zero", () => {
  assert.deepEqual(
    laborPresenceFromMetrics([
      { block: "ADD_BUDGET", manHours: 0 },
      { block: "WP_PLAN_MPS", manHours: null },
      { block: "NRC_ACTUAL", manHours: 4 }
    ]),
    { budget: true, mps: false, actual: true }
  );
});

test("empty metric list means every series is missing", () => {
  assert.deepEqual(laborPresenceFromMetrics([]), { budget: false, mps: false, actual: false });
});
