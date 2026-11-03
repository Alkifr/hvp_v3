import { laborSeriesForBlock, type LaborSeriesKey } from "./laborEditability.js";

export type LaborPresence = Record<LaborSeriesKey, boolean>;

/** Серия заполнена, если хотя бы в одном блоке routine/ADD/NRC есть часы, включая 0. */
export function laborPresenceFromMetrics(rows: Array<{ block: string; manHours?: unknown }>): LaborPresence {
  const presence: LaborPresence = { budget: false, mps: false, actual: false };
  for (const row of rows) {
    if (row.manHours == null) continue;
    const series = laborSeriesForBlock(row.block);
    if (series) presence[series] = true;
  }
  return presence;
}
