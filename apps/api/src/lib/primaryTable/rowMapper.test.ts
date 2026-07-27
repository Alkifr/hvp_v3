import assert from "node:assert/strict";
import test from "node:test";

import { toPrimaryTableRow } from "./rowMapper.js";

test("maps a golden event row including metrics and external analytics", () => {
  const row = toPrimaryTableRow({
    id: "event-1",
    status: "DONE",
    planningKind: "PLANNED",
    title: "C-check",
    eventTypeId: "type-1",
    startAt: new Date("2026-07-01T08:00:00.000Z"),
    endAt: new Date("2026-07-02T08:00:00.000Z"),
    budgetStartAt: new Date("2026-07-01T08:00:00.000Z"),
    budgetEndAt: new Date("2026-07-03T08:00:00.000Z"),
    actualStartAt: new Date("2026-07-01T08:00:00.000Z"),
    actualEndAt: new Date("2026-07-04T08:00:00.000Z"),
    notes: "Причина",
    aircraft: {
      id: "aircraft-1",
      tailNumber: "RA-00001",
      manufactureDate: new Date("2016-07-01T00:00:00.000Z"),
      operatorId: "operator-1",
      operator: { name: "Заказчик" },
      type: { name: "A320" }
    },
    hangar: { id: "hangar-1", code: "H1", name: "Ангар 1", isPhysical: true, station: "SVO" },
    workshop: { name: "ME" },
    eventType: { name: "C-check" },
    primaryExtension: { fleetCode: "Флот 1", normalizedForm: "C" },
    customerSlot: {
      startAt: new Date("2026-06-30T08:00:00.000Z"),
      endAt: new Date("2026-07-03T08:00:00.000Z")
    },
    slotDeviations: [],
    reportMetrics: [
      { block: "WP_PLAN_MPS", department: "ME", manHours: 10, costAmount: null },
      { block: "WP_PLAN_MPS", department: "AV", manHours: 20, costAmount: null }
    ],
    reportScalars: [],
    placements: [],
    reservations: [],
    ptoRollingEntries: [{ externalKey: "ROLL-1", laborTotal: 30 }],
    aCheckAnalysis: { status: "Готово", quantity: 2, program: "План" }
  });

  assert.equal(row["primary.g"], "RA-00001");
  assert.equal(row["primary.l"], "C-check");
  assert.equal(row["primary.n"], "SVO");
  assert.equal(row["primary.t"], 4);
  assert.equal(row["primary.ab"], 2);
  assert.equal(row["primary.ac"], 24);
  assert.equal(row["primary.aq"], -1);
  assert.equal(row["primary.bd"], 30);
  assert.equal(row["primary.be"], 15);
  assert.equal(row["primary.fy"], "ROLL-1");
  assert.equal(row["primary.gg"], 2);
});
