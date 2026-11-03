import assert from "node:assert/strict";
import test from "node:test";

import { deadlineChangeBlockedWhileDone } from "./eventStatus.ts";

test("deadline stays editable until the event is done", () => {
  assert.equal(
    deadlineChangeBlockedWhileDone({
      existingStatus: "IN_PROGRESS",
      requestedStatus: "IN_PROGRESS",
      existingDeadlineAt: new Date("2026-10-23T09:00:00.000Z"),
      requestedDeadlineAt: new Date("2026-10-24T09:00:00.000Z"),
      requestedProvided: true
    }),
    false
  );
});

test("completed event rejects a deadline change until status leaves done", () => {
  const existing = new Date("2026-10-23T09:00:00.000Z");
  assert.equal(
    deadlineChangeBlockedWhileDone({
      existingStatus: "DONE",
      requestedStatus: "DONE",
      existingDeadlineAt: existing,
      requestedDeadlineAt: new Date("2026-10-24T09:00:00.000Z"),
      requestedProvided: true
    }),
    true
  );
  assert.equal(
    deadlineChangeBlockedWhileDone({
      existingStatus: "DONE",
      requestedStatus: "IN_PROGRESS",
      existingDeadlineAt: existing,
      requestedDeadlineAt: new Date("2026-10-24T09:00:00.000Z"),
      requestedProvided: true
    }),
    false
  );
  assert.equal(
    deadlineChangeBlockedWhileDone({
      existingStatus: "DONE",
      requestedDeadlineAt: existing,
      existingDeadlineAt: new Date("2026-10-23T09:00:30.000Z"),
      requestedProvided: true
    }),
    false
  );
});
