import assert from "node:assert/strict";
import test from "node:test";

import {
  coerceMajor,
  collapseDayNight,
  collapseSparseHours,
  labelForScale,
  layoutTimelineScale,
  majorLabelForScale,
  timelineBoundsMs
} from "./timelineScale.ts";

test("MSK day starts three hours before UTC midnight", () => {
  const local = timelineBoundsMs("2026-11-16", "2026-11-16", "LOCAL");
  const utc = timelineBoundsMs("2026-11-16", "2026-11-16", "UTC");
  assert.equal(local.end - local.start, 86_400_000);
  assert.equal(utc.start - local.start, 3 * 3_600_000);
});

test("hour scale of one MSK day has 24 ticks and a day major", () => {
  const layout = layoutTimelineScale("2026-11-16", "2026-11-16", "day", "hour", "LOCAL");
  assert.equal(layout.minor.length, 24);
  assert.equal(layout.minor[0]?.label, "00");
  assert.equal(layout.minor[6]?.label, "06");
  assert.equal(layout.major.length, 1);
  assert.equal(layout.major[0]?.label, "16.11.2026");
  const width = layout.minor.reduce((sum, cell) => sum + cell.width, 0);
  assert.ok(Math.abs(width - 100) < 0.01);
});

test("sparse hours keep 0, 6, 12 and 18", () => {
  const layout = layoutTimelineScale("2026-11-16", "2026-11-16", "day", "hour", "LOCAL");
  const sparse = collapseSparseHours(layout.minor);
  assert.deepEqual(sparse.map((cell) => cell.label), ["00", "06", "12", "18"]);
  assert.ok(Math.abs(sparse.reduce((sum, cell) => sum + cell.width, 0) - 100) < 0.01);
});

test("day mode splits a calendar day into night, day and night", () => {
  const layout = layoutTimelineScale("2026-11-16", "2026-11-16", "day", "hour", "LOCAL");
  const parts = collapseDayNight(layout.minor);
  assert.deepEqual(parts.map((cell) => cell.label), ["ночь", "день", "ночь"]);
  assert.ok(Math.abs(parts[0]!.width - (8 / 24) * 100) < 0.05);
  assert.ok(Math.abs(parts[1]!.width - (12 / 24) * 100) < 0.05);
  assert.ok(Math.abs(parts[2]!.width - (4 / 24) * 100) < 0.05);
});

test("major stays coarser than minor", () => {
  assert.equal(coerceMajor("day", "hour"), "day");
  assert.equal(coerceMajor("hour", "day"), "week");
  assert.equal(coerceMajor("year", "year"), "year");
});

test("labels match the gantt wording", () => {
  const { start } = timelineBoundsMs("2026-11-16", "2026-11-22", "LOCAL");
  assert.equal(labelForScale(start, "hour", "LOCAL"), "00");
  assert.equal(labelForScale(start, "day", "LOCAL"), "16");
  assert.equal(majorLabelForScale(start, "day", "LOCAL"), "16.11.2026");
});
