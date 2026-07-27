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
