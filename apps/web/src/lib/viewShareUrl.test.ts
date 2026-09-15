import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAnalyticsViewShare,
  parseGanttViewShare,
  parseHangarViewShare,
  parseRefViewShare,
  queryHasViewShare,
  serializeAnalyticsViewShare,
  serializeGanttViewShare,
  serializeHangarViewShare,
  serializeRefViewShare
} from "./viewShareUrl.ts";

test("event-only hash is not a view share", () => {
  const q = new URLSearchParams("event=abc&sandbox=s1");
  assert.equal(queryHasViewShare(q), false);
  assert.equal(parseGanttViewShare(q), null);
});

test("gantt serialize omits defaults and round-trips filters", () => {
  const q = serializeGanttViewShare({
    rangeFromApplied: "2026-01-01",
    rangeToApplied: "2026-03-01",
    groupMode: "HANGAR_STAND",
    panelView: "TABLE",
    ganttDisplayMode: "PLAN_FACT",
    majorScale: "month",
    minorScale: "week",
    timelineTimeMode: "UTC",
    selectedHangarIds: ["h1"],
    filterAircraftTypeIds: ["t1"],
    filterOperatorIds: ["o1"],
    filterAircraftIds: ["a1"],
    filterEventTypeIds: [],
    filterWorkshopIds: [],
    filterStatusIds: ["IN_PROGRESS"],
    filterPlanningKinds: ["UNPLANNED"],
    filterLineBases: ["LINE"],
    fitWidth: true,
    showAllPlacementLinks: false,
    showExternalMroOnGantt: false,
    showGanttNotes: true,
    sandboxId: "sb1"
  });
  assert.equal(q.get("from"), "2026-01-01");
  assert.equal(q.get("to"), "2026-03-01");
  assert.equal(q.get("group"), "h");
  assert.equal(q.get("view"), "t");
  assert.equal(q.get("pf"), "1");
  assert.equal(q.get("maj"), "month");
  assert.equal(q.get("min"), "week");
  assert.equal(q.get("tz"), "utc");
  assert.equal(q.get("fit"), "1");
  assert.equal(q.has("links"), false);
  assert.equal(q.get("ext"), "0");
  assert.equal(q.get("notes"), "1");
  assert.equal(q.get("hangar"), "h1");
  assert.equal(q.get("et"), null);
  assert.equal(q.get("sandbox"), "sb1");

  const parsed = parseGanttViewShare(q);
  assert.ok(parsed);
  assert.equal(parsed.groupMode, "HANGAR_STAND");
  assert.equal(parsed.panelView, "TABLE");
  assert.equal(parsed.ganttDisplayMode, "PLAN_FACT");
  assert.deepEqual(parsed.selectedHangarIds, ["h1"]);
  assert.deepEqual(parsed.filterEventTypeIds, []);
  assert.deepEqual(parsed.filterPlanningKinds, ["UNPLANNED"]);
  assert.equal(parsed.showExternalMroOnGantt, false);
  assert.equal(parsed.showGanttNotes, true);
});

test("gantt prod contour writes empty sandbox", () => {
  const q = serializeGanttViewShare({
    rangeFromApplied: "2026-09-01",
    rangeToApplied: "2026-09-30",
    groupMode: "AIRCRAFT",
    panelView: "DIAGRAM",
    ganttDisplayMode: "CURRENT",
    majorScale: "week",
    minorScale: "day",
    timelineTimeMode: "LOCAL",
    selectedHangarIds: [],
    filterAircraftTypeIds: [],
    filterOperatorIds: [],
    filterAircraftIds: [],
    filterEventTypeIds: [],
    filterWorkshopIds: [],
    filterStatusIds: [],
    filterPlanningKinds: [],
    filterLineBases: [],
    fitWidth: false,
    showAllPlacementLinks: false,
    showExternalMroOnGantt: true,
    showGanttNotes: false,
    sandboxId: null
  });
  assert.equal(q.get("sandbox"), "");
  assert.equal(q.get("group"), null);
  assert.equal(q.get("view"), null);
});

test("hangar layouts encode hangarId.layoutId", () => {
  const q = serializeHangarViewShare({
    fromDate: "2026-02-01",
    toDate: "2026-02-20",
    viewMode: "moment",
    minuteOffset: 720,
    layoutIdByHangarId: { h1: "l1", h2: "l2" },
    filterHangarIds: ["h1"],
    filterOperatorIds: [],
    filterAircraftTypeIds: [],
    filterAircraftIds: [],
    filterEventTypeIds: [],
    sandboxId: null
  });
  assert.equal(q.get("mode"), "moment");
  assert.equal(q.get("at"), "720");
  const parsed = parseHangarViewShare(q);
  assert.ok(parsed);
  assert.equal(parsed.viewMode, "moment");
  assert.deepEqual(parsed.layoutIdByHangarId, { h1: "l1", h2: "l2" });
});

test("analytics tab and grain round-trip", () => {
  const q = serializeAnalyticsViewShare({
    tab: "util",
    fromDate: "2026-01-10",
    toDate: "2026-01-20",
    compareA: "prod",
    compareB: "sb2",
    efficiencyGrain: "month",
    filterHangarIds: [],
    filterOperatorIds: ["op1"],
    filterAircraftTypeIds: [],
    filterAircraftIds: [],
    filterEventTypeIds: [],
    sandboxId: "sb2"
  });
  assert.equal(q.get("tab"), "util");
  assert.equal(q.get("grain"), "month");
  assert.equal(q.get("ca"), null);
  assert.equal(q.get("cb"), "sb2");
  const parsed = parseAnalyticsViewShare(q);
  assert.ok(parsed);
  assert.equal(parsed.tab, "util");
  assert.equal(parsed.efficiencyGrain, "month");
  assert.deepEqual(parsed.filterOperatorIds, ["op1"]);
});

test("ref catalog kind search and hangar layout round-trip", () => {
  const q = serializeRefViewShare({
    kind: "stands",
    search: "A1",
    filterHangarId: "h1",
    filterLayoutId: "l9"
  });
  assert.equal(q.get("kind"), "stands");
  assert.equal(q.get("q"), "A1");
  assert.equal(q.get("hangar"), "h1");
  assert.equal(q.get("layout"), "l9");
  assert.equal(q.has("sandbox"), false);
  const parsed = parseRefViewShare(q);
  assert.ok(parsed);
  assert.equal(parsed.kind, "stands");
  assert.equal(parsed.search, "A1");
  assert.equal(parsed.filterHangarId, "h1");
  assert.equal(parsed.filterLayoutId, "l9");
});

test("ref operators always writes kind", () => {
  const q = serializeRefViewShare({
    kind: "operators",
    search: "",
    filterHangarId: "",
    filterLayoutId: ""
  });
  assert.equal(q.get("kind"), "operators");
  const parsed = parseRefViewShare(q);
  assert.ok(parsed);
  assert.equal(parsed.kind, "operators");
});
