import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceColumns,
  calculatePersonnelWeek,
  departmentForSkillCode,
  summarizeResourceSlices,
  effectiveValue,
  mondayOfLocalWeek,
  mondaysCovering,
  periodDateKeys,
  qualificationsForDepartments,
  qualificationsForWorkshopSkills,
  weekDateKeys
} from "./personnelPlanning.js";
import { personnelBaselineDelta } from "./personnelPlanningData.js";

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`);
}

test("resource rows follow the category composition from the catalog", () => {
  const catalog = [
    { code: "B1", department: "ME", isAuthorized: true, sortOrder: 10 },
    { code: "LBMM", department: "ME", isAuthorized: true, sortOrder: 20 },
    { code: "AM", department: null, isAuthorized: false, sortOrder: 50 },
    { code: "NDT", department: "NDT", isAuthorized: true, sortOrder: 70 }
  ];
  assert.deepEqual(qualificationsForDepartments(catalog, ["ME"]).map((row) => row.code), ["B1", "LBMM"]);
  assert.deepEqual(qualificationsForDepartments(catalog, ["NDT", "ME"]).map((row) => row.code), ["B1", "LBMM", "NDT"]);
  assert.deepEqual(qualificationsForDepartments(catalog, []), []);
  assert.deepEqual(qualificationsForWorkshopSkills(catalog, ["ME", "AM"]).map((row) => row.code), ["B1", "LBMM", "AM"]);
});

test("qualification codes that match an MPS department feed that department", () => {
  assert.equal(departmentForSkillCode("ME"), "ME");
  assert.equal(departmentForSkillCode("CAB_REP"), "CAB_REP");
  assert.equal(departmentForSkillCode("AVIO"), null);
});

test("uses a Monday-Sunday local calendar", () => {
  assert.equal(mondayOfLocalWeek("2026-10-29"), "2026-10-26");
  assert.deepEqual(weekDateKeys("2026-10-29"), [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01"
  ]);
});

test("selects effective values and documented fallbacks", () => {
  assert.equal(effectiveValue([{ effectiveFrom: "2026-10-01", value: 12 }], "2026-09-30", 11), 11);
  assert.equal(
    effectiveValue(
      [
        { effectiveFrom: "2026-10-01", value: 12 },
        { effectiveFrom: "2026-10-20", value: 10 }
      ],
      "2026-10-27",
      11
    ),
    10
  );
});

test("calculates the requested dates instead of the whole week", () => {
  const days = calculatePersonnelWeek({
    weekStart: "2026-10-26",
    dates: ["2026-10-27", "2026-10-28"],
    events: [],
    availability: [],
    categories: [],
    norms: [],
    factorsByAircraftType: {}
  });
  assert.deepEqual(days.map((day) => day.date), ["2026-10-27", "2026-10-28"]);
  assert.deepEqual(periodDateKeys("2026-10-01", "2026-10-03"), ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(mondaysCovering("2026-10-31", "2026-11-02"), ["2026-10-26", "2026-11-02"]);
});

test("spreads MPS by exact overlap, applies factor, and separates strict from shared supply", () => {
  const days = calculatePersonnelWeek({
    weekStart: "2026-10-26",
    events: [
      {
        id: "e1",
        startAt: new Date("2026-10-26T21:00:00.000Z"),
        endAt: new Date("2026-10-28T21:00:00.000Z"),
        status: "IN_PROGRESS",
        aircraftTypeId: "a320",
        mpsHours: { ME: 48, AV: 24, PAINT: 12 }
      },
      {
        id: "deleted",
        startAt: new Date("2026-10-26T21:00:00.000Z"),
        endAt: new Date("2026-10-27T21:00:00.000Z"),
        status: "DELETED",
        aircraftTypeId: "a320",
        mpsHours: { ME: 1000 }
      }
    ],
    availability: [
      { date: "2026-10-27", categoryCode: "B1", headcount: 2 },
      { date: "2026-10-27", categoryCode: "B1", headcount: 1 },
      { date: "2026-10-27", categoryCode: "AM", headcount: 1 },
      { date: "2026-10-27", categoryCode: "PAINT", headcount: 1 }
    ],
    categories: [
      { code: "B1", department: "ME", isAuthorized: true },
      { code: "AM", department: null, isAuthorized: false },
      { code: "PAINT", department: "PAINT", isAuthorized: true }
    ],
    norms: [{ effectiveFrom: "2026-10-01", value: 11 }],
    factorsByAircraftType: { a320: [] }
  });

  const tuesday = days[1]!;
  close(tuesday.demand.ME, 33.6);
  close(tuesday.demand.AV, 16.8);
  close(tuesday.demand.PAINT, 8.4);
  assert.equal(tuesday.authorizedSupply.ME, 33);
  assert.equal(tuesday.authorizedSupply.PAINT, 11);
  assert.equal(tuesday.overallSupply, 55);
  close(tuesday.strictBalance.ME, -0.6);
  close(tuesday.overallPtoBalance, 55 - 58.8);
});

test("drill-down rows carry the day's event labor and the placement that overlaps the day", () => {
  const [monday] = calculatePersonnelWeek({
    weekStart: "2026-10-26",
    dates: ["2026-10-26"],
    includeEventDemand: true,
    demandDepartments: ["ME", "AV"],
    events: [
      {
        id: "e1",
        startAt: new Date("2026-10-25T21:00:00.000Z"),
        endAt: new Date("2026-10-27T21:00:00.000Z"),
        status: "IN_PROGRESS",
        aircraftTypeId: "rrj",
        mpsHours: { ME: 20, AV: 10, PAINT: 100 },
        title: "1A #1",
        aircraftLabel: "89100",
        eventType: "A-Check",
        operator: "AFL",
        placements: [
          {
            startAt: new Date("2026-10-25T21:00:00.000Z"),
            endAt: new Date("2026-10-26T21:00:00.000Z"),
            label: "Ангар 1 / 12"
          },
          {
            startAt: new Date("2026-10-26T21:00:00.000Z"),
            endAt: new Date("2026-10-27T21:00:00.000Z"),
            label: "Ангар 2 / 3"
          }
        ]
      }
    ],
    availability: [],
    categories: [],
    norms: [],
    factorsByAircraftType: { rrj: [{ effectiveFrom: "2020-01-01", value: 1 }] }
  });
  const [event] = monday!.eventDemand ?? [];
  assert.equal(event?.aircraftLabel, "89100");
  assert.equal(event?.eventType, "A-Check");
  assert.equal(event?.operator, "AFL");
  assert.equal(event?.title, "1A #1");
  assert.equal(event?.placement, "Ангар 1 / 12");
  close(event?.hours ?? 0, 15);
  close(event?.byDepartment.ME ?? 0, 10);
  close(event?.byDepartment.AV ?? 0, 5);
  close(event?.byDepartment.PAINT ?? 0, 0);
});

test("resource slices keep supply and demand on one workshop and aircraft type", () => {
  const slices = summarizeResourceSlices({
    weekStart: "2026-10-26",
    dates: ["2026-10-26"],
    events: [{
      id: "e1",
      startAt: new Date("2026-10-25T21:00:00.000Z"),
      endAt: new Date("2026-10-26T21:00:00.000Z"),
      status: "IN_PROGRESS",
      aircraftTypeId: "rrj",
      workshopId: "cpto1",
      mpsHours: { ME: 10 }
    }],
    availability: [{ date: "2026-10-26", workshopId: "cpto1", aircraftTypeId: "rrj", categoryCode: "B1", headcount: 2 }],
    categories: [{ code: "B1", department: "ME", isAuthorized: true }],
    demandDepartments: ["ME"],
    norms: [{ effectiveFrom: "2020-01-01", value: 11 }],
    factorsByAircraftType: { rrj: [{ effectiveFrom: "2020-01-01", value: 1 }] }
  });
  assert.equal(slices.length, 1);
  assert.equal(slices[0]?.workshopId, "cpto1");
  assert.equal(slices[0]?.aircraftTypeId, "rrj");
  close(slices[0]?.available ?? 0, 22);
  close(slices[0]?.planned ?? 0, 10);
  close(slices[0]?.difference ?? 0, 12);
});

test("B1 and LBMM hours add into ME, AM stays in the overall pool", () => {
  const [monday] = calculatePersonnelWeek({
    weekStart: "2026-10-26",
    events: [],
    availability: [
      { date: "2026-10-26", categoryCode: "B1", headcount: 1 },
      { date: "2026-10-26", categoryCode: "LBMM", headcount: 2 },
      { date: "2026-10-26", categoryCode: "AM", headcount: 4 }
    ],
    categories: [
      { code: "B1", department: "ME", isAuthorized: true },
      { code: "LBMM", department: "ME", isAuthorized: true },
      { code: "AM", department: null, isAuthorized: false }
    ],
    norms: [],
    factorsByAircraftType: {}
  });
  assert.equal(monday!.authorizedSupply.ME, 33);
  assert.equal(monday!.overallSupply, 77);
  assert.equal(monday!.qualificationSupply.AM, 44);
});

test("plan columns follow the catalog and keep a category without a department", () => {
  assert.deepEqual(
    balanceColumns([
      { code: "B1", department: "ME", sortOrder: 10 },
      { code: "INT", department: null, sortOrder: 90 },
      { code: "AM", department: null, sortOrder: 50 },
      { code: "SM", department: null, sortOrder: 60 },
      { code: "WELD", department: null, sortOrder: 120 }
    ]),
    {
      departments: ["ME", "INT"],
      lines: [
        { key: "ME", label: "ME", planDepartment: "ME", supply: "department" },
        { key: "AM", label: "AM", planDepartment: null, supply: "qualification" },
        { key: "SM", label: "SM", planDepartment: null, supply: "qualification" },
        { key: "INT", label: "INT", planDepartment: "INT", supply: "qualification" },
        { key: "WELD", label: "WELD", planDepartment: null, supply: "qualification" }
      ]
    }
  );
  const [monday] = calculatePersonnelWeek({
    weekStart: "2026-10-26",
    demandDepartments: ["ME", "INT"],
    events: [],
    availability: [
      { date: "2026-10-26", categoryCode: "INT", headcount: 2 },
      { date: "2026-10-26", categoryCode: "AM", headcount: 3 },
      { date: "2026-10-26", categoryCode: "SM", headcount: 1 }
    ],
    categories: [
      { code: "INT", department: null, isAuthorized: false },
      { code: "AM", department: null, isAuthorized: false },
      { code: "SM", department: null, isAuthorized: false }
    ],
    norms: [],
    factorsByAircraftType: {}
  });
  assert.equal(monday!.authorizedSupply.INT, 0);
  assert.equal(monday!.qualificationSupply.INT, 22);
  assert.equal(monday!.qualificationSupply.AM, 33);
  assert.equal(monday!.qualificationSupply.SM, 11);
  assert.equal(monday!.overallSupply, 66);
});

test("scopes direct-workshop demand and supply to mapped qualifications", () => {
  const [monday] = calculatePersonnelWeek({
    weekStart: "2026-10-26",
    demandDepartments: ["PAINT"],
    events: [
      {
        id: "paint-event",
        startAt: new Date("2026-10-25T21:00:00.000Z"),
        endAt: new Date("2026-10-26T21:00:00.000Z"),
        status: "IN_PROGRESS",
        aircraftTypeId: "a320",
        mpsHours: { ME: 100, PAINT: 10 }
      }
    ],
    availability: [
      { date: "2026-10-26", categoryCode: "PAINT", headcount: 1 },
      { date: "2026-10-26", categoryCode: "B1", headcount: 50 }
    ],
    categories: [{ code: "PAINT", department: "PAINT", isAuthorized: true }],
    norms: [],
    factorsByAircraftType: { a320: [{ effectiveFrom: "2020-01-01", value: 1 }] }
  });
  assert.equal(monday!.demand.ME, 0);
  assert.equal(monday!.demand.PAINT, 10);
  assert.equal(monday!.overallDemand, 10);
  assert.equal(monday!.overallSupply, 11);
  assert.equal(monday!.overallBalance, 1);
});

test("builds current-versus-locked-baseline calculation and event deltas", () => {
  const baseline = {
    events: [{ id: "old" }],
    availability: [{ id: "a", headcount: 1 }],
    norms: [{ hours: 11 }],
    factors: [],
    calculation: [
      {
        date: "2026-10-26",
        demand: { ME: 10 },
        authorizedSupply: { ME: 11 },
        strictBalance: { ME: 1 },
        overallDemand: 10,
        overallSupply: 11,
        overallBalance: 1,
        overallPtoBalance: 1
      }
    ],
    calculationByAircraftType: {
      a320: [
        {
          date: "2026-10-26",
          demand: { ME: 10 },
          authorizedSupply: { ME: 11 },
          strictBalance: { ME: 1 },
          overallDemand: 10,
          overallSupply: 11,
          overallBalance: 1,
          overallPtoBalance: 1
        }
      ]
    }
  };
  const current = {
    ...baseline,
    events: [{ id: "new" }],
    availability: [{ id: "a", headcount: 2 }],
    calculation: [
      {
        ...baseline.calculation[0],
        demand: { ME: 12 },
        authorizedSupply: { ME: 22 },
        strictBalance: { ME: 10 },
        overallDemand: 12,
        overallSupply: 22,
        overallBalance: 10,
        overallPtoBalance: 10
      }
    ],
    calculationByAircraftType: {
      a320: [
        {
          date: "2026-10-26",
          demand: { ME: 12 },
          authorizedSupply: { ME: 22 },
          strictBalance: { ME: 10 },
          overallDemand: 12,
          overallSupply: 22,
          overallBalance: 10,
          overallPtoBalance: 10
        }
      ]
    }
  };
  const delta = personnelBaselineDelta(current, baseline)!;
  assert.deepEqual(delta.events, { added: ["new"], removed: ["old"] });
  assert.equal(delta.availabilityChanged, true);
  assert.equal(delta.calculation[0]!.overallBalance, 9);
  assert.equal(delta.calculation[0]!.departments.ME.demand, 2);
  assert.equal(delta.calculationByAircraftType.a320[0]!.overallBalance, 9);
});
