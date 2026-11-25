import assert from "node:assert/strict";
import test from "node:test";

import { clippedBarTime, towOverlayRect } from "./towOverlay.ts";

const day = 86_400_000;

test("outbound tow stays on the right edge when the bar is shortened", () => {
  const barStart = Date.parse("2026-10-01T06:00:00.000Z");
  const barEnd = barStart + 10 * day;
  const rect = towOverlayRect({
    barStartMs: barStart,
    barEndMs: barEnd,
    barW: 400,
    towStartMs: barEnd - 30 * 60_000,
    towEndMs: barEnd,
    minPx: 6
  });
  assert.ok(rect);
  assert.equal(rect.width, 6);
  assert.equal(rect.left, 394);
  assert.equal(rect.anchor, "end");
});

test("inbound tow stays on the left edge", () => {
  const barStart = Date.parse("2026-10-01T06:00:00.000Z");
  const barEnd = barStart + 10 * day;
  const rect = towOverlayRect({
    barStartMs: barStart,
    barEndMs: barEnd,
    barW: 400,
    towStartMs: barStart,
    towEndMs: barStart + 30 * 60_000,
    minPx: 6
  });
  assert.ok(rect);
  assert.equal(rect.left, 0);
  assert.equal(rect.width, 6);
  assert.equal(rect.anchor, "start");
});

test("tow stays on its date when the bar is clipped by the window", () => {
  const barStart = Date.parse("2026-11-10T00:00:00.000Z");
  const barEnd = Date.parse("2026-11-22T00:00:00.000Z");
  const dayPx = 100;
  const barLeftPx = -6 * dayPx;
  const barRightPx = 6 * dayPx;
  const canvasWidth = 6 * dayPx;
  const visible = clippedBarTime({ barStartMs: barStart, barEndMs: barEnd, barLeftPx, barRightPx, canvasWidth });
  assert.equal(visible.startMs, Date.parse("2026-11-16T00:00:00.000Z"));
  assert.equal(visible.endMs, barEnd);
  const towStart = Date.parse("2026-11-16T00:00:00.000Z");
  const rect = towOverlayRect({
    barStartMs: barStart,
    barEndMs: barEnd,
    barW: canvasWidth,
    towStartMs: towStart,
    towEndMs: towStart + 30 * 60_000,
    minPx: 6,
    visibleStartMs: visible.startMs,
    visibleEndMs: visible.endMs
  });
  assert.ok(rect);
  assert.equal(rect.anchor, "middle");
  assert.ok(rect.left < dayPx);
});

test("tow outside the placement bar is not drawn", () => {
  const barStart = Date.parse("2026-10-01T06:00:00.000Z");
  const rect = towOverlayRect({
    barStartMs: barStart,
    barEndMs: barStart + day,
    barW: 80,
    towStartMs: barStart + 3 * day,
    towEndMs: barStart + 3 * day + 30 * 60_000,
    minPx: 6
  });
  assert.equal(rect, null);
});
