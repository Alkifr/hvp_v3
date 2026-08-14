export const EVENT_COUNT_FIELD = "__count";

export type AggregateFn = "sum" | "avg" | "count" | "min" | "max";

export type ReportAggregateSpec = {
  field: string;
  fn: AggregateFn;
};

export type ReportFieldLike = {
  key: string;
  label: string;
  type: "string" | "number" | "datetime";
  group?: string | null;
  subgroup?: string | null;
};

export type ReportColumn = {
  key: string;
  label: string;
  type: "string" | "number" | "datetime";
  group?: string | null;
  subgroup?: string | null;
};

export function isSummaryConfig(config: {
  groupBy?: string[] | null;
  aggregates?: ReportAggregateSpec[] | null;
}): boolean {
  return Boolean(config.groupBy?.length || config.aggregates?.length);
}

export function aggregateColumnKey(spec: ReportAggregateSpec): string {
  if (spec.field === EVENT_COUNT_FIELD || spec.field === "*") return EVENT_COUNT_FIELD;
  return `${spec.field}__${spec.fn}`;
}

const FN_LABEL: Record<AggregateFn, string> = {
  sum: "Сумма",
  avg: "Среднее",
  count: "Кол-во",
  min: "Мин",
  max: "Макс"
};

export function aggregateColumnLabel(spec: ReportAggregateSpec, fieldDefs: ReportFieldLike[]): string {
  if (spec.field === EVENT_COUNT_FIELD || spec.field === "*") return "Количество событий";
  const name = fieldDefs.find((f) => f.key === spec.field)?.label ?? spec.field;
  return `${FN_LABEL[spec.fn]} · ${name}`;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function groupKey(row: Record<string, unknown>, groupBy: string[]): string {
  return groupBy.map((field) => JSON.stringify(row[field] ?? null)).join("\0");
}

export function computeAggregate(rows: Array<Record<string, unknown>>, spec: ReportAggregateSpec): number | null {
  if (spec.field === EVENT_COUNT_FIELD || spec.field === "*") return rows.length;
  if (spec.fn === "count") return rows.filter((row) => !isEmpty(row[spec.field])).length;
  const nums = rows.map((row) => toNumber(row[spec.field])).filter((value): value is number => value != null);
  if (!nums.length) return null;
  if (spec.fn === "sum") return nums.reduce((acc, value) => acc + value, 0);
  if (spec.fn === "avg") return nums.reduce((acc, value) => acc + value, 0) / nums.length;
  if (spec.fn === "min") return Math.min(...nums);
  return Math.max(...nums);
}

export function applyGroupAggregates(
  rows: Array<Record<string, unknown>>,
  groupBy: string[],
  aggregates: ReportAggregateSpec[],
  fieldDefs: ReportFieldLike[]
): { columns: ReportColumn[]; rows: Array<Record<string, unknown>>; total: number } {
  const allowed = new Set(fieldDefs.map((field) => field.key));
  const dims = groupBy.filter((field) => allowed.has(field));
  const specs =
    aggregates.length > 0
      ? aggregates.filter(
          (spec) =>
            spec.field === EVENT_COUNT_FIELD ||
            spec.field === "*" ||
            allowed.has(spec.field)
        )
      : [{ field: EVENT_COUNT_FIELD, fn: "count" as const }];

  const columns: ReportColumn[] = [
    ...dims.map((key) => {
      const def = fieldDefs.find((field) => field.key === key)!;
      return {
        key: def.key,
        label: def.label,
        type: def.type,
        group: def.group ?? null,
        subgroup: def.subgroup ?? null
      };
    }),
    ...specs.map((spec) => ({
      key: aggregateColumnKey(spec),
      label: aggregateColumnLabel(spec, fieldDefs),
      type: "number" as const,
      group: "Сводка",
      subgroup: null
    }))
  ];

  const buckets = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const key = groupKey(row, dims);
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const outRows: Array<Record<string, unknown>> = [];
  for (const groupRows of buckets.values()) {
    const out: Record<string, unknown> = {};
    const first = groupRows[0]!;
    for (const field of dims) out[field] = first[field] ?? null;
    for (const spec of specs) out[aggregateColumnKey(spec)] = computeAggregate(groupRows, spec);
    outRows.push(out);
  }

  return { columns, rows: outRows, total: outRows.length };
}

export function sortReportRows(
  rows: Array<Record<string, unknown>>,
  sort: Array<{ field: string; dir: "asc" | "desc" }>,
  allowedKeys: Set<string>
): Array<Record<string, unknown>> {
  if (!sort.length) return rows;
  return [...rows].sort((a, b) => {
    for (const item of sort) {
      if (!allowedKeys.has(item.field)) continue;
      const av = a[item.field];
      const bv = b[item.field];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "ru", { numeric: true });
      if (cmp) return item.dir === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}
