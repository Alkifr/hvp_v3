export type GanttPxWindow = { left: number; width: number };
export type GanttIndexWindow = { startIdx: number; endIdx: number };

export type GanttVirtState = {
  x: GanttPxWindow;
  rows: GanttIndexWindow;
};

export const GANTT_X_OVERSCAN_MIN = 640;
export const GANTT_ROW_OVERSCAN = 10;
export const GANTT_ROW_KEEP = 3;
export const GANTT_BAR_SLOP_PX = 56;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a1 > b0 && a0 < b1;
}

export function clipRange(
  left: number,
  width: number,
  paneLeft: number,
  paneWidth: number
): { left: number; width: number } | null {
  const c0 = Math.max(left, paneLeft);
  const c1 = Math.min(left + width, paneLeft + paneWidth);
  if (!(c1 > c0)) return null;
  return { left: c0 - paneLeft, width: c1 - c0 };
}

export function ganttPxWindow(scroll: number, viewport: number, total: number, overscan: number): GanttPxWindow {
  const totalN = Math.max(0, total);
  const view = Math.max(0, viewport);
  const left = clamp(Math.floor(scroll) - overscan, 0, totalN);
  const right = clamp(Math.ceil(scroll + view) + overscan, 0, totalN);
  return { left, width: Math.max(0, right - left) };
}

export function ganttPxWindowNeedsRefresh(
  current: GanttPxWindow,
  scroll: number,
  viewport: number,
  total: number,
  hysteresis: number
): boolean {
  if (total <= 0) return current.left !== 0 || current.width !== 0;
  if (current.left < 0 || current.width < 0) return true;
  if (current.left + current.width > total + 0.5) return true;
  const startOk = current.left <= Math.max(0, scroll - hysteresis);
  const endOk = current.left + current.width >= Math.min(total, scroll + viewport + hysteresis);
  return !(startOk && endOk);
}

export function ganttIndexWindow(
  scroll: number,
  viewport: number,
  itemSize: number,
  count: number,
  overscan: number
): GanttIndexWindow {
  if (count <= 0 || itemSize <= 0) return { startIdx: 0, endIdx: 0 };
  const first = Math.floor(Math.max(0, scroll) / itemSize);
  const last = Math.ceil(Math.max(0, scroll + viewport) / itemSize);
  return {
    startIdx: clamp(first - overscan, 0, count),
    endIdx: clamp(last + overscan, 0, count)
  };
}

export function buildGanttRowOffsets(heights: number[]): number[] {
  const offsets = new Array(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i]! + Math.max(0, heights[i]!);
  return offsets;
}

export function ganttRowIndexAtY(offsets: number[], y: number): number {
  const count = Math.max(0, offsets.length - 1);
  if (count <= 0) return 0;
  const total = offsets[count] ?? 0;
  if (total <= 0) return 0;
  const yy = Math.max(0, Math.min(y, total - 0.0001));
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] ?? 0) <= yy) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function ganttIndexWindowFromOffsets(
  scroll: number,
  viewport: number,
  offsets: number[],
  overscan: number
): GanttIndexWindow {
  const count = Math.max(0, offsets.length - 1);
  if (count <= 0) return { startIdx: 0, endIdx: 0 };
  const start = ganttRowIndexAtY(offsets, scroll);
  const end = ganttRowIndexAtY(offsets, scroll + Math.max(0, viewport)) + 1;
  return {
    startIdx: clamp(start - overscan, 0, count),
    endIdx: clamp(end + overscan, 0, count)
  };
}

export function ganttIndexWindowNeedsRefresh(
  current: GanttIndexWindow,
  scroll: number,
  viewport: number,
  itemSize: number,
  count: number,
  keepOverscan: number
): boolean {
  if (count <= 0) return current.startIdx !== 0 || current.endIdx !== 0;
  if (itemSize <= 0) return true;
  if (current.startIdx < 0 || current.endIdx < current.startIdx || current.endIdx > count) return true;
  const vis = ganttIndexWindow(scroll, viewport, itemSize, count, 0);
  const startOk = current.startIdx <= Math.max(0, vis.startIdx - keepOverscan);
  const endOk = current.endIdx >= Math.min(count, vis.endIdx + keepOverscan);
  return !(startOk && endOk);
}

