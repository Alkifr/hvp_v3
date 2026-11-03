import assert from "node:assert/strict";
import test from "node:test";

import { resolveStandLocation } from "./standLocation.js";

test("hangar without layout and stand does not occupy a slot", () => {
  assert.deepEqual(resolveStandLocation({ hangarId: "h1", layoutId: null, standId: null }), {
    hangarId: "h1",
    layoutId: null,
    standId: null,
    occupiesStand: false
  });
});

test("layout without stand is kept and does not occupy a slot", () => {
  assert.deepEqual(resolveStandLocation({ hangarId: "h1", layoutId: "l1", standId: "" }), {
    hangarId: "h1",
    layoutId: "l1",
    standId: null,
    occupiesStand: false
  });
});

test("hangar, layout and stand occupy the slot", () => {
  assert.deepEqual(resolveStandLocation({ hangarId: "h1", layoutId: "l1", standId: "s1" }), {
    hangarId: "h1",
    layoutId: "l1",
    standId: "s1",
    occupiesStand: true
  });
});

test("stand without layout does not occupy a slot", () => {
  assert.deepEqual(resolveStandLocation({ hangarId: "h1", layoutId: null, standId: "s1" }), {
    hangarId: "h1",
    layoutId: null,
    standId: null,
    occupiesStand: false
  });
});

test("clearing the hangar clears layout and stand", () => {
  assert.deepEqual(resolveStandLocation({ hangarId: null, layoutId: "l1", standId: "s1" }), {
    hangarId: null,
    layoutId: null,
    standId: null,
    occupiesStand: false
  });
});
