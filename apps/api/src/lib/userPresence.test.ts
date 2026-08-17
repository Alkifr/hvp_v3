import assert from "node:assert/strict";
import test from "node:test";

import { heatmapDayRange, mskDayKey } from "./userPresence.js";

test("mskDayKey uses UTC+3 calendar date", () => {
  // 2026-08-17 00:30 MSK = 2026-08-16 21:30 UTC
  assert.equal(mskDayKey(new Date("2026-08-16T21:30:00.000Z")), "2026-08-17");
  // still previous MSK day
  assert.equal(mskDayKey(new Date("2026-08-16T20:59:00.000Z")), "2026-08-16");
});

test("heatmapDayRange returns 119 consecutive MSK dates ending today", () => {
  const now = new Date("2026-08-17T10:00:00.000Z");
  const { keys, from } = heatmapDayRange(now);
  assert.equal(keys.length, 119);
  assert.equal(keys[keys.length - 1], "2026-08-17");
  assert.equal(keys[0], mskDayKey(from));
});
