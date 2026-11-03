import assert from "node:assert/strict";
import test from "node:test";

import { towOverlayRect } from "./towOverlay.ts";

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
