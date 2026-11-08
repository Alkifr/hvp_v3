import { useMemo, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions
} from "chart.js";
import { Chart } from "react-chartjs-2";

import { exportOccupancyExcel } from "../../lib/analyticsExcel";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const EVENT_COLORS = ["#2563eb", "#f97316", "#7c3aed", "#0f766e", "#b45309", "#db2777", "#0891b2", "#65a30d", "#64748b"];

function axisLabel(label: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (day) return `${day[3]}.${day[2]}`;
  return label;
}

export type OccupancyPart = {
  id: string;
  label: string;
  placeDays: number;
  lines: number;
  sharePct: number;
};

export type OccupancyResponse = {
  ok: true;
  period: { from: string; to: string };
  grain: "day" | "week" | "month" | "year";
  groupBy: "aircraftType" | "operator";
  summary: {
    periodDays: number;
    capacityPlaceDays: number;
    occupiedPlaceDays: number;
    slicePlaceDays: number;
    capacityLines: number;
    occupiedLines: number;
    sliceLines: number;
    shareOfCapacityPct: number;
    shareOfOccupiedPct: number;
    unplacedEventCount: number;
  };
  byEventType: OccupancyPart[];
  rows: Array<{
    id: string;
    label: string;
    placeDays: number;
    lines: number;
    shareOfCapacityPct: number;
    shareOfOccupiedPct: number;
    byEventType: OccupancyPart[];
  }>;
  buckets: Array<{
    key: string;
    label: string;
    from: string;
    to: string;
    dayCount: number;
    capacityPlaceDays: number;
    occupiedPlaceDays: number;
    slicePlaceDays: number;
    capacityLines: number;
    occupiedLines: number;
    sliceLines: number;
    shareOfCapacityPct: number;
    shareOfOccupiedPct: number;
    byEventType: OccupancyPart[];
    byAircraftType: OccupancyPart[];
  }>;
  truncated: boolean;
};

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function composition(parts: OccupancyPart[]): string {
  if (parts.length === 0) return "—";
  return parts.map((part) => `${part.label} ${fmtNum(part.placeDays)} / ${fmtNum(part.lines, 2)} лин.`).join(" · ");
}

