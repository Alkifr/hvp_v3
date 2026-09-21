import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPut } from "../../lib/api";

type LaborDepartment = "ME" | "AV" | "INT" | "NDT" | "SHOP" | "CAB_REP";
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
type LaborSeriesKey = "budget" | "mps" | "actual";

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

export function EventResourcesPanel(props: { eventId: string }) {
  const qc = useQueryClient();
  const laborQ = useQuery({
    queryKey: ["resources", "labor-metrics", props.eventId],
    queryFn: () => apiGet<LaborMetricsResponse>(`/api/resources/events/${props.eventId}/labor-metrics`)
  });

  const [draft, setDraft] = useState<DraftMap>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!laborQ.data) return;
    const next: DraftMap = {};
    for (const series of laborQ.data.series) {
      for (const row of series.departments) {
        next[cellKey(series.hoursBlock, row.department)] = formatHours(row.manHours);
        next[cellKey(series.addBlock, row.department)] = formatHours(row.addHours);
        next[cellKey(series.nrcBlock, row.department)] = formatHours(row.nrcHours);
      }
    }
    setDraft(next);
    setDirty(false);
  }, [laborQ.data]);

  const saveM = useMutation({
    mutationFn: async () => {
      if (!laborQ.data) return;
      const values: Array<{ block: LaborEditableBlock; department: LaborDepartment; manHours: number | null }> = [];
      for (const series of laborQ.data.series) {
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
      return apiPut<{ ok: true }>(`/api/resources/events/${props.eventId}/labor-metrics`, { values });
    },
    onSuccess: async () => {
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["resources", "labor-metrics", props.eventId] });
    }
  });

  const patchCell = (block: LaborEditableBlock, department: LaborDepartment, value: string) => {
    setDraft((prev) => ({ ...prev, [cellKey(block, department)]: value }));
    setDirty(true);
  };

  const seriesByKey = useMemo(() => {
    const map = new Map<LaborSeriesKey, LaborSeries>();
    for (const series of laborQ.data?.series ?? []) map.set(series.key, series);
    return map;
  }, [laborQ.data]);

  const departments = laborQ.data?.departments ?? [];
  const tatDays = laborQ.data?.tatDays;

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
      const routine = sumParsed(series.departments.map((row) => draft[cellKey(series.hoursBlock, row.department)]));
      const add = sumParsed(series.departments.map((row) => draft[cellKey(series.addBlock, row.department)]));
      const nrc = sumParsed(series.departments.map((row) => draft[cellKey(series.nrcBlock, row.department)]));
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
  }, [draft, laborQ.data, tatDays]);

  const renderInput = (block: LaborEditableBlock | undefined, department: LaborDepartment) => {
    if (!block) return <span className="laborMetricsDash">—</span>;
    const key = cellKey(block, department);
    return (
      <input
        className="evInput laborMetricsInput"
        type="text"
        inputMode="decimal"
        placeholder="—"
        value={draft[key] ?? ""}
        onChange={(e) => patchCell(block, department, e.target.value)}
      />
    );
  };

  return (
    <div className="laborMetricsPanel">
      <strong>Трудоёмкость</strong>

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
                          {renderInput(series?.hoursBlock, dept.department)}
                        </td>
                        <td className={colClass(key)}>{renderInput(series?.addBlock, dept.department)}</td>
                        <td className={colClass(key)}>{renderInput(series?.nrcBlock, dept.department)}</td>
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

      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        {saveM.error ? <span className="error">{String((saveM.error as any)?.message ?? saveM.error)}</span> : null}
        <button
          type="button"
          className="btn btnPrimary"
          disabled={!dirty || saveM.isPending || !laborQ.data}
          onClick={() => saveM.mutate()}
        >
          {saveM.isPending ? "Сохранение…" : "Сохранить трудоёмкость"}
        </button>
      </div>
    </div>
  );
}
