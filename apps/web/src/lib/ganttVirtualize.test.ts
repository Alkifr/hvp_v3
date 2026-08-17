import assert from "node:assert/strict";
import test from "node:test";

import {
  clipRange,
  EMPTY_GANTT_VIRT,
  ganttIndexWindow,
  ganttIndexWindowNeedsRefresh,
  ganttPxWindow,
  ganttPxWindowNeedsRefresh,
  ganttXHysteresis,
  ganttXOverscan,
  measureGanttVisibleY,
  nextGanttVirtState,
  rangesOverlap
} from "./ganttVirtualize.ts";

test("ganttPxWindow covers viewport plus overscan and clamps to canvas", () => {
  assert.deepEqual(ganttPxWindow(0, 800, 10_000, 640), { left: 0, width: 800 + 640 });
  assert.deepEqual(ganttPxWindow(2000, 800, 10_000, 640), { left: 2000 - 640, width: 800 + 1280 });
  assert.deepEqual(ganttPxWindow(9600, 800, 10_000, 640), { left: 9600 - 640, width: 10_000 - (9600 - 640) });
  assert.deepEqual(ganttPxWindow(0, 800, 500, 640), { left: 0, width: 500 });
});

test("ganttPxWindowNeedsRefresh keeps window until hysteresis is eaten", () => {
  const win = { left: 0, width: 2000 };
  assert.equal(ganttPxWindowNeedsRefresh(win, 0, 800, 10_000, 200), false);
  assert.equal(ganttPxWindowNeedsRefresh(win, 1000, 800, 10_000, 200), false);
  assert.equal(ganttPxWindowNeedsRefresh(win, 1100, 800, 10_000, 200), true);
  assert.equal(ganttPxWindowNeedsRefresh(win, 0, 800, 1500, 200), true);
});

test("ganttIndexWindow slices rows with overscan", () => {
  assert.deepEqual(ganttIndexWindow(0, 400, 44, 100, 10), { startIdx: 0, endIdx: 20 });
  assert.deepEqual(ganttIndexWindow(440, 400, 44, 100, 10), { startIdx: 0, endIdx: 30 });
  assert.deepEqual(ganttIndexWindow(0, 400, 44, 5, 10), { startIdx: 0, endIdx: 5 });
  assert.deepEqual(ganttIndexWindow(0, 400, 44, 0, 10), { startIdx: 0, endIdx: 0 });
});

test("ganttIndexWindowNeedsRefresh ignores small vertical moves", () => {
  const win = { startIdx: 0, endIdx: 48 };
  assert.equal(ganttIndexWindowNeedsRefresh(win, 0, 400, 44, 200, 3), false);
  assert.equal(ganttIndexWindowNeedsRefresh(win, 44 * 40, 400, 44, 200, 3), true);
  assert.equal(ganttIndexWindowNeedsRefresh(win, 0, 400, 44, 30, 3), true);
});

test("clipRange and rangesOverlap", () => {
  assert.equal(rangesOverlap(0, 10, 9, 20), true);
  assert.equal(rangesOverlap(0, 10, 10, 20), false);
  assert.deepEqual(clipRange(100, 400, 200, 150), { left: 0, width: 150 });
  assert.deepEqual(clipRange(0, 50, 200, 150), null);
  assert.deepEqual(clipRange(210, 20, 200, 150), { left: 10, width: 20 });
});

test("nextGanttVirtState recenters only when the sliding window is exhausted", () => {
  const measured = {
    scrollLeft: 100,
    viewportW: 800,
    firstVisibleY: 0,
    viewportH: 400,
    canvasWidth: 10_000,
    rowCount: 80,
    rowHeight: 44
  };
  const first = nextGanttVirtState(EMPTY_GANTT_VIRT, measured);
  assert.equal(first.x.left, 0);
  assert.ok(first.x.width >= 800 + ganttXOverscan(800));
  const same = nextGanttVirtState(first, { ...measured, scrollLeft: 300 });
  assert.equal(same, first);
  const moved = nextGanttVirtState(first, { ...measured, scrollLeft: first.x.width });
  assert.notEqual(moved, first);
  assert.ok(moved.x.left > 0);
});

test("ganttXOverscan follows viewport", () => {
  assert.equal(ganttXOverscan(400), 640);
  assert.equal(ganttXOverscan(1200), 1200);
  assert.ok(ganttXHysteresis(640) >= 48);
});

test("measureGanttVisibleY accounts for sticky header and footer", () => {
  const main = { getBoundingClientRect: () => ({ top: 100, bottom: 700 }) };
  const body = { getBoundingClientRect: () => ({ top: 40 }) };
  const m = measureGanttVisibleY({ main, body, headerH: 44, footerH: 90 });
  assert.equal(m.firstVisibleY, 104);
  assert.equal(m.viewportH, 466);
});
