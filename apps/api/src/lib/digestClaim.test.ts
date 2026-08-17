import assert from "node:assert/strict";
import test from "node:test";

import { startOfMskDay } from "./mailDigestPeriod.js";
import { canClaimDigestSlot, digestVariantLockKey } from "./digestClaim.js";

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

test("digestVariantLockKey is stable and distinct", () => {
  const a = digestVariantLockKey("11111111-1111-4111-8111-111111111111");
  const b = digestVariantLockKey("22222222-2222-4222-8222-222222222222");
  assert.equal(a, digestVariantLockKey("11111111-1111-4111-8111-111111111111"));
  assert.notEqual(a, b);
  assert.equal(Number.isInteger(a), true);
});
