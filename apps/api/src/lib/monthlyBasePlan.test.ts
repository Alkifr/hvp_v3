import assert from "node:assert/strict";
import test from "node:test";

import {
  MONTHLY_BASE_PLAN_NRC_FACTOR,
  buildMonthlyBasePlan,
  buildTzDays,
  occupancyForEvent
} from "./monthlyBasePlan.js";

const TZ = 180;

function ev(partial: Partial<Parameters<typeof buildMonthlyBasePlan>[0]["events"][number]> & { eventId: string }) {
  return {
    title: "A01",
    startAt: new Date("2026-09-02T06:00:00.000Z"),
    endAt: new Date("2026-09-04T06:00:00.000Z"),
    aircraftLabel: "RA-73108",
    aircraftTypeName: "B737-800",
    operatorCode: "AFL",
    operatorId: "op1",
    aircraftId: "ac1",
    aircraftTypeId: "t1",
    eventTypeId: "et1",
    hangarId: "h1",
    hangarName: "ангар №5",
    workshopId: "w1",
    workshopName: "ЦПТО 5",
    color: "#38bdf8",
    metrics: [],
    planLines: [],
    ...partial
  };
}

test("buildTzDays marks weekends in Moscow offset", () => {
  const days = buildTzDays(new Date("2026-09-04T21:00:00.000Z"), new Date("2026-09-07T21:00:00.000Z"), TZ);
  assert.equal(days[0]?.key, "2026-09-05");
  assert.equal(days[0]?.weekend, true);
  assert.equal(days[1]?.key, "2026-09-06");
  assert.equal(days[1]?.weekend, true);
  assert.equal(days[2]?.weekend, false);
});

test("occupancy splits local day and evening halves", () => {
  const days = buildTzDays(new Date("2026-09-01T21:00:00.000Z"), new Date("2026-09-03T21:00:00.000Z"), TZ);
  const occ = occupancyForEvent(
    new Date("2026-09-02T06:00:00.000Z"), // 09:00 MSK
    new Date("2026-09-02T15:00:00.000Z"), // 18:00 MSK
    days,
    TZ
  );
  const day = occ[days.findIndex((d) => d.key === "2026-09-02")];
  assert.equal(day?.day, true);
  assert.equal(day?.evening, true);
});

test("buildMonthlyBasePlan includes all overlapping events, spreads MPS, adds NRC", () => {
  const result = buildMonthlyBasePlan({
    from: new Date("2026-09-01T21:00:00.000Z"),
    to: new Date("2026-09-05T21:00:00.000Z"),
    tzOffsetMinutes: TZ,
    events: [
      ev({
        eventId: "e1",
        metrics: [
          { block: "WP_PLAN_MPS", department: "ME", manHours: 80 },
          { block: "WP_PLAN_MPS", department: "INT", manHours: 20 }
        ]
      }),
      ev({
        eventId: "e-line",
        workshopId: "w2",
        workshopName: "ЦПТО 4"
      })
    ]
  });
  assert.equal(result.events.length, 2);
  const first = result.events.find((e) => e.eventId === "e1");
  assert.equal(first?.laborSource, "mps");
  assert.equal(first?.qualifications.ME, 80);
  assert.equal(first?.qualifications.INT, 20);
  assert.ok(Math.abs(result.summary.laborTotal - 100) < 1);
  assert.ok(Math.abs(result.summary.laborWithNrc - 100 * MONTHLY_BASE_PLAN_NRC_FACTOR) < 1.2);
  assert.equal(result.shops.length, 2);
  const cpto5 = result.shops.find((s) => s.workshopName === "ЦПТО 5");
  const plannedSum = cpto5!.planned.reduce((s, n) => s + n, 0);
  assert.ok(Math.abs(plannedSum - 100) < 1);
});

test("MPS hours stay on occupied night half when visit starts at 18:00", () => {
  const result = buildMonthlyBasePlan({
    from: new Date("2026-09-01T21:00:00.000Z"),
    to: new Date("2026-09-03T21:00:00.000Z"),
    tzOffsetMinutes: TZ,
    events: [
      ev({
        eventId: "e-night",
        startAt: new Date("2026-09-02T15:00:00.000Z"), // 18:00 MSK
        endAt: new Date("2026-09-02T20:00:00.000Z"), // 23:00 MSK
        metrics: [{ block: "WP_PLAN_MPS", department: "ME", manHours: 10 }]
      })
    ]
  });
  const idx = result.days.findIndex((d) => d.key === "2026-09-02");
  const row = result.events[0];
  assert.equal(row?.occupied[idx]?.day, false);
  assert.equal(row?.occupied[idx]?.evening, true);
  assert.equal(row?.labor[idx]?.day, 0);
  assert.equal(row?.labor[idx]?.evening, 10);
});

test("day-coded plan lines follow night occupancy when the slot is only at night", () => {
  const result = buildMonthlyBasePlan({
    from: new Date("2026-09-01T21:00:00.000Z"),
    to: new Date("2026-09-03T21:00:00.000Z"),
    tzOffsetMinutes: TZ,
    events: [
      ev({
        eventId: "e-night-lines",
        startAt: new Date("2026-09-02T15:00:00.000Z"),
        endAt: new Date("2026-09-02T20:00:00.000Z"),
        planLines: [
          {
            date: new Date("2026-09-02T00:00:00.000Z"),
            plannedMinutes: 90,
            shiftCode: "DAY",
            shiftStartMin: 8 * 60,
            skillCode: "ME"
          }
        ]
      })
    ]
  });
  const idx = result.days.findIndex((d) => d.key === "2026-09-02");
  assert.equal(result.events[0]?.labor[idx]?.day, 0);
  assert.equal(result.events[0]?.labor[idx]?.evening, 1.5);
});

test("plan lines override MPS spread", () => {
  const result = buildMonthlyBasePlan({
    from: new Date("2026-09-01T21:00:00.000Z"),
    to: new Date("2026-09-05T21:00:00.000Z"),
    tzOffsetMinutes: TZ,
    events: [
      ev({
        eventId: "e2",
        metrics: [{ block: "WP_PLAN_MPS", department: "ME", manHours: 999 }],
        planLines: [
          {
            date: new Date("2026-09-02T00:00:00.000Z"),
            plannedMinutes: 60,
            shiftCode: "DAY",
            shiftStartMin: 8 * 60,
            skillCode: "ME"
          },
          {
            date: new Date("2026-09-02T00:00:00.000Z"),
            plannedMinutes: 120,
            shiftCode: "NIGHT",
            shiftStartMin: 20 * 60,
            skillCode: "INT"
          }
        ]
      })
    ]
  });
  assert.equal(result.events[0]?.laborSource, "plan_lines");
  assert.equal(result.events[0]?.laborTotal, 3);
  const idx = result.days.findIndex((d) => d.key === "2026-09-02");
  assert.equal(result.events[0]?.labor[idx]?.day, 1);
  assert.equal(result.events[0]?.labor[idx]?.evening, 2);
  assert.equal(result.events[0]?.qualifications.ME, 1);
  assert.equal(result.events[0]?.qualifications.INT, 2);
});
