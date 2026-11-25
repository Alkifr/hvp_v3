import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createLiveBus, liveSignalVisible, scopeForSandbox, type LiveSignal } from "./liveBus.js";

function capture(bus: ReturnType<typeof createLiveBus>) {
  const got: LiveSignal[] = [];
  bus.subscribe((signal) => got.push(signal));
  return got;
}

test("scopeForSandbox maps null to prod", () => {
  assert.equal(scopeForSandbox(null), "prod");
  assert.equal(scopeForSandbox("sb-1"), "sandbox:sb-1");
});

test("live bus merges ids inside the window and keeps scopes apart", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const bus = createLiveBus(400);
  const got = capture(bus);
  bus.publish({ topic: "events", scope: "prod", ids: ["a"], actorId: "u1" });
  bus.publish({ topic: "events", scope: "prod", ids: ["b"], actorId: "u2" });
  bus.publish({ topic: "events", scope: "sandbox:s1", ids: ["c"] });
  bus.publish({ topic: "notifications", scope: "user:u9", ids: ["n1"] });
  assert.equal(got.length, 0);
  mock.timers.tick(400);
  assert.equal(got.length, 3);
  const prod = got.find((signal) => signal.scope === "prod");
  assert.deepEqual(prod?.ids, ["a", "b"]);
  assert.equal(prod?.actorId, "u2");
  assert.equal(prod?.bulk, undefined);
  assert.deepEqual(got.find((signal) => signal.scope === "sandbox:s1")?.ids, ["c"]);
  assert.deepEqual(got.find((signal) => signal.scope === "user:u9")?.ids, ["n1"]);
  bus.dispose();
  mock.timers.reset();
});

test("live bus collapses a large id set into bulk without ids", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const bus = createLiveBus(400);
  const got = capture(bus);
  bus.publish({
    topic: "events",
    scope: "prod",
    ids: Array.from({ length: 51 }, (_, i) => `e${i}`)
  });
  mock.timers.tick(400);
  assert.equal(got.length, 1);
  assert.equal(got[0]?.bulk, true);
  assert.equal(got[0]?.ids, undefined);
  bus.dispose();
  mock.timers.reset();
});

test("explicit bulk drops ids already queued for the same key", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const bus = createLiveBus(400);
  const got = capture(bus);
  bus.publish({ topic: "tows", scope: "prod", ids: ["t1"] });
  bus.publish({ topic: "tows", scope: "prod", bulk: true });
  mock.timers.tick(400);
  assert.equal(got[0]?.bulk, true);
  assert.equal(got[0]?.ids, undefined);
  bus.dispose();
  mock.timers.reset();
});

test("presence is delivered immediately", () => {
  const bus = createLiveBus(400);
  const got = capture(bus);
  bus.publish({
    topic: "presence",
    scope: "prod",
    presence: { userId: "u1", displayName: "Анна", page: "gantt", eventId: "e1" }
  });
  assert.equal(got.length, 1);
  assert.equal(got[0]?.presence?.displayName, "Анна");
  bus.dispose();
});

test("liveSignalVisible keeps foreign sandbox and other users out", () => {
  const viewer = { sandboxId: "s1", userId: "u1" };
  assert.equal(liveSignalVisible({ scope: "sandbox:s1" }, viewer), true);
  assert.equal(liveSignalVisible({ scope: "prod" }, viewer), false);
  assert.equal(liveSignalVisible({ scope: "sandbox:s2" }, viewer), false);
  assert.equal(liveSignalVisible({ scope: "global" }, viewer), true);
  assert.equal(liveSignalVisible({ scope: "user:u1" }, viewer), true);
  assert.equal(liveSignalVisible({ scope: "user:u2" }, viewer), false);
  assert.equal(liveSignalVisible({ scope: "prod" }, { sandboxId: null, userId: "u1" }), true);
});
