import assert from "node:assert/strict";
import test from "node:test";

import { pickScopedPlacement, resolveMassHangarSearch } from "./massHangarScope.js";

const hangars = [
  { id: "b", name: "Ангар B" },
  { id: "a", name: "Ангар A" },
  { id: "c", name: "Ангар C" }
];

test("a non-empty selection is a hard whitelist unless strict mode is turned off", () => {
  assert.deepEqual(
    resolveMassHangarSearch({ selectedIds: ["c", "a", "missing"], activeHangars: hangars }),
    { mode: "only", orderedIds: ["c", "a"], preferredIds: ["c", "a"] }
  );
  assert.deepEqual(
    resolveMassHangarSearch({ strictHangars: true, selectedIds: ["b"], activeHangars: hangars }),
    { mode: "only", orderedIds: ["b"], preferredIds: ["b"] }
  );
});

test("flexible mode keeps selected hangars first and leaves the other active hangars as fallback", () => {
  assert.deepEqual(
    resolveMassHangarSearch({ strictHangars: false, selectedIds: ["c", "c"], activeHangars: hangars }),
    { mode: "prefer", orderedIds: ["c", "a", "b"], preferredIds: ["c"] }
  );
});

test("an empty selection searches every active hangar by name", () => {
  assert.deepEqual(resolveMassHangarSearch({ strictHangars: true, selectedIds: [], activeHangars: hangars }), {
    mode: "all",
    orderedIds: ["a", "b", "c"],
    preferredIds: []
  });
});

test("strict mode does not fall back to other hangars when every selected hangar is inactive", () => {
  assert.deepEqual(
    resolveMassHangarSearch({ strictHangars: true, selectedIds: ["gone"], activeHangars: hangars }),
    { mode: "only", orderedIds: [], preferredIds: [] }
  );
});

test("strict placement ignores a free hangar outside the selected list", () => {
  const entries = [
    { hangarId: "preferred", priorityScore: 10 },
    { hangarId: "other", priorityScore: 500 }
  ];
  const picked = pickScopedPlacement(entries, () => 1, {
    preferredHangarIds: new Set(["preferred"]),
    strict: true
  });
  assert.equal(picked?.entry.hangarId, "preferred");
});

test("flexible placement stays inside preferred hangars while they have a free slot", () => {
  const entries = [
    { hangarId: "preferred", priorityScore: 1 },
    { hangarId: "other", priorityScore: 900 }
  ];
  const picked = pickScopedPlacement(
    entries,
    (entry) => (entry.hangarId === "other" ? 1 : 50),
    { preferredHangarIds: new Set(["preferred"]), strict: false }
  );
  assert.equal(picked?.entry.hangarId, "preferred");
  assert.equal(picked?.slot, 50);
});

test("flexible placement uses another active hangar only when preferred hangars have no slot", () => {
  const entries = [
    { hangarId: "preferred", priorityScore: 100 },
    { hangarId: "other", priorityScore: 1 }
  ];
  const picked = pickScopedPlacement(
    entries,
    (entry) => (entry.hangarId === "preferred" ? null : 5),
    { preferredHangarIds: new Set(["preferred"]), strict: false }
  );
  assert.equal(picked?.entry.hangarId, "other");
});

test("strict placement with no allowed hangar does not use the remaining stands", () => {
  const picked = pickScopedPlacement([{ hangarId: "other", priorityScore: 10 }], () => 1, {
    preferredHangarIds: new Set(),
    strict: true
  });
  assert.equal(picked, null);
});
