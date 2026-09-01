import type { PrimaryTableColumnDef } from "./types.js";

export type HeaderColumn = Pick<PrimaryTableColumnDef, "key" | "label" | "group" | "subgroup">;

export type HeaderPlanCell = {
  key: string;
  label: string;
  colSpan: number;
  rowSpan: number;
};

export type PrimaryHeaderPlan = {
  /** 1 группа / 2 подгруппа|label / 3 label / 4 номер колонки (если включена) */
  depth: 4;
  groupRow: HeaderPlanCell[];
  midRow: HeaderPlanCell[];
  labelRow: HeaderPlanCell[];
  indexRow: HeaderPlanCell[];
};

/** Диапазоны подряд идущих одинаковых значений для mergeCells / colspan. */
export function contiguousRanges(values: Array<string | null | undefined>): Array<{ start: number; end: number; value: string }> {
  const ranges: Array<{ start: number; end: number; value: string }> = [];
  let i = 0;
  while (i < values.length) {
    const value = (values[i] ?? "").trim();
    let end = i;
    while (end + 1 < values.length && (values[end + 1] ?? "").trim() === value) end += 1;
    if (value) ranges.push({ start: i, end, value });
    i = end + 1;
  }
  return ranges;
}

/**
 * План 4-строчной шапки:
 * 1) группа (горизонтальный merge),
 * 2) подгруппа (EQ–FO) или label,
 * 3) label; без подгруппы mid+label дают rowspan=2,
 * 4) порядковый номер колонки 1..N (для автофильтров).
 */
export function buildPrimaryHeaderPlan(columns: HeaderColumn[]): PrimaryHeaderPlan {
  const groupRow: HeaderPlanCell[] = [];
  let i = 0;
  while (i < columns.length) {
    const group = (columns[i]?.group ?? "").trim();
    let end = i;
    while (end + 1 < columns.length && (columns[end + 1]?.group ?? "").trim() === group) end += 1;
    groupRow.push({
      key: `group:${i}:${columns[i]?.key ?? i}`,
      label: group,
      colSpan: end - i + 1,
      rowSpan: 1
    });
    i = end + 1;
  }

  const midRow: HeaderPlanCell[] = [];
  const labelRow: HeaderPlanCell[] = [];
  i = 0;
  while (i < columns.length) {
    const column = columns[i]!;
    const subgroup = column.subgroup?.trim() ?? "";
    if (!subgroup) {
      midRow.push({
        key: `mid:${column.key}`,
        label: column.label,
        colSpan: 1,
        rowSpan: 2
      });
      i += 1;
      continue;
    }
    let end = i;
    while (end + 1 < columns.length) {
      const next = columns[end + 1]!;
      if ((next.subgroup?.trim() ?? "") !== subgroup) break;
      if ((next.group ?? "").trim() !== (column.group ?? "").trim()) break;
      end += 1;
    }
    midRow.push({
      key: `sub:${i}:${column.key}`,
      label: subgroup,
      colSpan: end - i + 1,
      rowSpan: 1
    });
    for (let j = i; j <= end; j += 1) {
      const leaf = columns[j]!;
      labelRow.push({
        key: `label:${leaf.key}`,
        label: leaf.label,
        colSpan: 1,
        rowSpan: 1
      });
    }
    i = end + 1;
  }

  const indexRow: HeaderPlanCell[] = columns.map((column, index) => ({
    key: `index:${column.key}`,
    label: String(index + 1),
    colSpan: 1,
    rowSpan: 1
  }));

  return { depth: 4, groupRow, midRow, labelRow, indexRow };
}

export const REPORT_FREEZE_ROWS_MAX = 20;
export const DEFAULT_PRIMARY_FREEZE_ROWS = 2;

export type PrimaryHeaderWriteOptions = {
  includeIndexRow?: boolean;
};

/** Шапка первичной таблицы: 3 строки или 4, если включена нумерация колонок. */
export function primaryExportHeaderDepth(
  _columns?: HeaderColumn[],
  opts?: PrimaryHeaderWriteOptions
): 3 | 4 {
  return opts?.includeIndexRow === false ? 3 : 4;
}

