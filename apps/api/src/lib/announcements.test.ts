import assert from "node:assert/strict";
import test from "node:test";

import {
  announcementStatus,
  announcementVisibleWhere,
  compareAnnouncementsForPopup,
  isAnnouncementKind,
  isAnnouncementVisible
} from "./announcements.js";

test("isAnnouncementKind accepts catalog values", () => {
  assert.equal(isAnnouncementKind("UPDATE"), true);
  assert.equal(isAnnouncementKind("OUTAGE"), true);
  assert.equal(isAnnouncementKind("USER_ERROR"), false);
});

test("isAnnouncementVisible hides inactive and expired notices", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  assert.equal(isAnnouncementVisible({ isActive: true, endsAt: null }, now), true);
  assert.equal(isAnnouncementVisible({ isActive: false, endsAt: null }, now), false);
  assert.equal(isAnnouncementVisible({ isActive: true, endsAt: new Date("2026-08-17T11:59:00.000Z") }, now), false);
  assert.equal(isAnnouncementVisible({ isActive: true, endsAt: new Date("2026-08-17T12:00:00.000Z") }, now), true);
  assert.equal(isAnnouncementVisible({ isActive: true, endsAt: new Date("2026-08-20T00:00:00.000Z") }, now), true);
});

test("announcementStatus reflects inactive and expired", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  assert.equal(announcementStatus({ isActive: false, endsAt: new Date("2026-08-20T00:00:00.000Z") }, now), "inactive");
  assert.equal(announcementStatus({ isActive: true, endsAt: new Date("2026-08-16T00:00:00.000Z") }, now), "expired");
  assert.equal(announcementStatus({ isActive: true, endsAt: null }, now), "active");
});

test("compareAnnouncementsForPopup prefers outage then newer", () => {
  const older = { kind: "OUTAGE", createdAt: new Date("2026-08-01T00:00:00.000Z") };
  const newerOutage = { kind: "OUTAGE", createdAt: new Date("2026-08-10T00:00:00.000Z") };
  const update = { kind: "UPDATE", createdAt: new Date("2026-08-16T00:00:00.000Z") };
  const items = [update, older, newerOutage].sort(compareAnnouncementsForPopup);
  assert.equal(items[0], newerOutage);
  assert.equal(items[1], older);
  assert.equal(items[2], update);
});

test("announcementVisibleWhere keeps open-ended and not-yet-ended rows", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  const where = announcementVisibleWhere(now);
  assert.equal(where.isActive, true);
  assert.deepEqual(where.OR, [{ endsAt: null }, { endsAt: { gte: now } }]);
});
