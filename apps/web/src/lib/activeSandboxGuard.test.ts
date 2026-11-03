import assert from "node:assert/strict";
import test from "node:test";

import { getActiveSandboxChosenAt, setActiveSandboxId } from "./api.ts";
import { shouldDropActiveSandbox } from "./activeSandboxGuard.ts";

const base = {
  isLoading: false,
  isFetching: false,
  chosenAt: 1_000
};

test("keeps a sandbox chosen after the cached list was loaded", () => {
  assert.equal(
    shouldDropActiveSandbox({
      ...base,
      activeId: "new",
      sandboxes: [{ id: "old", status: "ACTIVE" }],
      dataUpdatedAt: 900
    }),
    false
  );
});

test("keeps the choice when the list timestamp ties the choice", () => {
  assert.equal(
    shouldDropActiveSandbox({
      ...base,
      activeId: "new",
      sandboxes: [{ id: "old", status: "ACTIVE" }],
      dataUpdatedAt: 1_000
    }),
    false
  );
});

test("drops a sandbox missing from a list fetched after the choice", () => {
  assert.equal(
    shouldDropActiveSandbox({
      ...base,
      activeId: "gone",
      sandboxes: [{ id: "old", status: "ACTIVE" }],
      dataUpdatedAt: 1_100
    }),
    true
  );
});

test("does not drop while the sandbox list is refetching", () => {
  assert.equal(
    shouldDropActiveSandbox({
      ...base,
      activeId: "new",
      sandboxes: [{ id: "old", status: "ACTIVE" }],
      isFetching: true,
      dataUpdatedAt: 1_100
    }),
    false
  );
});

test("drops an archived sandbox once the fresh list confirms it", () => {
  assert.equal(
    shouldDropActiveSandbox({
      ...base,
      activeId: "sb",
      sandboxes: [{ id: "sb", status: "ARCHIVED" }],
      dataUpdatedAt: 1_100
    }),
    true
  );
});

test("keeps an active sandbox present in a fresh list", () => {
  assert.equal(
    shouldDropActiveSandbox({
      ...base,
      activeId: "sb",
      sandboxes: [{ id: "sb", status: "ACTIVE" }],
      dataUpdatedAt: 1_100
    }),
    false
  );
});

test("does not drop when no sandbox is selected", () => {
  assert.equal(
    shouldDropActiveSandbox({
      ...base,
      activeId: null,
      sandboxes: [],
      dataUpdatedAt: 1_100
    }),
    false
  );
});

test("choosing a sandbox records the choice time before storage access", () => {
  const before = Date.now();
  setActiveSandboxId("sb-choice");
  const chosenAt = getActiveSandboxChosenAt();
  assert.ok(chosenAt >= before);
  setActiveSandboxId(null);
  assert.ok(getActiveSandboxChosenAt() >= chosenAt);
});
