import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PersonnelResourceGrid } from "../ui/pages/PersonnelResourceGrid.tsx";

import { savedIdList } from "./personnelPlanning.ts";
import {
  PersonnelDraftStore,
  baselineFromSheets,
  buildResourceRows,
  groupAvailabilityWrites,
  prefixOffsets,
  resourceCellKey,
  visibleRowRange,
  type ResourceGridSheet
} from "./personnelResourceModel.ts";

test("explicit empty workshop selection stays empty", () => {
  assert.deepEqual(savedIdList(undefined, "fallback"), ["fallback"]);
  assert.deepEqual(savedIdList(null, "fallback"), ["fallback"]);
  assert.deepEqual(savedIdList([], "fallback"), []);
  assert.deepEqual(savedIdList(["a", "", 1], "fallback"), ["a"]);
});

test("resource window stays small when every workshop is expanded", () => {
  const sheets: ResourceGridSheet[] = Array.from({ length: 20 }, (_, workshop) => ({
    workshopId: `w${workshop}`,
    code: `C${workshop}`,
    name: `Цех ${workshop}`,
    aircraftTypes: Array.from({ length: 4 }, (_, type) => ({ id: `t${type}`, name: `T${type}` })),
    mappedCategories: Array.from({ length: 6 }, (_, category) => ({
      categoryCode: `K${category}`,
      department: category < 4 ? "ME" : "AV",
      skillId: null
    })),
    items: [],
    weeks: []
  }));
  const rows = buildResourceRows(sheets);
  assert.ok(rows.length > 500);
  const offsets = prefixOffsets(rows.map((row) => row.height));
  const range = visibleRowRange(offsets, 0, 800, 60, 200);
  assert.equal(range.start, 0);
  assert.ok(range.end - range.start < 80);
  assert.ok(range.end < rows.length);
});

test("visible rows follow the scroll position under the sticky header", () => {
  const offsets = [0, 10, 20, 30];
  assert.deepEqual(visibleRowRange(offsets, 0, 15, 0, 0), { start: 0, end: 2 });
  assert.deepEqual(visibleRowRange(offsets, 20, 10, 0, 0), { start: 2, end: 3 });
  assert.deepEqual(visibleRowRange(offsets, 0, 40, 20, 0), { start: 0, end: 2 });
  assert.deepEqual(visibleRowRange([0], 0, 100, 0, 0), { start: 0, end: 0 });
});

test("draft keeps unsaved headcount when availability reloads", () => {
  const store = new PersonnelDraftStore();
  const key = resourceCellKey("w", "2026-10-27", "s", "a", "B1");
  store.applyBaseline({ [key]: "3" });
  assert.equal(store.get(key), "3");
  assert.equal(store.dirtyCount, 0);
  store.set(key, "5");
  assert.equal(store.dirtyCount, 1);
  store.applyBaseline({ [key]: "3" });
  assert.equal(store.get(key), "5");
  assert.equal(store.dirtyCount, 1);
  store.applyBaseline({ [key]: "5" });
  assert.equal(store.get(key), "5");
  assert.equal(store.dirtyCount, 0);
  store.applyBaseline({ [key]: "4" });
  assert.equal(store.get(key), "4");
  store.set(key, "8");
  store.applyBaseline({});
  assert.equal(store.get(key), "8");
  assert.equal(store.dirtyCount, 1);
  store.markCleanIfUnchanged([[key, "2"]]);
  assert.equal(store.dirtyCount, 1);
  store.markCleanIfUnchanged([[key, "8"]]);
  assert.equal(store.dirtyCount, 0);
  assert.equal(store.set(key, "8"), undefined);
  assert.equal(store.dirtyCount, 0);
});

test("reset restores the server headcount and leaves a saved value", () => {
  const store = new PersonnelDraftStore();
  const dirtyKey = resourceCellKey("w", "2026-10-27", "s", "a", "B1");
  const savedKey = resourceCellKey("w", "2026-10-28", "s", "a", "B1");
  store.applyBaseline({ [dirtyKey]: "3", [savedKey]: "1" });
  store.set(dirtyKey, "9");
  store.set(savedKey, "4");
  store.markCleanIfUnchanged([[savedKey, "4"]]);
  store.discardUnsaved();
  assert.equal(store.get(dirtyKey), "3");
  assert.equal(store.isDirty(dirtyKey), false);
  assert.equal(store.get(savedKey), "4");
  assert.equal(store.dirtyCount, 0);
  store.discardUnsaved();
  assert.equal(store.get(savedKey), "4");
});

test("availability writes are grouped by workshop week and keep the category", () => {
  const key = resourceCellKey("w", "2026-10-29T00:00:00.000Z", "s", "a", "B1");
  const groups = groupAvailabilityWrites([key], () => "4", () => ({ categoryCode: "B1", skillId: "skill-1" }));
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.workshopId, "w");
  assert.equal(groups[0]?.weekStart, "2026-10-26");
  assert.equal(groups[0]?.items[0]?.categoryCode, "B1");
  assert.equal(groups[0]?.items[0]?.skillId, "skill-1");
  assert.equal(groups[0]?.items[0]?.headcount, 4);
  assert.equal(groups[0]?.items[0]?.date, "2026-10-29");
});

