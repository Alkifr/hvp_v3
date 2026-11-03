import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPut } from "../../lib/api";
import { laborSeriesEditable, type LaborSeriesKey } from "../../lib/laborEditability";

type LaborDepartment = "ME" | "AV" | "INT" | "NDT" | "SHOP" | "CAB_REP" | "PAINT";
type LaborEditableBlock =
  | "LABOR_BUDGET"
  | "ADD_BUDGET"
  | "NRC_BUDGET"
  | "WP_PLAN_MPS"
  | "WP_ACTUAL"
  | "ADD_PLAN"
  | "NRC_PLAN"
  | "ADD_ACTUAL"
  | "NRC_ACTUAL";

type LaborSeries = {
  key: LaborSeriesKey;
  label: string;
  hoursBlock: LaborEditableBlock;
  addBlock: LaborEditableBlock;
  nrcBlock: LaborEditableBlock;
  departments: Array<{
    department: LaborDepartment;
    label: string;
    skillId: string | null;
    skillCode: string;
    manHours: number | null;
    addHours: number | null;
    nrcHours: number | null;
  }>;
};

type LaborMetricsResponse = {
  ok: true;
  eventId: string;
  tatDays: { budget: number | null; mps: number | null; actual: number | null };
  series: LaborSeries[];
  departments: Array<{ department: LaborDepartment; label: string; skillId: string | null }>;
};

type DraftMap = Record<string, string>;

const SERIES_ORDER: LaborSeriesKey[] = ["budget", "mps", "actual"];

export type LaborMetricsHandle = {
  isDirty: () => boolean;
  save: () => Promise<void>;
};

function colClass(key: LaborSeriesKey, start = false) {
  return `laborMetricsCol laborMetricsCol--${key}${start ? " laborMetricsColStart" : ""}`;
}

function cellKey(block: LaborEditableBlock, department: LaborDepartment) {
  return `${block}:${department}`;
}

function parseHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function formatHours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value);
}