export function ganttIndexWindowFromOffsetsNeedsRefresh(
  current: GanttIndexWindow,
  scroll: number,
  viewport: number,
  offsets: number[],
  keepOverscan: number
): boolean {
  const count = Math.max(0, offsets.length - 1);
  if (count <= 0) return current.startIdx !== 0 || current.endIdx !== 0;
  if (current.startIdx < 0 || current.endIdx < current.startIdx || current.endIdx > count) return true;
  const vis = ganttIndexWindowFromOffsets(scroll, viewport, offsets, 0);
  const startOk = current.startIdx <= Math.max(0, vis.startIdx - keepOverscan);
  const endOk = current.endIdx >= Math.min(count, vis.endIdx + keepOverscan);
  return !(startOk && endOk);
}

export function ganttXOverscan(viewportW: number): number {
  return Math.max(GANTT_X_OVERSCAN_MIN, Math.round(Math.max(0, viewportW)));
}

export function ganttXHysteresis(overscan: number): number {
  return Math.max(48, Math.round(overscan * 0.35));
}

export const EMPTY_GANTT_VIRT: GanttVirtState = {
  x: { left: 0, width: 4000 },
  rows: { startIdx: 0, endIdx: 48 }
};

export function nextGanttVirtState(
  current: GanttVirtState,
  m: {
    scrollLeft: number;
    viewportW: number;
    firstVisibleY: number;
    viewportH: number;
    canvasWidth: number;
    rowCount: number;
    rowHeight: number;
    rowOffsets?: number[];
  }
): GanttVirtState {
  const xOverscan = ganttXOverscan(m.viewportW);
  const xHyst = ganttXHysteresis(xOverscan);
  const x = ganttPxWindowNeedsRefresh(current.x, m.scrollLeft, m.viewportW, m.canvasWidth, xHyst)
    ? ganttPxWindow(m.scrollLeft, m.viewportW, m.canvasWidth, xOverscan)
    : current.x;
  const offsets = m.rowOffsets && m.rowOffsets.length === m.rowCount + 1 ? m.rowOffsets : null;
  const rows = offsets
    ? ganttIndexWindowFromOffsetsNeedsRefresh(current.rows, m.firstVisibleY, m.viewportH, offsets, GANTT_ROW_KEEP)
      ? ganttIndexWindowFromOffsets(m.firstVisibleY, m.viewportH, offsets, GANTT_ROW_OVERSCAN)
      : current.rows
    : ganttIndexWindowNeedsRefresh(
        current.rows,
        m.firstVisibleY,
        m.viewportH,
        m.rowHeight,
        m.rowCount,
        GANTT_ROW_KEEP
      )
      ? ganttIndexWindow(m.firstVisibleY, m.viewportH, m.rowHeight, m.rowCount, GANTT_ROW_OVERSCAN)
      : current.rows;
  if (
    x.left === current.x.left &&
    x.width === current.x.width &&
    rows.startIdx === current.rows.startIdx &&
    rows.endIdx === current.rows.endIdx
  ) {
    return current;
  }
  return { x, rows };
}

export function measureGanttVisibleY(params: {
  main: Pick<HTMLElement, "getBoundingClientRect"> | null;
  body: Pick<HTMLElement, "getBoundingClientRect"> | null;
  headerH: number;
  footerH: number;
}): { firstVisibleY: number; viewportH: number } {
  const viewportH = 800;
  if (!params.main || !params.body) return { firstVisibleY: 0, viewportH };
  const mainRect = params.main.getBoundingClientRect();
  const bodyRect = params.body.getBoundingClientRect();
  const clipTop = mainRect.top + Math.max(0, params.headerH);
  const clipBottom = mainRect.bottom - Math.max(0, params.footerH);
  return {
    firstVisibleY: Math.max(0, clipTop - bodyRect.top),
    viewportH: Math.max(0, clipBottom - clipTop)
  };
}
