import assert from "node:assert/strict";
import test from "node:test";

import { normalizePlacementGaps } from "./placementGaps.js";

const at = (value: string) => new Date(value);

test("adds an AUTO_GAP between manual placements", () => {
  const result = normalizePlacementGaps(
    [
      { startAt: at("2026-08-01T08:00:00Z"), endAt: at("2026-08-02T08:00:00Z"), hangarId: "h1" },
      { startAt: at("2026-08-03T08:00:00Z"), endAt: at("2026-08-04T08:00:00Z"), hangarId: "h2" }
    ],
    { enabled: true }
  );

  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((placement) => [placement.origin, placement.startAt.toISOString(), placement.endAt.toISOString()]),
    [
      ["MANUAL", "2026-08-01T08:00:00.000Z", "2026-08-02T08:00:00.000Z"],
      ["AUTO_GAP", "2026-08-02T08:00:00.000Z", "2026-08-03T08:00:00.000Z"],
      ["MANUAL", "2026-08-03T08:00:00.000Z", "2026-08-04T08:00:00.000Z"]
    ]
  );
});

test("rebuilds AUTO_GAP stages idempotently", () => {
  const source = [
    { startAt: at("2026-08-01T08:00:00Z"), endAt: at("2026-08-02T08:00:00Z"), origin: "MANUAL" as const },
    { startAt: at("2026-08-02T08:00:00Z"), endAt: at("2026-08-03T08:00:00Z"), origin: "AUTO_GAP" as const },
    { startAt: at("2026-08-03T08:00:00Z"), endAt: at("2026-08-04T08:00:00Z"), origin: "MANUAL" as const }
  ];

  const once = normalizePlacementGaps(source, { enabled: true });
  const twice = normalizePlacementGaps(once, { enabled: true });

  assert.deepEqual(twice, once);
});

test("removes generated stages when automatic filling is disabled", () => {
  const result = normalizePlacementGaps(
    [
      { startAt: at("2026-08-01T08:00:00Z"), endAt: at("2026-08-02T08:00:00Z"), origin: "MANUAL" as const },
      { startAt: at("2026-08-02T08:00:00Z"), endAt: at("2026-08-03T08:00:00Z"), origin: "AUTO_GAP" as const },
      { startAt: at("2026-08-03T08:00:00Z"), endAt: at("2026-08-04T08:00:00Z"), origin: "MANUAL" as const }
    ],
    { enabled: false }
  );

  assert.equal(result.length, 2);
  assert.ok(result.every((placement) => placement.origin === "MANUAL"));
});

test("does not replace a manual no-hangar stage", () => {
  const result = normalizePlacementGaps(
    [
      { startAt: at("2026-08-01T08:00:00Z"), endAt: at("2026-08-02T08:00:00Z"), hangarId: "h1" },
      { startAt: at("2026-08-02T08:00:00Z"), endAt: at("2026-08-03T08:00:00Z"), hangarId: null },
      { startAt: at("2026-08-03T08:00:00Z"), endAt: at("2026-08-04T08:00:00Z"), hangarId: "h2" }
    ],
    { enabled: true }
  );

  assert.equal(result.length, 3);
  assert.ok(result.every((placement) => placement.origin === "MANUAL"));
});