function formatMetric(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function sumParsed(values: Array<string | undefined>): number | null {
  let sum: number | null = null;
  for (const raw of values) {
    const parsed = parseHours(raw ?? "");
    if (parsed == null) continue;
    sum = (sum ?? 0) + parsed;
  }
  return sum;
}

function combine(parts: Array<number | null>): number | null {
  let sum: number | null = null;
  for (const part of parts) {
    if (part == null) continue;
    sum = (sum ?? 0) + part;
  }
  return sum;
}

function perTat(total: number | null, tatDays: number | null): number | null {
  if (total == null || tatDays == null || tatDays === 0) return null;
  return total / tatDays;
}

function baselineFrom(data: LaborMetricsResponse | undefined): DraftMap {
  const next: DraftMap = {};
  if (!data) return next;
  for (const series of data.series) {
    for (const row of series.departments) {
      next[cellKey(series.hoursBlock, row.department)] = formatHours(row.manHours);
      next[cellKey(series.addBlock, row.department)] = formatHours(row.addHours);
      next[cellKey(series.nrcBlock, row.department)] = formatHours(row.nrcHours);
    }
  }
  return next;
}

export const EventResourcesPanel = forwardRef<
  LaborMetricsHandle,
  {
    eventId: string;
    status: string;
    statusSortOrder?: number | null;
    inProgressSortOrder?: number | null;
    readOnly?: boolean;
    onDirtyChange?: (dirty: boolean) => void;
  }
>(function EventResourcesPanel(props, ref) {
  const qc = useQueryClient();
  const laborQ = useQuery({
    queryKey: ["resources", "labor-metrics", props.eventId],
    queryFn: () => apiGet<LaborMetricsResponse>(`/api/resources/events/${props.eventId}/labor-metrics`)
  });

  const [draft, setDraft] = useState<DraftMap>({});

  useEffect(() => {
    setDraft(baselineFrom(laborQ.data));
  }, [laborQ.data]);

  const seriesEditable = (series: LaborSeriesKey) =>
    !props.readOnly &&
    laborSeriesEditable({
      status: props.status,
      series,
      statusSortOrder: props.statusSortOrder,
      inProgressSortOrder: props.inProgressSortOrder
    });

  const baseline = useMemo(() => baselineFrom(laborQ.data), [laborQ.data]);

  const dirty = useMemo(() => {
    if (!laborQ.data) return false;
    for (const series of laborQ.data.series) {
      if (!seriesEditable(series.key)) continue;
      for (const row of series.departments) {
        for (const block of [series.hoursBlock, series.addBlock, series.nrcBlock]) {
          const key = cellKey(block, row.department);
          if ((draft[key] ?? "") !== (baseline[key] ?? "")) return true;
        }
      }
    }
    return false;
  }, [baseline, draft, laborQ.data, props.readOnly, props.status, props.statusSortOrder, props.inProgressSortOrder]);

  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);

  useEffect(() => () => props.onDirtyChange?.(false), [props.onDirtyChange]);

  const save = async () => {
    if (!laborQ.data || !dirty) return;
    const values: Array<{ block: LaborEditableBlock; department: LaborDepartment; manHours: number | null }> = [];
    for (const series of laborQ.data.series) {
      if (!seriesEditable(series.key)) continue;
      for (const row of series.departments) {
        const cells: Array<{ block: LaborEditableBlock; label: string }> = [
          { block: series.hoursBlock, label: `${series.label} / routine / ${row.label}` },
          { block: series.addBlock, label: `${series.label} / ADD / ${row.label}` },
          { block: series.nrcBlock, label: `${series.label} / NRC / ${row.label}` }
        ];
        for (const cell of cells) {
          const raw = draft[cellKey(cell.block, row.department)] ?? "";
          const parsed = parseHours(raw);
          if (raw.trim() && parsed == null) {
            throw new Error(`Некорректное значение: ${cell.label}`);
          }
          values.push({ block: cell.block, department: row.department, manHours: parsed });
        }
      }
    }
    if (values.length === 0) return;
    await apiPut<{ ok: true }>(`/api/resources/events/${props.eventId}/labor-metrics`, { values });
    await qc.invalidateQueries({ queryKey: ["resources", "labor-metrics", props.eventId] });
  };

  useImperativeHandle(ref, () => ({ isDirty: () => dirty, save }), [dirty, save]);

  const patchCell = (block: LaborEditableBlock, department: LaborDepartment, value: string) => {
    setDraft((prev) => ({ ...prev, [cellKey(block, department)]: value }));
  };

  const seriesByKey = useMemo(() => {
    const map = new Map<LaborSeriesKey, LaborSeries>();
    for (const series of laborQ.data?.series ?? []) map.set(series.key, series);
    return map;
  }, [laborQ.data]);

  const departments = laborQ.data?.departments ?? [];
  const tatDays = laborQ.data?.tatDays;
  const planOpen = seriesEditable("budget") || seriesEditable("mps");

  const totals = useMemo(() => {
    const out: Record<
      LaborSeriesKey,
      { routine: number | null; add: number | null; nrc: number | null; total: number | null; perTat: number | null }
    > = {
      budget: { routine: null, add: null, nrc: null, total: null, perTat: null },
      mps: { routine: null, add: null, nrc: null, total: null, perTat: null },
      actual: { routine: null, add: null, nrc: null, total: null, perTat: null }
    };
    for (const series of laborQ.data?.series ?? []) {
      const source = seriesEditable(series.key) ? draft : baseline;
      const routine = sumParsed(series.departments.map((row) => source[cellKey(series.hoursBlock, row.department)]));
      const add = sumParsed(series.departments.map((row) => source[cellKey(series.addBlock, row.department)]));
      const nrc = sumParsed(series.departments.map((row) => source[cellKey(series.nrcBlock, row.department)]));
      const total = combine([routine, add, nrc]);
      out[series.key] = {
        routine,
        add,
        nrc,
        total,
        perTat: perTat(total, tatDays?.[series.key] ?? null)
      };
    }
    return out;
  }, [baseline, draft, laborQ.data, props.readOnly, props.status, props.statusSortOrder, props.inProgressSortOrder, tatDays]);

  const renderInput = (series: LaborSeriesKey, block: LaborEditableBlock | undefined, department: LaborDepartment) => {
    if (!block) return <span className="laborMetricsDash">—</span>;
    const key = cellKey(block, department);
    const editable = seriesEditable(series);
    return (
      <input
        className="evInput laborMetricsInput"
        type="text"
        inputMode="decimal"
        placeholder="—"
        value={editable ? (draft[key] ?? "") : (baseline[key] ?? "")}
        disabled={!editable}
        onChange={(e) => patchCell(block, department, e.target.value)}
      />
    );
  };

  const hint = props.readOnly
    ? "Карточка открыта только для просмотра."
    : planOpen
      ? "Бюджет и MPS можно менять до статуса «В работе» включительно. Факт откроется после «Завершено»."
      : seriesEditable("actual")
        ? ""
        : "В этом статусе трудоёмкость не редактируется.";

  return (
    <div className="laborMetricsPanel">
      {hint ? <div className="muted laborMetricsHint">{hint}</div> : null}

      {laborQ.isLoading ? <div className="muted">Загрузка…</div> : null}
      {laborQ.error ? <div className="error">{String((laborQ.error as any)?.message ?? laborQ.error)}</div> : null}

      {laborQ.data ? (
        <div className="laborMetricsTableWrap">
          <table className="laborMetricsTable">
            <thead>
              <tr>
                <th rowSpan={2} className="laborMetricsCorner" />
                {SERIES_ORDER.map((key) => (
                  <th key={key} colSpan={3} className={colClass(key, key !== "budget")}>
                    {seriesByKey.get(key)?.label ?? key}
                  </th>
                ))}
              </tr>
              <tr>
                {SERIES_ORDER.map((key) => (
                  <Fragment key={`sub:${key}`}>
                    <th className={colClass(key, key !== "budget")}>routine</th>
                    <th className={colClass(key)}>ADD</th>
                    <th className={colClass(key)}>NRC</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => (
                <tr key={dept.department}>
                  <th scope="row">{dept.label}</th>
                  {SERIES_ORDER.map((key) => {
                    const series = seriesByKey.get(key);
                    return (
                      <Fragment key={`${dept.department}:${key}`}>
                        <td className={colClass(key, key !== "budget")}>
                          {renderInput(key, series?.hoursBlock, dept.department)}
                        </td>
                        <td className={colClass(key)}>{renderInput(key, series?.addBlock, dept.department)}</td>
                        <td className={colClass(key)}>{renderInput(key, series?.nrcBlock, dept.department)}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
              <tr className="laborMetricsFoot">
                <th scope="row">SUM</th>
                {SERIES_ORDER.map((key) => (
                  <Fragment key={`sum:${key}`}>
                    <td className={colClass(key, key !== "budget")}>{formatMetric(totals[key].routine)}</td>
                    <td className={colClass(key)}>{formatMetric(totals[key].add)}</td>
                    <td className={colClass(key)}>{formatMetric(totals[key].nrc)}</td>
                  </Fragment>
                ))}
              </tr>
              <tr className="laborMetricsFoot">
                <th scope="row">TOTAL</th>
                {SERIES_ORDER.map((key) => (
                  <td key={`total:${key}`} colSpan={3} className={colClass(key, key !== "budget")}>
                    {formatMetric(totals[key].total)}
                  </td>
                ))}
              </tr>
              <tr className="laborMetricsFoot">
                <th scope="row">TOTAL/TAT</th>
                {SERIES_ORDER.map((key) => (
                  <td key={`pertat:${key}`} colSpan={3} className={colClass(key, key !== "budget")}>
                    {formatMetric(totals[key].perTat)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
});
