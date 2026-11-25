import assert from "node:assert/strict";
import test from "node:test";
import type { QueryClient } from "@tanstack/react-query";

import {
  applyPresence,
  draftTouchedBySignal,
  invalidateLiveSignal,
  peersOnPage,
  personnelQueryLive,
  signalVisible,
  type LiveSignal
} from "./liveSync.ts";

const viewer = { sandboxId: "s1", userId: "u1" };

function signal(patch: Partial<LiveSignal> & Pick<LiveSignal, "topic" | "scope">): LiveSignal {
  return { at: "2026-11-25T10:00:00.000Z", ...patch };
}

test("signalVisible drops a foreign sandbox and another user's bell", () => {
  assert.equal(signalVisible({ scope: "sandbox:s1" }, viewer), true);
  assert.equal(signalVisible({ scope: "sandbox:s2" }, viewer), false);
  assert.equal(signalVisible({ scope: "prod" }, viewer), false);
  assert.equal(signalVisible({ scope: "prod" }, { sandboxId: null, userId: "u1" }), true);
  assert.equal(signalVisible({ scope: "global" }, viewer), true);
  assert.equal(signalVisible({ scope: "user:u1" }, viewer), true);
  assert.equal(signalVisible({ scope: "user:u2" }, viewer), false);
});

test("topic map invalidates plan queries and leaves personnel archives", () => {
  const calls: unknown[] = [];
  const qc = {
    invalidateQueries: (filters: unknown) => {
      calls.push(filters);
      return Promise.resolve();
    }
  } as Pick<QueryClient, "invalidateQueries">;
  invalidateLiveSignal(qc, signal({ topic: "events", scope: "prod" }));
  assert.deepEqual(
    calls.map((call) => (call as { queryKey: unknown }).queryKey),
    [
      ["events"],
      ["event-history"],
      ["event-tows"],
      ["itp-events"],
      ["itp-plan"],
      ["analytics", "primary-table"],
      ["hangar-planning"]
    ]
  );
  calls.length = 0;
  invalidateLiveSignal(qc, signal({ topic: "tows", scope: "prod" }));
  assert.ok(calls.some((call) => (call as { queryKey: string[] }).queryKey[0] === "tows-registry"));
  assert.equal(personnelQueryLive(["personnel", "week"]), true);
  assert.equal(personnelQueryLive(["personnel", "plan-archive", "a"]), false);
  assert.equal(personnelQueryLive(["personnel", "plan-archives"]), false);
  invalidateLiveSignal(qc, signal({ topic: "personnel", scope: "global" }));
  const predicate = (calls.at(-1) as { predicate: (q: { queryKey: readonly unknown[] }) => boolean }).predicate;
  assert.equal(predicate({ queryKey: ["personnel", "balance"] }), true);
  assert.equal(predicate({ queryKey: ["personnel", "plan-archive", "1"] }), false);
});

test("open draft hears another user and ignores own save", () => {
  const other = signal({ topic: "events", scope: "sandbox:s1", ids: ["e1"], actorId: "u2" });
  assert.equal(draftTouchedBySignal(other, "e1", viewer), true);
  assert.equal(draftTouchedBySignal(other, "e2", viewer), false);
  assert.equal(draftTouchedBySignal({ ...other, actorId: "u1" }, "e1", viewer), false);
  assert.equal(draftTouchedBySignal(signal({ topic: "events", scope: "sandbox:s1", bulk: true, actorId: "u2" }), "e9", viewer), true);
  assert.equal(draftTouchedBySignal(signal({ topic: "ref", scope: "global", bulk: true }), "e1", viewer), false);
});

test("presence strip keeps gantt peers and drops stale or other pages", () => {
  const now = Date.parse("2026-11-25T10:00:00.000Z");
  applyPresence(
    signal({
      topic: "presence",
      scope: "prod",
      presence: { userId: "u2", displayName: "Борис", page: "gantt", eventId: "e1" }
    }),
    now
  );
  applyPresence(
    signal({
      topic: "presence",
      scope: "prod",
      presence: { userId: "u3", displayName: "Вера", page: "hangar" }
    }),
    now
  );
  applyPresence(
    signal({
      topic: "presence",
      scope: "prod",
      presence: { userId: "u2", displayName: "Борис", page: "gantt" }
    }),
    now + 1000
  );
  assert.equal(peersOnPage("gantt", "u1", now + 1000)[0]?.eventId, "e1");
  assert.equal(peersOnPage("hangar", "u1", now + 1000)[0]?.displayName, "Вера");
  applyPresence(
    signal({
      topic: "presence",
      scope: "prod",
      presence: { userId: "u3", displayName: "Вера", page: "ref" }
    }),
    now + 2000
  );
  assert.equal(peersOnPage("hangar", "u1", now + 2000).length, 0);
  assert.equal(peersOnPage("gantt", "u1", now + 1000 + 3 * 60 * 1000 + 1).length, 0);
});
