import assert from "node:assert/strict";
import test from "node:test";

import {
  placementChangeNeedsReason,
  requestedEventChangeNeedsReason,
  resolveChangeReasonSelection,
  scheduleMoveNeedsReason
} from "./changeReason.js";

const base = {
  status: "IN_PROGRESS",
  aircraftId: "ac-1",
  startAt: new Date("2026-11-10T10:00:00.000Z"),
  endAt: new Date("2026-11-12T10:00:00.000Z"),
  budgetStartAt: null,
  budgetEndAt: null,
  actualStartAt: null,
  actualEndAt: null,
  hangarId: "hangar-1",
  deadlineAt: new Date("2026-11-20T10:00:00.000Z"),
  placements: [
    {
      startAt: new Date("2026-11-10T10:00:00.000Z"),
      endAt: new Date("2026-11-12T10:00:00.000Z"),
      hangarId: "hangar-1",
      layoutId: "layout-1",
      standId: "stand-1"
    }
  ]
};

test("technical event fields do not require a change reason", () => {
  assert.equal(requestedEventChangeNeedsReason({ before: base, after: { title: "Новое имя" } }), false);
  assert.equal(requestedEventChangeNeedsReason({ before: base, after: { status: "DONE", notes: "x" } }), false);
  assert.equal(requestedEventChangeNeedsReason({ before: base, after: { workshopId: "shop", lineBase: "LINE" } }), false);
  assert.equal(requestedEventChangeNeedsReason({ before: base, after: {} }), false);
});

test("dates, board, deadline, hangar and cancellation require a change reason", () => {
  assert.equal(
    requestedEventChangeNeedsReason({
      before: base,
      after: { startAt: new Date("2026-11-11T10:00:00.000Z") }
    }),
    true
  );
  assert.equal(requestedEventChangeNeedsReason({ before: base, after: { aircraftId: "ac-2" } }), true);
  assert.equal(
    requestedEventChangeNeedsReason({
      before: base,
      after: { deadlineAt: new Date("2026-11-21T10:00:00.000Z") }
    }),
    true
  );
  assert.equal(requestedEventChangeNeedsReason({ before: base, after: { hangarId: "hangar-2" } }), true);
  assert.equal(requestedEventChangeNeedsReason({ before: base, after: { status: "CANCELLED" } }), true);
  assert.equal(
    requestedEventChangeNeedsReason({
      before: { ...base, status: "CANCELLED" },
      after: { status: "IN_PROGRESS" }
    }),
    false
  );
});

test("same clock minute and stand-only placement edits do not require a reason", () => {
  assert.equal(
    requestedEventChangeNeedsReason({
      before: base,
      after: { startAt: new Date("2026-11-10T10:00:30.000Z") }
    }),
    false
  );
  const next = [
    {
      startAt: new Date("2026-11-10T10:00:00.000Z"),
      endAt: new Date("2026-11-12T10:00:00.000Z"),
      hangarId: "hangar-1",
      layoutId: "layout-2",
      standId: "stand-9"
    }
  ];
  assert.equal(placementChangeNeedsReason(base.placements, next), false);
  assert.equal(requestedEventChangeNeedsReason({ before: base, after: { placements: next } }), false);
  assert.equal(
    placementChangeNeedsReason(base.placements, [{ ...base.placements[0], hangarId: "hangar-2" }]),
    true
  );
});

test("a formal reason is required and the comment stays optional", () => {
  const rows = [
    { id: "a", name: "Нет слота", isActive: true, sortOrder: 20 },
    { id: "b", name: "Запрос оператора", isActive: true, sortOrder: 10 },
    { id: "c", name: "Скрытая", isActive: false, sortOrder: 30 }
  ];
  assert.throws(() => resolveChangeReasonSelection(rows, { required: true, ids: [] }), /Выберите причину изменения/);
  const stored = resolveChangeReasonSelection(rows, { required: true, ids: ["a", "b"], comment: "  " });
  assert.deepEqual(stored.changeReasonIds, ["b", "a"]);
  assert.equal(stored.reason, "Запрос оператора, Нет слота");
  assert.equal(stored.changeReasonComment, null);
  const withComment = resolveChangeReasonSelection(rows, { required: true, ids: ["b"], comment: "уточнение" });
  assert.equal(withComment.reason, "Запрос оператора. уточнение");
  assert.equal(resolveChangeReasonSelection([], { required: true }).reason, null);
  assert.throws(() => resolveChangeReasonSelection(rows, { required: true, ids: ["c"] }), /справочника/);
});

test("a move needs a reason only for dates, hangar or clearing another hangar", () => {
  assert.equal(
    scheduleMoveNeedsReason({
      fromStart: base.startAt,
      fromEnd: base.endAt,
      toStart: base.startAt,
      toEnd: base.endAt,
      fromHangarId: "hangar-1",
      toHangarId: "hangar-1"
    }),
    false
  );
  assert.equal(
    scheduleMoveNeedsReason({
      fromStart: base.startAt,
      fromEnd: base.endAt,
      toStart: new Date("2026-11-11T10:00:00.000Z"),
      toEnd: base.endAt,
      fromHangarId: "hangar-1",
      toHangarId: "hangar-1"
    }),
    true
  );
  assert.equal(
    scheduleMoveNeedsReason({
      fromStart: base.startAt,
      fromEnd: base.endAt,
      toStart: base.startAt,
      toEnd: base.endAt,
      fromHangarId: "hangar-1",
      toHangarId: "hangar-2"
    }),
    true
  );
  assert.equal(
    scheduleMoveNeedsReason({
      fromStart: base.startAt,
      fromEnd: base.endAt,
      toStart: base.startAt,
      toEnd: base.endAt,
      fromHangarId: "hangar-1",
      toHangarId: "hangar-1",
      clearsHangar: true
    }),
    true
  );
});
