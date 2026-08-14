export type PrimaryFieldType =
  | "string"
  | "number"
  | "integer"
  | "date"
  | "datetime"
  | "boolean"
  | "percent"
  | "currency";

export type PrimaryFieldAvailability = "available" | "computed" | "planned";
export type PrimaryFieldFillMode = "MANUAL" | "COMPUTED" | "UNSPECIFIED";

export type PrimaryTableColumnDef = {
  key: string;
  excelColumn: string;
  group: string | null;
  subgroup: string | null;
  label: string;
  path: string;
  owner: "ОПП" | "ГАПД" | null;
  fillMode: PrimaryFieldFillMode;
  applicability: string | null;
  type: PrimaryFieldType;
  availability: PrimaryFieldAvailability;
  source: string | null;
  formula: string | null;
  sortOrder: number;
};

export type PrimaryFilterOperator =
  | "contains"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "empty"
  | "notEmpty";

export type PrimaryFilterCondition = {
  field: string;
  op: PrimaryFilterOperator;
  value?: string;
};

export type PrimarySort = { field: string; dir: "asc" | "desc" };

export type PrimaryQueryInput = {
  from: Date;
  to: Date;
  fields: string[];
  conditions: PrimaryFilterCondition[];
  sort: PrimarySort[];
  cursor?: string;
  limit: number;
  /** Если задан — выборка только этих событий (sandbox + не DELETED). */
  eventIds?: string[];
  /** Если true — даты остаются ISO (для Excel Date-ячеек). По умолчанию — пользовательский формат. */
  rawDates?: boolean;
};

export type PrimaryQueryResult = {
  columns: PrimaryTableColumnDef[];
  rows: Array<Record<string, unknown>>;
  nextCursor: string | null;
  totalEstimate: number;
};
