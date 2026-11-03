export type LaborSeriesKey = "budget" | "mps" | "actual";

const DEFAULT_SORT: Record<string, number> = {
  PENDING_EXECUTOR_APPROVAL: 10,
  PENDING_CUSTOMER_APPROVAL: 20,
  APPROVED_BY_EXECUTOR: 30,
  APPROVED_BY_CUSTOMER: 40,
  IN_PROGRESS: 50,
  DONE: 60,
  CANCELLED: 70,
  DELETED: 80
};

const BLOCK_SERIES: Record<string, LaborSeriesKey> = {
  LABOR_BUDGET: "budget",
  ADD_BUDGET: "budget",
  NRC_BUDGET: "budget",
  WP_PLAN_MPS: "mps",
  ADD_PLAN: "mps",
  NRC_PLAN: "mps",
  WP_ACTUAL: "actual",
  ADD_ACTUAL: "actual",
  NRC_ACTUAL: "actual"
};

export function laborSeriesForBlock(block: string): LaborSeriesKey | null {
  return BLOCK_SERIES[block] ?? null;
}

/**
 * Бюджет и MPS — пока статус не позже «В работе».
 * Факт — только в «Завершено». Отмена и удаление закрывают все блоки.
 */
export function laborSeriesEditable(params: {
  status: string | null | undefined;
  series: LaborSeriesKey;
  statusSortOrder?: number | null;
  inProgressSortOrder?: number | null;
}): boolean {
  const status = params.status ?? "";
  if (!status || status === "CANCELLED" || status === "DELETED") return false;
  if (params.series === "actual") return status === "DONE";
  const sort = params.statusSortOrder ?? DEFAULT_SORT[status];
  const ceiling = params.inProgressSortOrder ?? DEFAULT_SORT.IN_PROGRESS;
  if (sort == null || ceiling == null) return false;
  return sort <= ceiling;
}

export function laborBlockEditable(params: {
  status: string | null | undefined;
  block: string;
  statusSortOrder?: number | null;
  inProgressSortOrder?: number | null;
}): boolean {
  const series = laborSeriesForBlock(params.block);
  if (!series) return false;
  return laborSeriesEditable({ ...params, series });
}
