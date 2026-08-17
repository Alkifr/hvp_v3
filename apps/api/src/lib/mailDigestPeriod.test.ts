import assert from "node:assert/strict";
import test from "node:test";

import {
  isScheduledDigestDue,
  isoWeekdayFromMsk,
  mskDayKey,
  parseWeekdays,
  resolveDigestPeriod,
  startOfMskDay
} from "./mailDigestPeriod.js";

test("resolveDigestPeriod last7 is MSK calendar days including today", () => {
  // 2026-08-17 10:00 MSK = 2026-08-17 07:00 UTC
  const now = new Date("2026-08-17T07:00:00.000Z");
  const { from, to } = resolveDigestPeriod({ periodMode: "last7" }, now);
  assert.equal(mskDayKey(from), "2026-08-11");
  assert.equal(from.toISOString(), startOfMskDay(new Date("2026-08-11T12:00:00.000Z")).toISOString());
  assert.equal(mskDayKey(to), "2026-08-18");
});

test("resolveDigestPeriod last1 is yesterday MSK", () => {
  const now = new Date("2026-08-17T07:00:00.000Z");
  const { from, to } = resolveDigestPeriod({ periodMode: "last1" }, now);
  assert.equal(mskDayKey(from), "2026-08-16");
  assert.equal(mskDayKey(to), "2026-08-17");
});

test("resolveDigestPeriod custom uses inclusive MSK days", () => {
  const { from, to } = resolveDigestPeriod({
    periodMode: "custom",
    customFrom: "2026-08-01",
    customTo: "2026-08-03"
  });
  assert.equal(mskDayKey(from), "2026-08-01");
  assert.equal(mskDayKey(to), "2026-08-04");
});

test("isoWeekdayFromMsk: Monday 2026-08-17", () => {
  assert.equal(isoWeekdayFromMsk(new Date("2026-08-17T07:00:00.000Z")), 1);
});

test("isScheduledDigestDue daily within 15-minute window", () => {
  const settings = {
    isActive: true,
    scheduleMode: "daily",
    scheduleTime: "09:00",
    scheduleWeekdays: [1, 2, 3, 4, 5],
    scheduleMonthDay: 1,
    lastAutoSentAt: null
  };
  // 09:07 MSK
  assert.equal(isScheduledDigestDue(settings, new Date("2026-08-17T06:07:00.000Z")), true);
  // 08:59 MSK
  assert.equal(isScheduledDigestDue(settings, new Date("2026-08-17T05:59:00.000Z")), false);
  // already sent today
  assert.equal(
    isScheduledDigestDue(
      { ...settings, lastAutoSentAt: new Date("2026-08-17T06:01:00.000Z") },
      new Date("2026-08-17T06:07:00.000Z")
    ),
    false
  );
});

test("isScheduledDigestDue weekly respects ISO weekdays", () => {
  const settings = {
    isActive: true,
    scheduleMode: "weekly",
    scheduleTime: "09:00",
    scheduleWeekdays: [1],
    scheduleMonthDay: 1,
    lastAutoSentAt: null
  };
  // Monday
  assert.equal(isScheduledDigestDue(settings, new Date("2026-08-17T06:00:00.000Z")), true);
  // Tuesday
  assert.equal(isScheduledDigestDue(settings, new Date("2026-08-18T06:00:00.000Z")), false);
});

test("parseWeekdays drops invalid values", () => {
  assert.deepEqual(parseWeekdays([1, 1, 9, "3", 0]), [1, 3]);
});
