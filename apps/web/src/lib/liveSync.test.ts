import assert from "node:assert/strict";
import test from "node:test";
import type { QueryClient } from "@tanstack/react-query";

import {
  applyPresence,
  draftTouchedBySignal,
  eventInListWindow,
  invalidateLiveSignal,
  liveQueryPlan,
  mergeEventList,
  peersOnPage,
  personnelQueryLive,
  setLiveOpenEventId,
  signalVisible,
  type CachedEventRow,
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
  setLiveOpenEventId(null);
  invalidateLiveSignal(qc, signal({ topic: "events", scope: "prod" }));
  assert.deepEqual(
    calls.map((call) => (call as { queryKey: unknown }).queryKey),
    [
      ["events"],
      ["itp-events"],
      ["itp-plan"],
      ["analytics", "primary-table"],
      ["hangar-planning"]
    ]
  );
  const patched = liveQueryPlan(signal({ topic: "events", scope: "prod", ids: ["e1", "e2"] }), "e2");
  assert.deepEqual(patched.patchEventIds, ["e1", "e2"]);
  assert.equal(
    patched.invalidate.some((key) => key[0] === "events"),
    false
  );
  assert.deepEqual(
    patched.invalidate.filter((key) => key[0] === "event-history" || key[0] === "event-tows"),
    [
      ["event-history", "e2"],
      ["event-tows", "e2"]
    ]
  );
  const otherCard = liveQueryPlan(signal({ topic: "tows", scope: "prod", ids: ["e9"] }), "e2");
  assert.equal(
    otherCard.invalidate.some((key) => key[0] === "event-tows" && key[1] === "e2"),
    false
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

test("event list patch keeps the window and drops a deleted row", () => {
  const from = "2026-11-01T00:00:00.000Z";
  const to = "2026-12-01T00:00:00.000Z";
  const keep: CachedEventRow = { id: "a", startAt: "2026-11-10T00:00:00.000Z", endAt: "2026-11-12T00:00:00.000Z" };
  const gone: CachedEventRow = { id: "b", startAt: "2026-11-10T00:00:00.000Z", endAt: "2026-11-11T00:00:00.000Z" };
  const moved: CachedEventRow = { id: "c", startAt: "2026-12-10T00:00:00.000Z", endAt: "2026-12-12T00:00:00.000Z" };
  const added: CachedEventRow = { id: "d", startAt: "2026-11-20T00:00:00.000Z", endAt: "2026-11-21T00:00:00.000Z" };
  const updates = new Map<string, CachedEventRow | null>([
    ["b", null],
    ["c", moved],
    ["d", added]
  ]);
  const merged = mergeEventList([keep, gone, { id: "c", startAt: "2026-11-02T00:00:00.000Z", endAt: "2026-11-03T00:00:00.000Z" }], updates, from, to);
  assert.deepEqual(
    merged.map((row) => row.id),
    ["a", "d"]
  );
  assert.equal(eventInListWindow(moved, from, to), false);
  assert.equal(
    eventInListWindow(
      { id: "p", startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-02T00:00:00.000Z", placements: [{ startAt: "2026-11-05T00:00:00.000Z", endAt: "2026-11-06T00:00:00.000Z" }] },
      from,
      to
    ),
    true
  );
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
