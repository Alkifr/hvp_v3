export type PrimaryHeaderColumn = {
  key: string;
  label: string;
  group?: string | null;
  subgroup?: string | null;
};

export type PrimaryHeaderCell = {
  key: string;
  label: string;
  colSpan: number;
  rowSpan: number;
};

export type PrimaryHeaderPlan = {
  depth: 4;
  groupRow: PrimaryHeaderCell[];
  midRow: PrimaryHeaderCell[];
  labelRow: PrimaryHeaderCell[];
  indexRow: PrimaryHeaderCell[];
};

/** План 4-строчной шапки: группа / подгруппа / label / номер колонки. */
export function buildPrimaryHeaderPlan(columns: PrimaryHeaderColumn[]): PrimaryHeaderPlan {
  const groupRow: PrimaryHeaderCell[] = [];
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

  const midRow: PrimaryHeaderCell[] = [];
  const labelRow: PrimaryHeaderCell[] = [];
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

  const indexRow: PrimaryHeaderCell[] = columns.map((column, index) => ({
    key: `index:${column.key}`,
    label: String(index + 1),
    colSpan: 1,
    rowSpan: 1
  }));

  return { depth: 4, groupRow, midRow, labelRow, indexRow };
}

export const REPORT_FREEZE_ROWS_MAX = 20;
export const DEFAULT_PRIMARY_FREEZE_ROWS = 2;
export const REPORT_HEADER_ROW_PX = 34;

export function defaultReportFreezeRows(dataset: string): number {
  return dataset === "primary_events" ? DEFAULT_PRIMARY_FREEZE_ROWS : 1;
}

export function defaultShowColumnIndex(dataset: string): boolean {
  return dataset === "primary_events";
}

export function clampFreezeRows(value: unknown, fallback = DEFAULT_PRIMARY_FREEZE_ROWS): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(REPORT_FREEZE_ROWS_MAX, Math.max(0, Math.round(n)));
}

export function freezeHeaderRowStyle(
  rowIndex: number,
  freezeRows: number
): { className: string; style?: Record<string, string> } {
  if (rowIndex >= freezeRows) return { className: "" };
  return {
    className: "isFrozen",
    style: {
      "--report-freeze-top": `${rowIndex * REPORT_HEADER_ROW_PX}px`,
      "--report-freeze-z": String(20 - rowIndex)
    }
  };
}

/**
 * Ставит sticky-offset по фактической высоте строк шапки.
 * Иначе 4-я строка (номера колонок) получает слишком маленький `top` и
 * уезжает под более высокие строки групп/подписей.
 */
export function syncReportFrozenHeader(table: HTMLTableElement | null, freezeRows: number) {
  const thead = table?.tHead;
  if (!thead) return;
  const rows = Array.from(thead.rows);
  const freezeCount = Math.min(Math.max(0, freezeRows), rows.length);
  thead.classList.toggle("isFullyFrozen", freezeCount > 0 && freezeCount >= rows.length);
  let acc = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const tr = rows[i]!;
    const frozen = i < freezeCount;
    tr.classList.toggle("isFrozen", frozen);
    tr.classList.toggle("isFrozenLast", frozen && i === freezeCount - 1);
    const cells = Array.from(tr.cells);
    if (!frozen) {
      tr.style.removeProperty("--report-freeze-top");
      tr.style.removeProperty("--report-freeze-z");
      for (const cell of cells) {
        cell.style.removeProperty("top");
        cell.style.removeProperty("z-index");
      }
      continue;
    }
    const top = `${acc}px`;
    const z = String(40 - i);
    tr.style.setProperty("--report-freeze-top", top);
    tr.style.setProperty("--report-freeze-z", z);
    for (const cell of cells) {
      cell.style.top = top;
      cell.style.zIndex = z;
    }
    acc += tr.getBoundingClientRect().height;
  }
}

/** Нумерация колонок 1…N — как 4-я строка шапки report_all_in. */
export function columnIndexLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(i + 1));
}
