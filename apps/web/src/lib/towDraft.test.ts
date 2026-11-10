import assert from "node:assert/strict";
import test from "node:test";

import { planEdgeTows } from "./edgeTowPlan.ts";
import { installRandomUuidPolyfill, safeRandomUuid } from "./randomId.ts";
import {
  newTowDraftKey,
  resolveTowPlacementId,
  towDraftDirty,
  towMutationPlan,
  towRowsFromServer,
  type TowDraftRow
} from "./towDraft.ts";

const base = (patch: Partial<TowDraftRow> = {}): TowDraftRow => ({
  key: "tow-1",
  serverId: "tow-1",
  deleted: false,
  startAt: "2026-10-23T06:00:00.000Z",
  endAt: "2026-10-23T06:30:00.000Z",
  fromLabel: "МС",
  toLabel: "12",
  placementId: "pl-1",
  ...patch
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("draft key is unique without crypto.randomUUID", () => {
  const cryptoObj = globalThis.crypto;
  const original = cryptoObj.randomUUID;
  Object.defineProperty(cryptoObj, "randomUUID", { configurable: true, value: undefined });
  try {
    const first = newTowDraftKey();
    const second = newTowDraftKey();
    assert.match(first, new RegExp(`^local-${UUID_RE.source.slice(1, -1)}$`));
    assert.notEqual(first, second);
  } finally {
    Object.defineProperty(cryptoObj, "randomUUID", { configurable: true, value: original });
  }
});

test("draft key survives a randomUUID that throws", () => {
  const cryptoObj = globalThis.crypto;
  const original = cryptoObj.randomUUID;
  Object.defineProperty(cryptoObj, "randomUUID", {
    configurable: true,
    value() {
      throw new TypeError("crypto.randomUUID is not a function");
    }
  });
  try {
    assert.match(newTowDraftKey(), new RegExp(`^local-${UUID_RE.source.slice(1, -1)}$`));
    assert.match(safeRandomUuid(), UUID_RE);
  } finally {
    Object.defineProperty(cryptoObj, "randomUUID", { configurable: true, value: original });
  }
});

test("polyfill makes crypto.randomUUID callable when the native method throws", () => {
  const cryptoObj = globalThis.crypto;
  const original = cryptoObj.randomUUID;
  Object.defineProperty(cryptoObj, "randomUUID", {
    configurable: true,
    value() {
      throw new TypeError("crypto.randomUUID is not a function");
    }
  });
  try {
    installRandomUuidPolyfill();
    assert.match(cryptoObj.randomUUID(), UUID_RE);
  } finally {
    Object.defineProperty(cryptoObj, "randomUUID", { configurable: true, value: original });
  }
});

test("server snapshot is clean until a local edit", () => {
  const rows = towRowsFromServer([
    { id: "tow-1", startAt: "2026-10-23T06:00:00.000Z", endAt: "2026-10-23T06:30:00.000Z", fromLabel: "МС", toLabel: "12", placementId: "pl-1" }
  ]);
  assert.equal(towDraftDirty(rows, rows), false);
  const edited = rows.map((row) => ({ ...row, toLabel: "14" }));
  assert.equal(towDraftDirty(edited, rows), true);
  assert.equal(towMutationPlan(edited, rows).update.length, 1);
});

test("new and deleted rows stay pending until the card save", () => {
  const baseline = [base()];
  const withNew = [...baseline, base({ key: "local-1", serverId: null, placementId: null })];
  assert.equal(towDraftDirty(withNew, baseline), true);
  assert.deepEqual(towMutationPlan(withNew, baseline).create.map((row) => row.key), ["local-1"]);
  const removed = baseline.map((row) => ({ ...row, deleted: true }));
  assert.deepEqual(towMutationPlan(removed, baseline).deleteIds, ["tow-1"]);
});

test("edge plan stays local and a replaced placement id is remapped", () => {
  const start = new Date("2026-10-23T06:00:00.000Z");
  const end = new Date("2026-10-23T10:00:00.000Z");
  const plan = planEdgeTows({
    minutes: 30,
    placements: [{ id: "stage-a", origin: "MANUAL", startAt: start, endAt: end, standCode: "12" }],
    existing: []
  });
  assert.equal(plan.create.length, 2);
  assert.equal(plan.create[0]?.fromLabel, "МС");
  assert.equal(plan.create[1]?.toLabel, "МС");

  const before = [
    { key: "stage-a", origin: "MANUAL" as const, standId: "s1", hangarId: "h1", startMs: start.getTime(), endMs: end.getTime() }
  ];
  const after = [{ id: "stage-b", origin: "MANUAL", standId: "s1", hangarId: "h1", startAt: start.toISOString(), endAt: end.toISOString() }];
  assert.equal(resolveTowPlacementId("stage-a", before, after), "stage-b");
  assert.equal(resolveTowPlacementId("stage-a", before, null), "stage-a");
});
