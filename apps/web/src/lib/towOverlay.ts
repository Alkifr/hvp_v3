const EDGE_SLACK_MS = 60_000;

export type TowOverlay = { left: number; width: number; anchor: "start" | "end" | "middle" };

/** Время, которое попадает в нарисованную полосу. Если событие обрезано краем периода, это не весь интервал события. */
export function clippedBarTime(params: {
  barStartMs: number;
  barEndMs: number;
  barLeftPx: number;
  barRightPx: number;
  canvasWidth: number;
}): { startMs: number; endMs: number } {
  const spanPx = params.barRightPx - params.barLeftPx;
  const full = { startMs: params.barStartMs, endMs: params.barEndMs };
  if (!(spanPx > 0) || !(params.barEndMs > params.barStartMs) || !(params.canvasWidth > 0)) return full;
  const visLeft = Math.max(params.barLeftPx, 0);
  const visRight = Math.min(params.barRightPx, params.canvasWidth);
  if (!(visRight > visLeft)) return full;
  const tAt = (px: number) => params.barStartMs + ((px - params.barLeftPx) / spanPx) * (params.barEndMs - params.barStartMs);
  return { startMs: tAt(visLeft), endMs: tAt(visRight) };
}

export function towOverlayRect(params: {
  barStartMs: number;
  barEndMs: number;
  barW: number;
  towStartMs: number;
  towEndMs: number;
  minPx: number;
  /** Интервал, который занимает нарисованная полоса. По умолчанию — всё событие. */
  visibleStartMs?: number;
  visibleEndMs?: number;
}): TowOverlay | null {
  const { barStartMs, barEndMs, barW, towStartMs, towEndMs } = params;
  const originStart = params.visibleStartMs ?? barStartMs;
  const originEnd = params.visibleEndMs ?? barEndMs;
  if (!(barW > 0) || !(originEnd > originStart) || !(towEndMs > towStartMs)) return null;
  const overlapStart = Math.max(towStartMs, originStart);
  const overlapEnd = Math.min(towEndMs, originEnd);
  if (!(overlapEnd > overlapStart)) return null;

  const span = originEnd - originStart;
  const rawLeft = ((overlapStart - originStart) / span) * barW;
  const rawWidth = ((overlapEnd - overlapStart) / span) * barW;
  const minPx = Math.min(Math.max(params.minPx, 1), barW);
  const width = Math.min(barW, Math.max(rawWidth, minPx));
  const realStartOnScreen = Math.abs(originStart - barStartMs) <= EDGE_SLACK_MS;
  const realEndOnScreen = Math.abs(originEnd - barEndMs) <= EDGE_SLACK_MS;
  const endsAtBar = realEndOnScreen && originEnd - overlapEnd <= EDGE_SLACK_MS && barEndMs - towEndMs <= EDGE_SLACK_MS;
  const startsAtBar = realStartOnScreen && overlapStart - originStart <= EDGE_SLACK_MS && towStartMs - barStartMs <= EDGE_SLACK_MS;
  const anchor: TowOverlay["anchor"] = endsAtBar && !startsAtBar ? "end" : startsAtBar ? "start" : "middle";
  let left = anchor === "end" ? barW - width : rawLeft;
  if (left + width > barW) left = barW - width;
  if (left < 0) left = 0;
  const fitted = Math.min(width, barW - left);
  if (!(fitted > 0)) return null;
  return { left, width: fitted, anchor };
}
