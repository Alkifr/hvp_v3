import type { PrimaryTableColumnDef } from "./primaryTable/types.js";

/** Тестовый статус мэппинга колонки XLSX → HVP. */
export type ReportFieldMappingStatus = "mapped" | "unmapped" | "stub";

/**
 * Заглушка — только если в каталоге нет источника или колонка ещё planned.
 * EventReportMetric / Scalar / rolling / A-check читаются из БД (rowMapper),
 * поэтому больше не помечаются как stub: значения могут быть пустыми, пока их не ввели.
 */
export function primaryMappingStatus(column: PrimaryTableColumnDef): ReportFieldMappingStatus {
  if (!column.source || column.availability === "planned") return "unmapped";
  return "mapped";
}