export function OccupancyPanel(props: {
  q: UseQueryResult<OccupancyResponse>;
  periodLabel: string;
  detailLabel: string;
  groupBy: "aircraftType" | "operator";
  sliceLabel: string;
}) {
  const { q, periodLabel, detailLabel, groupBy, sliceLabel } = props;
  const [exporting, setExporting] = useState(false);
  const [lineStack, setLineStack] = useState<"aircraftType" | "eventType">("aircraftType");
  const data = q.data;
  const groupTitle = groupBy === "operator" ? "Оператор" : "Тип ВС";

  const chart = useMemo(
    () => buildLinesChart(data?.buckets ?? [], lineStack),
    [data, lineStack]
  );

  if (q.isLoading && !data) return <div className="muted">Загрузка…</div>;
  if (q.error && !data) return <div className="error">{String((q.error as { message?: string }).message ?? q.error)}</div>;
  if (!data) return null;

  const summary = data.summary;
  const onExport = async () => {
    setExporting(true);
    try {
      await exportOccupancyExcel({
        periodLabel,
        detailLabel,
        groupLabel: groupTitle,
        sliceLabel,
        kpis: [
          { label: "Место-сутки среза", value: summary.slicePlaceDays, hint: sliceLabel },
          { label: "Линии среза", value: summary.sliceLines, hint: `Место-сутки / ${fmtNum(summary.periodDays)} дн.` },
          { label: "Линии ёмкости", value: summary.capacityLines, hint: "Ёмкость активной схемы в линиях" },
          { label: "Линии занятости", value: summary.occupiedLines, hint: "Все занятые места в линиях" },
          { label: "Доля ёмкости, %", value: summary.shareOfCapacityPct, hint: "От ёмкости выбранных ангаров" },
          { label: "Доля занятости, %", value: summary.shareOfOccupiedPct, hint: "От всех занятых мест" },
          { label: "Ёмкость, место-сутки", value: summary.capacityPlaceDays },
          { label: "Занято всего, место-сутки", value: summary.occupiedPlaceDays },
          { label: "События без места", value: summary.unplacedEventCount }
        ],
        buckets: data.buckets.map((bucket) => ({
          Интервал: bucket.label,
          "Ёмкость, место-сутки": bucket.capacityPlaceDays,
          "Занято, место-сутки": bucket.occupiedPlaceDays,
          "Срез, место-сутки": bucket.slicePlaceDays,
          "Дней в интервале": bucket.dayCount,
          "Линии ёмкости": bucket.capacityLines,
          "Линии занято": bucket.occupiedLines,
          "Линии среза": bucket.sliceLines,
          "Доля ёмкости, %": bucket.shareOfCapacityPct,
          "Доля занятости, %": bucket.shareOfOccupiedPct,
          Состав: composition(bucket.byEventType)
        })),
        rows: data.rows.map((row) => ({
          [groupTitle]: row.label,
          "Место-сутки": row.placeDays,
          Линии: row.lines,
          "Доля ёмкости, %": row.shareOfCapacityPct,
          "Доля занятости, %": row.shareOfOccupiedPct,
          Состав: composition(row.byEventType)
        })),
        eventTypes: data.byEventType.map((part) => ({ label: part.label, placeDays: part.placeDays }))
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="analyticsStack">
      <div className="analyticsModuleHead">
        <div>
          <strong>Занятость</strong>
          <span className="muted"> · {periodLabel}</span>
        </div>
        <button
          type="button"
          className="btn ganttIconBtn"
          onClick={() => void onExport()}
          disabled={exporting || (data.rows.length === 0 && summary.capacityPlaceDays === 0)}
          title="Выгрузить занятость в Excel"
          aria-label="Выгрузить занятость в Excel"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 2h7l4 4v12H5z" />
            <path d="M12 2v4h4" />
            <path d="M7 14l2-4" />
            <path d="M11 14l-2-4" />
            <path d="M12.5 14h2.5" />
            <path d="M12.5 10h2.5" />
          </svg>
        </button>
      </div>

      <div className="analyticsStats">
        <div className="analyticsStat card">
          <div className="analyticsStatLabel">Место-сутки</div>
          <div className="analyticsStatValue">{fmtNum(summary.slicePlaceDays)}</div>
          <div className="muted analyticsStatHint">{sliceLabel}</div>
        </div>
        <div className="analyticsStat card">
          <div className="analyticsStatLabel">Линии</div>
          <div className="analyticsStatValue">{fmtNum(summary.sliceLines, 2)}</div>
          <div className="muted analyticsStatHint">место-сутки / {fmtNum(summary.periodDays)} дн.</div>
        </div>
        <div className="analyticsStat card">
          <div className="analyticsStatLabel">Доля ёмкости</div>
          <div className="analyticsStatValue">{fmtNum(summary.shareOfCapacityPct)}%</div>
          <div className="muted analyticsStatHint">от выбранных ангаров</div>
        </div>
        <div className="analyticsStat card">
          <div className="analyticsStatLabel">Доля занятости</div>
          <div className="analyticsStatValue">{fmtNum(summary.shareOfOccupiedPct)}%</div>
          <div className="muted analyticsStatHint">от всех занятых мест</div>
        </div>
        <div className="analyticsStat card">
          <div className="analyticsStatLabel">Ёмкость</div>
          <div className="analyticsStatValue">{fmtNum(summary.capacityPlaceDays)}</div>
          <div className="muted analyticsStatHint">{fmtNum(summary.capacityLines, 2)} линий активной схемы</div>
        </div>
      </div>

      {summary.unplacedEventCount > 0 ? (
        <div className="muted">
          Событий с ангаром без места: {summary.unplacedEventCount}. В место-сутки они не входят.
        </div>
      ) : null}
      {data.truncated ? (
        <div className="muted">Показана только первая часть интервалов: период длиннее лимита детализации.</div>
      ) : null}

      <section className="card analyticsCard">
        <h3>Состав по типам событий</h3>
        {data.byEventType.length === 0 ? (
          <div className="muted">В срезе нет занятых мест.</div>
        ) : (
          <ul className="analyticsBarList">
            {data.byEventType.map((part) => (
              <li key={part.id}>
                <span>{part.label}</span>
                <span>
                  {fmtNum(part.placeDays)} · {fmtNum(part.lines, 2)} лин. · {fmtNum(part.sharePct)}%
                </span>
                <span className="analyticsBarFill" style={{ width: `${Math.min(100, part.sharePct)}%` }} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card analyticsCard">
        <div className="analyticsModuleHead">
          <h3>Линии по {detailLabel.toLowerCase()}</h3>
          <div className="sandboxesTabs">
            <button
              type="button"
              className={lineStack === "aircraftType" ? "sandboxesTab active" : "sandboxesTab"}
              onClick={() => setLineStack("aircraftType")}
            >
              Типы ВС
            </button>
            <button
              type="button"
              className={lineStack === "eventType" ? "sandboxesTab active" : "sandboxesTab"}
              onClick={() => setLineStack("eventType")}
            >
              Виды событий
            </button>
          </div>
        </div>
        {chart ? (
          <div className="analyticsChartBlock" style={{ height: 280 }}>
            <Chart type="bar" data={chart.data} options={chart.options} />
          </div>
        ) : (
          <div className="muted">В выбранном периоде нет линий для этой диаграммы.</div>
        )}
      </section>

      <section className="card analyticsCard">
        <h3>По времени · {detailLabel}</h3>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>Интервал</th>
                <th>Ёмкость</th>
                <th>Занято</th>
                <th>Срез</th>
                <th>Линии</th>
                <th>Доля ёмкости</th>
                <th>Доля занятости</th>
              </tr>
            </thead>
            <tbody>
              {data.buckets.map((bucket) => (
                <tr key={bucket.key}>
                  <td>{bucket.label}</td>
                  <td>{fmtNum(bucket.capacityPlaceDays)}</td>
                  <td>{fmtNum(bucket.occupiedPlaceDays)}</td>
                  <td>{fmtNum(bucket.slicePlaceDays)}</td>
                  <td>{fmtNum(bucket.sliceLines, 2)}</td>
                  <td>{fmtNum(bucket.shareOfCapacityPct)}%</td>
                  <td>{fmtNum(bucket.shareOfOccupiedPct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card analyticsCard">
        <h3>{groupTitle}</h3>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>{groupTitle}</th>
                <th>Место-сутки</th>
                <th>Линии</th>
                <th>Доля ёмкости</th>
                <th>Доля занятости</th>
                <th>Состав</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Нет занятых мест в этом срезе.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{fmtNum(row.placeDays)}</td>
                    <td>{fmtNum(row.lines, 2)}</td>
                    <td>{fmtNum(row.shareOfCapacityPct)}%</td>
                    <td>{fmtNum(row.shareOfOccupiedPct)}%</td>
                    <td>{composition(row.byEventType)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function buildLinesChart(
  buckets: OccupancyResponse["buckets"],
  stack: "aircraftType" | "eventType"
): { data: ChartData<"bar">; options: ChartOptions<"bar"> } | null {
  if (buckets.length === 0) return null;
  const partsOf = (bucket: OccupancyResponse["buckets"][number]) =>
    stack === "aircraftType" ? bucket.byAircraftType : bucket.byEventType;
  const totals = new Map<string, { label: string; lines: number }>();
  for (const bucket of buckets) {
    for (const part of partsOf(bucket)) {
      const current = totals.get(part.id) ?? { label: part.label, lines: 0 };
      current.lines += part.lines;
      totals.set(part.id, current);
    }
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1].lines - a[1].lines || a[1].label.localeCompare(b[1].label, "ru"));
  if (ranked.length === 0 || ranked.every((item) => item[1].lines <= 0)) return null;
  const top = ranked.slice(0, 8);
  const topIds = new Set(top.map(([id]) => id));
  const datasets = top.map(([id, part], index) => ({
    label: part.label,
    data: buckets.map((bucket) => partsOf(bucket).find((item) => item.id === id)?.lines ?? 0),
    backgroundColor: EVENT_COLORS[index % EVENT_COLORS.length],
    stack: "lines"
  }));
  if (ranked.length > top.length) {
    datasets.push({
      label: "Прочие",
      data: buckets.map((bucket) =>
        partsOf(bucket)
          .filter((item) => !topIds.has(item.id))
          .reduce((sum, item) => sum + item.lines, 0)
      ),
      backgroundColor: EVENT_COLORS[EVENT_COLORS.length - 1]!,
      stack: "lines"
    });
  }
  return {
    data: {
      labels: buckets.map((bucket) => axisLabel(bucket.label)),
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", align: "start", labels: { boxWidth: 12, boxHeight: 12, color: "#475569" } }
      },
      scales: {
        x: { stacked: true, ticks: { color: "#64748b", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: "#64748b" },
          title: { display: true, text: "Линии", color: "#64748b" }
        }
      }
    }
  };
}
