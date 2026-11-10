import assert from "node:assert/strict";
import test from "node:test";

import { EventStatus } from "./eventStatusCatalog.js";
import { reconcileEventStatus } from "./eventStatus.js";

const startAt = new Date("2026-11-01T08:00:00.000Z");
const endAt = new Date("2026-11-10T18:00:00.000Z");
const now = new Date("2026-11-06T12:00:30.000Z");

test("future actual end does not auto-complete an event", () => {
  const actualEndAt = new Date("2026-11-08T18:00:00.000Z");
  const result = reconcileEventStatus({
    status: EventStatus.IN_PROGRESS,
    startAt,
    endAt,
    actualStartAt: startAt,
    actualEndAt,
    now
  });

  assert.equal(result.status, EventStatus.IN_PROGRESS);
  assert.equal(result.statusChanged, false);
  assert.equal(result.actualEndAt, actualEndAt);
});

test("approved event with a future actual end moves to in progress, not done", () => {
  const result = reconcileEventStatus({
    status: EventStatus.APPROVED_BY_EXECUTOR,
    startAt,
    endAt,
    actualStartAt: startAt,
    actualEndAt: new Date("2026-11-08T18:00:00.000Z"),
    now
  });

  assert.equal(result.status, EventStatus.IN_PROGRESS);
});

test("actual end in the same minute completes the event", () => {
  const result = reconcileEventStatus({
    status: EventStatus.IN_PROGRESS,
    startAt,
    endAt,
    actualStartAt: startAt,
    actualEndAt: new Date("2026-11-06T12:00:10.000Z"),
    now
  });

  assert.equal(result.status, EventStatus.DONE);
});

test("actual end in the next minute does not complete the event", () => {
  const result = reconcileEventStatus({
    status: EventStatus.IN_PROGRESS,
    startAt,
    endAt,
    actualStartAt: startAt,
    actualEndAt: new Date("2026-11-06T12:01:00.000Z"),
    now
  });

  assert.equal(result.status, EventStatus.IN_PROGRESS);
});

test("automatic done is rolled back while the actual end is still ahead", () => {
  const actualEndAt = new Date("2026-11-08T18:00:00.000Z");
  const started = reconcileEventStatus({
    status: EventStatus.DONE,
    startAt,
    endAt,
    actualStartAt: startAt,
    actualEndAt,
    now
  });
  assert.equal(started.status, EventStatus.IN_PROGRESS);
  assert.equal(started.actualEndAt, actualEndAt);

  const notStarted = reconcileEventStatus({
    status: EventStatus.DONE,
    startAt,
    endAt,
    actualStartAt: startAt,
    actualEndAt,
    now: new Date("2026-10-01T12:00:00.000Z")
  });
  assert.equal(notStarted.status, EventStatus.APPROVED_BY_EXECUTOR);
});

test("explicit done still completes and copies an empty fact", () => {
  const result = reconcileEventStatus({
    status: EventStatus.IN_PROGRESS,
    startAt,
    endAt,
    actualStartAt: null,
    actualEndAt: null,
    now,
    forceDone: true
  });

  assert.equal(result.status, EventStatus.DONE);
  assert.equal(result.actualFilledFromOper, true);
  assert.equal(result.actualStartAt, startAt);
  assert.equal(result.actualEndAt, endAt);
});

test("completed event with an empty fact does not copy a future operational end", () => {
  const result = reconcileEventStatus({
    status: EventStatus.DONE,
    startAt,
    endAt,
    actualStartAt: null,
    actualEndAt: null,
    now
  });

  assert.equal(result.status, EventStatus.IN_PROGRESS);
  assert.equal(result.actualStartAt, null);
  assert.equal(result.actualEndAt, null);
  assert.equal(result.actualFilledFromOper, false);
});
