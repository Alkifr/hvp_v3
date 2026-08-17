import assert from "node:assert/strict";
import test from "node:test";

import { startOfMskDay } from "./mailDigestPeriod.js";
import { canClaimDigestSlot } from "./digestClaim.js";

test("canClaimDigestSlot allows first send of the MSK day", () => {
  const now = new Date("2026-08-17T10:00:00.000Z");
  assert.equal(canClaimDigestSlot(null, now), true);
  // 2026-08-16 23:59 MSK = still previous calendar day
  assert.equal(canClaimDigestSlot(new Date("2026-08-16T20:59:00.000Z"), now), true);
});

test("canClaimDigestSlot rejects a second send the same MSK day", () => {
  const now = new Date("2026-08-17T10:00:00.000Z");
  const todayStart = startOfMskDay(now);
  assert.equal(canClaimDigestSlot(todayStart, now), false);
  assert.equal(canClaimDigestSlot(new Date("2026-08-17T06:05:00.000Z"), now), false);
});
