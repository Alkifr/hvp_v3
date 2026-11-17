import assert from "node:assert/strict";
import test from "node:test";

import { diffPlanPayloads, mskLocalToMs, selectPlanHistory, wasBecameText } from "./personnelPlanHistory.ts";

const family = { periodFrom: "2026-11-01", periodTo: "2026-11-30", workshopLabel: "ЦПТО5, ЦПТО3" };

const items = [
  { id: "first", ...family, workshopLabel: "ЦПТО3, ЦПТО5", createdAt: "2026-11-05T12:00:00.000Z", title: "исходный" },
  { id: "mid", ...family, createdAt: "2026-11-15T09:30:00.000Z", title: "середина" },
  { id: "late", ...family, createdAt: "2026-11-28T15:00:00.000Z", title: "конец" }
];

test("history on the 15th is the mid-month snapshot against the original", () => {
  const picked = selectPlanHistory(items, mskLocalToMs("2026-11-15T18:00"), family);
  assert.equal(picked.error, "");
  assert.equal(picked.baseline?.id, "first");
  assert.equal(picked.target?.id, "mid");
});

test("a date before the first save explains that the plan did not exist yet", () => {
  const picked = selectPlanHistory(items, mskLocalToMs("2026-11-01"), family);
  assert.match(picked.error ?? "", /ещё не было/);
});

test("diff writes was and became for a moved event and a changed day", () => {
  const before = {
    from: "2026-11-01",
    to: "2026-11-30",
    departments: ["ME"],
    events: [{
      id: "e1",
      title: "C-check",
      aircraftLabel: "RA-1",
      statusLabel: "План",
      startAt: "2026-11-01T05:00:00.000Z",
      endAt: "2026-11-10T15:00:00.000Z",
      hangar: { code: "1" },
      placements: [{ startAt: "2026-11-01T05:00:00.000Z", endAt: "2026-11-10T15:00:00.000Z", hangar: { code: "1" }, stand: { code: "A" } }]
    }],
    calculation: [{ date: "2026-11-15", demand: { ME: 10 }, authorizedSupply: { ME: 12 }, strictBalance: { ME: 2 }, eventDemand: [{ id: "e1", byDepartment: { ME: 40 } }] }]
  };
  const after = {
    ...before,
    events: [{
      ...before.events[0],
      startAt: "2026-11-03T05:00:00.000Z",
      placements: [{ startAt: "2026-11-03T05:00:00.000Z", endAt: "2026-11-10T15:00:00.000Z", hangar: { code: "5" }, stand: { code: "B" } }]
    }],
    calculation: [{ date: "2026-11-15", demand: { ME: 18 }, authorizedSupply: { ME: 12 }, strictBalance: { ME: -6 }, eventDemand: [{ id: "e1", byDepartment: { ME: 48 } }] }]
  };
  const changes = diffPlanPayloads(before, after);
  const event = changes.find((row) => row.eventId === "e1");
  assert.ok(event);
  assert.match(event.changed, /срок/);
  assert.match(event.changed, /место/);
  assert.match(event.changed, /часы/);
  assert.match(wasBecameText(event), /^Было: /);
  assert.match(wasBecameText(event), /Стало: /);
  const day = changes.find((row) => row.what.startsWith("Потребность ME"));
  assert.equal(day?.before, "10");
  assert.equal(day?.after, "18");
});