export function clampFreezeRows(value: unknown, fallback = DEFAULT_PRIMARY_FREEZE_ROWS): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(REPORT_FREEZE_ROWS_MAX, Math.max(0, Math.round(n)));
}

/** Закрепляет первые N строк листа Excel (freeze panes). */
export function applyFrozenRows(
  worksheet: { views?: Array<Record<string, unknown>> },
  freezeRows: number
) {
  const n = clampFreezeRows(freezeRows, 0);
  if (n <= 0) {
    worksheet.views = [];
    return;
  }
  worksheet.views = [
    {
      state: "frozen",
      xSplit: 0,
      ySplit: n,
      topLeftCell: `A${n + 1}`,
      activeCell: `A${n + 1}`
    }
  ];
}

/**
 * Пишет шапку: группа / подгруппа|label / label / опционально номер колонки.
 * Важно для ExcelJS stream writer: merge до commit строк.
 * Возвращает номер следующей строки данных (1-based).
 */
export function writePrimaryTableHeaderRows(
  worksheet: {
    addRow: (values: unknown[]) => {
      number?: number;
      commit: () => void;
      getCell: (n: number) => any;
    };
    mergeCells: (a: number, b: number, c: number, d: number) => void;
  },
  columns: HeaderColumn[],
  opts?: PrimaryHeaderWriteOptions
): number {
  const styleHeader = (
    row: { getCell: (n: number) => any },
    bold: boolean,
    opts?: { size?: number; numFmt?: string }
  ) => {
    const size = opts?.size ?? (bold ? 11 : 10);
    for (let i = 1; i <= columns.length; i += 1) {
      const cell = row.getCell(i);
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.font = { bold, size };
      // Сбрасываем колоночный numFmt (даты), иначе числа индексов становятся датами.
      cell.numFmt = opts?.numFmt ?? "@";
    }
  };

  const groupValues = columns.map((column) => column.group ?? "");
  const groupRow = worksheet.addRow(groupValues);
  const groupRowNumber = groupRow.number ?? 1;
  styleHeader(groupRow, true);

  const midValues = columns.map((column) => {
    const subgroup = column.subgroup?.trim();
    return subgroup || column.label;
  });
  const midRow = worksheet.addRow(midValues);
  const midRowNumber = midRow.number ?? groupRowNumber + 1;
  styleHeader(midRow, true);

  const labelValues = columns.map((column) => column.label);
  const labelRow = worksheet.addRow(labelValues);
  const labelRowNumber = labelRow.number ?? midRowNumber + 1;
  styleHeader(labelRow, false);

  const includeIndexRow = opts?.includeIndexRow !== false;
  let indexRow: { number?: number; commit: () => void; getCell: (n: number) => any } | null = null;
  let indexRowNumber = labelRowNumber;
  if (includeIndexRow) {
    // Строка как текст «1»…«N», чтобы Excel не применял формат даты колонки.
    const indexValues = columns.map((_, index) => String(index + 1));
    indexRow = worksheet.addRow(indexValues);
    indexRowNumber = indexRow.number ?? labelRowNumber + 1;
    styleHeader(indexRow, true, { size: 10, numFmt: "@" });
  }

  // Все merge до commit — иначе stream WorkbookWriter падает с "row has been committed".
  for (const range of contiguousRanges(groupValues)) {
    if (range.end > range.start) {
      worksheet.mergeCells(groupRowNumber, range.start + 1, groupRowNumber, range.end + 1);
    }
  }

  for (const range of contiguousRanges(midValues)) {
    const col = columns[range.start];
    if (!col?.subgroup?.trim()) continue;
    if (range.end > range.start) {
      worksheet.mergeCells(midRowNumber, range.start + 1, midRowNumber, range.end + 1);
    }
  }

  for (let colIndex = 0; colIndex < columns.length; colIndex += 1) {
    if (columns[colIndex]?.subgroup?.trim()) continue;
    worksheet.mergeCells(midRowNumber, colIndex + 1, labelRowNumber, colIndex + 1);
  }

  groupRow.commit();
  midRow.commit();
  labelRow.commit();
  indexRow?.commit();

  return indexRowNumber + 1;
}
