import assert from "node:assert/strict";
import test from "node:test";

import {
  availabilityKey,
  balanceClass,
  capacityConstraint,
  capacityHours,
  categoryCapacity,
  clampResourcePeriod,
  dateKey,
  formatPersonnelNumber,
  mondayOfWeek,
  monthPeriod,
  periodDates,
  personnelViewDefaults,
  readPersonnelView,
  shiftPeriod,
  shiftWeek,
  periodTimelinePosition,
  timelinePosition,
  weekDates
} from "./personnelPlanning.ts";

test("week helpers use Monday through Sunday", () => {
  assert.equal(mondayOfWeek("2026-10-29"), "2026-10-26");
  assert.deepEqual(weekDates("2026-10-29"), [
    "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"
  ]);
  assert.equal(shiftWeek("2026-10-26", 1), "2026-11-02");
});

test("grid keys normalize API dates", () => {
  assert.equal(dateKey("2026-10-27T00:00:00.000Z"), "2026-10-27");
  assert.equal(availabilityKey("2026-10-27T00:00:00Z", "s1", "a1", "B1"), "2026-10-27|s1|a1|B1");
});

test("period timeline clips to the selected dates and marks edges outside the frame", () => {
  assert.deepEqual(
    periodTimelinePosition("2026-10-25T21:00:00Z", "2026-10-27T21:00:00Z", "2026-10-26", "2026-11-01"),
    { left: 0, width: 28.57142857142857, startsBefore: false, endsAfter: false }
  );
  const beyond = periodTimelinePosition("2026-10-25T21:00:00Z", "2026-11-03T10:00:00Z", "2026-10-26", "2026-11-01");
  assert.equal(beyond?.startsBefore, false);
  assert.equal(beyond?.endsAfter, true);
  assert.equal(beyond?.left, 0);
  assert.equal(beyond?.width, 100);
});

test("timeline clips periods to the selected week", () => {
  assert.deepEqual(
    timelinePosition("2026-10-25T21:00:00Z", "2026-10-27T21:00:00Z", "2026-10-26"),
    { left: 0, width: 28.57142857142857 }
  );
  assert.equal(timelinePosition("2026-11-03T00:00:00Z", "2026-11-04T00:00:00Z", "2026-10-26"), null);
});

test("resource period is any start and at most 31 days", () => {
  assert.deepEqual(monthPeriod("2026-10-27"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(clampResourcePeriod("2026-10-01", "2026-12-15"), { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(periodDates("2026-10-20", "2026-11-05").length, 17);
  assert.deepEqual(shiftPeriod("2026-10-01", "2026-10-31", 1), { from: "2026-11-01", to: "2026-12-01" });
  assert.deepEqual(clampResourcePeriod("", "2026-10-31"), { from: "", to: "" });
  assert.deepEqual(periodDates("", "2026-10-31"), []);
  assert.deepEqual(clampResourcePeriod("2026-10-15", "2026-10-31"), { from: "2026-10-15", to: "2026-10-31" });
});

test("personnel view restores the last workshop and period", () => {
  const restored = readPersonnelView(
    { tab: "balance", weekStart: "2026-10-29", periodFrom: "2026-10-01", periodTo: "2026-12-15", workshopId: "cpto1", aircraftTypeId: "rrj" },
    { periodFrom: "2026-11-01", periodTo: "2026-11-30", weekStart: "2026-11-02" }
  );
  assert.equal(restored.tab, "balance");
  assert.equal(restored.weekStart, "2026-10-26");
  assert.deepEqual({ from: restored.periodFrom, to: restored.periodTo }, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(restored.workshopId, "cpto1");
  assert.equal(readPersonnelView(null, { periodFrom: "2026-11-01", periodTo: "2026-11-30", weekStart: "2026-11-02" }).tab, "resources");
  const defaults = personnelViewDefaults(new Date("2026-10-27T12:00:00Z"));
  assert.deepEqual(
    { from: defaults.periodFrom, to: defaults.periodTo, weekStart: defaults.weekStart },
    { from: "2026-10-01", to: "2026-10-31", weekStart: "2026-10-26" }
  );
  assert.equal(readPersonnelView({ periodFrom: "нет" }, defaults).periodFrom, "2026-10-01");
});

test("capacity compares load with available hours and keeps skills separate", () => {
  assert.deepEqual(capacityHours(80, 100), { load: 80, capacity: 100, slack: 20, loadFactorPct: 80 });
  assert.equal(capacityHours(10, 0).loadFactorPct, null);
  assert.equal(capacityHours(10, 0).slack, -10);
  const day = {
    demand: { ME: 40, AV: 10 },
    authorizedSupply: { ME: 30, AV: 50 },
    qualificationSupply: { AM: 12 }
  };
  assert.deepEqual(
    categoryCapacity(day, { key: "ME", planDepartment: "ME", supply: "department" }),
    capacityHours(40, 30)
  );
  assert.equal(categoryCapacity(day, { key: "AM", planDepartment: null, supply: "qualification" }).capacity, 12);
  assert.equal(categoryCapacity(day, { key: "AM", planDepartment: null, supply: "qualification" }).load, 0);
  assert.equal(capacityConstraint([
    { label: "ME", ...capacityHours(120, 100) },
    { label: "AV", ...capacityHours(10, 80) }
  ])?.label, "ME");
  assert.equal(capacityConstraint([
    { label: "ME", ...capacityHours(90, 100) },
    { label: "AV", ...capacityHours(10, 80) }
  ])?.kind, "nearest");
  assert.equal(capacityConstraint([{ label: "ME", ...capacityHours(0, 0) }]), null);
});

test("capacity tab is restored with the personnel view", () => {
  const defaults = personnelViewDefaults(new Date("2026-10-27T12:00:00Z"));
  assert.equal(readPersonnelView({ tab: "capacity", periodFrom: "2026-10-01", periodTo: "2026-10-07" }, defaults).tab, "capacity");
});

test("balance formatting is stable", () => {
  assert.equal(balanceClass(2), "positive");
  assert.equal(balanceClass(-0.2), "negative");
  assert.equal(balanceClass(0), "neutral");
  assert.equal(formatPersonnelNumber(1234.56), "1 234,6");
});
