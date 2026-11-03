const EDGE_SLACK_MS = 60_000;

export type TowOverlay = { left: number; width: number; anchor: "start" | "end" | "middle" };

export function towOverlayRect(params: {
  barStartMs: number;
  barEndMs: number;
  barW: number;
  towStartMs: number;
  towEndMs: number;
  minPx: number;
}): TowOverlay | null {
  const { barStartMs, barEndMs, barW, towStartMs, towEndMs } = params;
  if (!(barW > 0) || !(barEndMs > barStartMs) || !(towEndMs > towStartMs)) return null;
  const overlapStart = Math.max(towStartMs, barStartMs);
  const overlapEnd = Math.min(towEndMs, barEndMs);
  if (!(overlapEnd > overlapStart)) return null;

  const span = barEndMs - barStartMs;
  const rawLeft = ((overlapStart - barStartMs) / span) * barW;
  const rawWidth = ((overlapEnd - overlapStart) / span) * barW;
  const minPx = Math.min(Math.max(params.minPx, 1), barW);
  const width = Math.min(barW, Math.max(rawWidth, minPx));
  const endsAtBar = barEndMs - overlapEnd <= EDGE_SLACK_MS;
  const startsAtBar = overlapStart - barStartMs <= EDGE_SLACK_MS;
  const anchor: TowOverlay["anchor"] = endsAtBar && !startsAtBar ? "end" : startsAtBar ? "start" : "middle";
  let left = anchor === "end" ? barW - width : rawLeft;
  if (left + width > barW) left = barW - width;
  if (left < 0) left = 0;
  const fitted = Math.min(width, barW - left);
  if (!(fitted > 0)) return null;
  return { left, width: fitted, anchor };
}