test("selecting every workshop renders only the visible resource cells", () => {
  const sheets: ResourceGridSheet[] = Array.from({ length: 12 }, (_, workshop) => ({
    workshopId: `w${workshop}`,
    code: `C${workshop}`,
    name: `Цех ${workshop}`,
    aircraftTypes: Array.from({ length: 3 }, (_, type) => ({ id: `t${type}`, name: `T${type}` })),
    mappedCategories: Array.from({ length: 4 }, (_, category) => ({
      categoryCode: `K${category}`,
      department: "ME",
      skillId: null
    })),
    items: [{ date: "2026-10-27", shiftId: "day", aircraftTypeId: "t0", categoryCode: "K0", skillId: null, headcount: 2 }],
    weeks: [{ weekStart: "2026-10-26", version: 1, isLocked: false }]
  }));
  const dates = Array.from({ length: 31 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 9, 1 + index));
    return day.toISOString().slice(0, 10);
  });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(PersonnelResourceGrid, {
    store: new PersonnelDraftStore(),
    sheets,
    dates,
    shifts: [
      { id: "day", code: "DAY", name: "День", startMin: 8 * 60 },
      { id: "night", code: "NIGHT", name: "Ночь", startMin: 20 * 60 }
    ],
    today: "2026-10-10",
    canWrite: true,
    fetching: false
  })));
  const inputs = html.match(/<input /g)?.length ?? 0;
  assert.ok(inputs > 0);
  assert.ok(inputs < 4000, `rendered ${inputs} inputs`);
  assert.equal(html.includes("Все цеха") || html.includes("Цех 0"), true);
  assert.equal(html.includes(">2<") || html.includes('value="2"'), true);
});

test("baseline reads headcount that came back from the API", () => {
  const sheets: ResourceGridSheet[] = [{
    workshopId: "w",
    code: "C",
    name: "Цех",
    aircraftTypes: [],
    mappedCategories: [{ categoryCode: "B1", skillId: null, department: "ME" }],
    weeks: [],
    items: [{ date: "2026-10-27T00:00:00.000Z", shiftId: "s", aircraftTypeId: "a", categoryCode: "B1", skillId: null, headcount: "6" }]
  }];
  assert.equal(baselineFromSheets(sheets)[resourceCellKey("w", "2026-10-27", "s", "a", "B1")], "6");
});

test("skill headcount fills the matching category and does not override a category row", () => {
  const sheets: ResourceGridSheet[] = [{
    workshopId: "w",
    code: "C",
    name: "Цех",
    aircraftTypes: [],
    mappedCategories: [
      { categoryCode: "LBMM", skillId: null, department: "ME" },
      { categoryCode: "B1", skillId: null, department: "ME" }
    ],
    weeks: [],
    items: [
      { date: "2026-11-01", shiftId: "s", aircraftTypeId: "a", categoryCode: null, skillId: "skill-lbmm", skill: { code: "LBMM" }, headcount: 2 },
      { date: "2026-11-01", shiftId: "s", aircraftTypeId: "a", categoryCode: null, skillId: "skill-me", skill: { code: "ME" }, headcount: 10 },
      { date: "2026-11-02", shiftId: "s", aircraftTypeId: "a", categoryCode: "B1", skillId: null, headcount: 4 },
      { date: "2026-11-02", shiftId: "s", aircraftTypeId: "a", categoryCode: null, skillId: "skill-b1", skill: { code: "B1" }, headcount: 9 }
    ]
  }];
  const baseline = baselineFromSheets(sheets);
  assert.equal(baseline[resourceCellKey("w", "2026-11-01", "s", "a", "LBMM")], "2");
  assert.equal(baseline[resourceCellKey("w", "2026-11-01", "s", "a", "ME")], undefined);
  assert.equal(baseline[resourceCellKey("w", "2026-11-02", "s", "a", "B1")], "4");
});

test("unsaved headcount survives a new page load and a stale snapshot", () => {
  const memory = new Map<string, string>();
  const previous = globalThis.sessionStorage;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key)
    }
  });
  try {
    const key = resourceCellKey("w", "2026-10-27", "s", "a", "B1");
    const first = new PersonnelDraftStore();
    first.applyBaseline({ [key]: "3" });
    first.set(key, "");
    const cleared = new PersonnelDraftStore();
    cleared.applyBaseline({ [key]: "3" });
    assert.equal(cleared.get(key), "");
    assert.equal(cleared.dirtyCount, 1);
    cleared.set(key, "8");
    const reloaded = new PersonnelDraftStore();
    reloaded.applyBaseline({ [key]: "3" });
    assert.equal(reloaded.get(key), "8");
    assert.equal(reloaded.dirtyCount, 1);
    reloaded.markCleanIfUnchanged([[key, "8"]]);
    assert.equal(reloaded.dirtyCount, 0);
    reloaded.applyBaseline({ [key]: "3" });
    assert.equal(reloaded.get(key), "8");
    reloaded.applyBaseline({ [key]: "8" });
    const confirmed = new PersonnelDraftStore();
    confirmed.applyBaseline({ [key]: "8" });
    assert.equal(confirmed.get(key), "8");
    assert.equal(confirmed.dirtyCount, 0);
    confirmed.applyBaseline({ [key]: "4" });
    assert.equal(confirmed.get(key), "4");
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: previous });
    else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  }
});
