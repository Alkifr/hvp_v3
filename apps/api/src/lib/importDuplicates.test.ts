import assert from "node:assert/strict";
import test from "node:test";

import {
  FILE_DUPLICATE_WARNING_PREFIX,
  PLAN_DUPLICATE_WARNING_PREFIX,
  fileDuplicateWarnings,
  planDuplicateWarnings,
  type ImportDuplicateRow,
  type PlanDuplicateEvent
} from "./importDuplicates.js";

const aircraft = "aircraft-1";
const otherAircraft = "aircraft-2";
const checkType = "type-a";
const otherType = "type-c";

function row(partial: Partial<ImportDuplicateRow> & Pick<ImportDuplicateRow, "rowIndex" | "startAt" | "endAt">): ImportDuplicateRow {
  return {
    aircraftId: aircraft,
    eventTypeId: checkType,
    title: `Событие ${partial.rowIndex}`,
    tail: "RA-00000",
    ...partial
  };
}

function planEvent(partial: Partial<PlanDuplicateEvent> & Pick<PlanDuplicateEvent, "startAt" | "endAt">): PlanDuplicateEvent {
  return {
    id: "event-1",
    aircraftId: aircraft,
    eventTypeId: checkType,
    title: "Уже в плане",
    tail: "RA-00000",
    ...partial
  };
}

test("overlapping rows of the same aircraft and event type warn both sides", () => {
  const warnings = fileDuplicateWarnings([
    row({ rowIndex: 2, title: "Из выгрузки А", startAt: new Date("2026-07-15T06:00:00.000Z"), endAt: new Date("2026-07-18T15:00:00.000Z") }),
    row({ rowIndex: 5, title: "Из выгрузки Б", startAt: new Date("2026-07-17T06:00:00.000Z"), endAt: new Date("2026-07-20T15:00:00.000Z") })
  ]);

  assert.match(warnings.get(2) ?? "", new RegExp(`^${FILE_DUPLICATE_WARNING_PREFIX}`));
  assert.match(warnings.get(2) ?? "", /со строкой 5 «Из выгрузки Б»/);
  assert.match(warnings.get(5) ?? "", /со строкой 2 «Из выгрузки А»/);
  assert.match(warnings.get(2) ?? "", /RA-00000/);
});

test("same aircraft with another event type or a touching period is not a duplicate", () => {
  const warnings = fileDuplicateWarnings([
    row({ rowIndex: 2, startAt: new Date("2026-07-15T06:00:00.000Z"), endAt: new Date("2026-07-18T15:00:00.000Z") }),
    row({
      rowIndex: 3,
      eventTypeId: otherType,
      startAt: new Date("2026-07-15T06:00:00.000Z"),
      endAt: new Date("2026-07-18T15:00:00.000Z")
    }),
    row({
      rowIndex: 4,
      aircraftId: otherAircraft,
      tail: "RA-11111",
      startAt: new Date("2026-07-15T06:00:00.000Z"),
      endAt: new Date("2026-07-18T15:00:00.000Z")
    }),
    row({ rowIndex: 5, startAt: new Date("2026-07-18T15:00:00.000Z"), endAt: new Date("2026-07-20T15:00:00.000Z") })
  ]);

  assert.equal(warnings.size, 0);
});

test("an overlapping event already in the plan is a probable duplicate", () => {
  const imported = row({
    rowIndex: 2,
    startAt: new Date("2026-07-15T06:00:00.000Z"),
    endAt: new Date("2026-07-18T15:00:00.000Z")
  });
  const warnings = planDuplicateWarnings(
    [imported],
    [
      planEvent({
        startAt: new Date("2026-07-16T06:00:00.000Z"),
        endAt: new Date("2026-07-19T15:00:00.000Z")
      })
    ]
  );

  assert.match(warnings.get(2) ?? "", new RegExp(`^${PLAN_DUPLICATE_WARNING_PREFIX}`));
  assert.match(warnings.get(2) ?? "", /«Уже в плане» 16\.07\.2026 09:00–19\.07\.2026 18:00/);
});

test("a plan event outside the imported period is ignored", () => {
  const warnings = planDuplicateWarnings(
    [row({ rowIndex: 2, startAt: new Date("2026-07-15T06:00:00.000Z"), endAt: new Date("2026-07-18T15:00:00.000Z") })],
    [planEvent({ startAt: new Date("2026-08-01T06:00:00.000Z"), endAt: new Date("2026-08-04T15:00:00.000Z") })]
  );
  assert.equal(warnings.size, 0);
});
