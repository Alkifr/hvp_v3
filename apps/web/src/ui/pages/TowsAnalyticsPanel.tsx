import { useMemo, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions
} from "chart.js";
import { Chart } from "react-chartjs-2";
import dayjs from "dayjs";

import { exportTowsExcel } from "../../lib/analyticsExcel";
import {
  summarizeTowAnalytics,
  type TowAnalyticsGrain,
  type TowAnalyticsRow,
  type TowTimelinePoint
} from "../../lib/towAnalytics";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, Filler);

export type TowsAnalyticsResponse = {
  ok: true;
  period: { from: string; to: string };
  rows: TowAnalyticsRow[];
};

type AnalyticsFilters = {
  hangarIds: string[];
  operatorIds: string[];
  aircraftTypeIds: string[];
  aircraftIds: string[];
  eventTypeIds: string[];
};

const DETAIL_LEVEL_LABEL: Record<TowAnalyticsGrain, string> = {
  day: "сутки",
  week: "недели",
  month: "месяцы",
  period: "весь период"
};

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function matchFilters(row: TowAnalyticsRow, filters: AnalyticsFilters): boolean {
  if (filters.hangarIds.length > 0) {
    const id = row.hangarId ? String(row.hangarId) : "";
    if (!id || !filters.hangarIds.includes(id)) return false;
  }
  if (filters.operatorIds.length > 0) {
    const id = row.operatorId ? String(row.operatorId) : "";
    if (!id || !filters.operatorIds.includes(id)) return false;
  }
  if (filters.aircraftTypeIds.length > 0) {
    const id = row.aircraftTypeId ? String(row.aircraftTypeId) : "";
    if (!id || !filters.aircraftTypeIds.includes(id)) return false;
  }
  if (filters.aircraftIds.length > 0) {
    const id = row.aircraftId ? String(row.aircraftId) : "";
    if (!id || !filters.aircraftIds.includes(id)) return false;
  }
  if (filters.eventTypeIds.length > 0) {
    const id = row.eventTypeId ? String(row.eventTypeId) : "";
    if (!id || !filters.eventTypeIds.includes(id)) return false;
  }
  return true;
}

function ExcelExportButton(props: { onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <button
      type="button"
      className="btn ganttIconBtn"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      aria-label={props.title}
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
  );
}

function StatCards(props: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <div className="analyticsStats">
      {props.items.map((it) => (
        <div key={it.label} className="analyticsStat card">
          <div className="analyticsStatLabel">{it.label}</div>
          <div className="analyticsStatValue">{it.value}</div>
          {it.hint ? <div className="muted analyticsStatHint">{it.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

function HorizontalBars(props: { title: string; empty: string; items: Array<{ label: string; count: number }>; color: string }) {
  const data = useMemo<ChartData<"bar">>(
    () => ({
      labels: props.items.map((d) => (d.label.length > 36 ? `${d.label.slice(0, 36)}…` : d.label)),
      datasets: [
        {
          label: "Буксировок",
          data: props.items.map((d) => d.count),
          backgroundColor: props.color,
          borderRadius: 4
        }
      ]
    }),
    [props.items, props.color]
  );
  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: "rgba(148, 163, 184, 0.25)" }, ticks: { color: "#64748b" } },
        y: { grid: { display: false }, ticks: { color: "#334155", autoSkip: false, font: { size: 11 } } }
      }
    }),
    []
  );
  return (
    <section className="card analyticsCard">
      <h3>{props.title}</h3>
      {props.items.length === 0 ? (
        <div className="muted">{props.empty}</div>
      ) : (
        <div className="analyticsTatChartWrap">
          <Chart type="bar" data={data} options={options} />
        </div>
      )}
    </section>
  );
}

function TowsTimelineChart(props: { points: TowTimelinePoint[] }) {
  const { points } = props;
  const chartData = useMemo<ChartData<"bar" | "line">>(
    () => ({
      labels: points.map((p) => p.label),
      datasets: [
        {
          type: "bar",
          label: "Буксировок",
          data: points.map((p) => p.tows),
          yAxisID: "yCount",
          backgroundColor: "rgba(14, 116, 144, 0.35)",
          hoverBackgroundColor: "rgba(14, 116, 144, 0.55)",
          borderRadius: 3,
          order: 3
        },
        {
          type: "line",
          label: "Занятие МС, ч",
          data: points.map((p) => Number(p.occupancyH.toFixed(1))),
          yAxisID: "yHours",
          borderColor: "#0d9488",
          backgroundColor: "rgba(13, 148, 136, 0.18)",
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          borderWidth: 2,
          order: 1
        },
        {
          type: "line",
          label: "Пик одновременных",
          data: points.map((p) => p.peakConcurrent),
          yAxisID: "yCount",
          borderColor: "#b45309",
          fill: false,
          tension: 0.25,
          pointRadius: 2,
          borderWidth: 2,
          borderDash: [5, 4],
          order: 2
        }
      ]
    }),
    [points]
  );
  const options = useMemo<ChartOptions<"bar" | "line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "start",
          labels: { boxWidth: 12, boxHeight: 12, color: "#475569", font: { size: 12 } }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#64748b", maxRotation: 0 } },
        yCount: {
          position: "left",
          beginAtZero: true,
          ticks: { color: "#64748b", precision: 0 },
          grid: { color: "rgba(148, 163, 184, 0.25)" }
        },
        yHours: {
          position: "right",
          beginAtZero: true,
          ticks: { color: "#0f766e" },
          grid: { display: false }
        }
      }
    }),
    []
  );
  if (points.length === 0) return <div className="muted">Нет точек для таймлайна за выбранный период/фильтр.</div>;
  const peak = points.reduce((best, p) => (p.tows > best.tows ? p : best), points[0]!);
  return (
    <div className="analyticsTimeline">
      <div className="analyticsTimelineChartWrap">
        <Chart type="bar" data={chartData} options={options} />
      </div>
      <div className="analyticsTimelineTooltip muted">
        Пик объёма: {peak.label} ({peak.tows} букс.)
      </div>
    </div>
  );
}

export function TowsAnalyticsPanel(props: {
  q: { isLoading: boolean; error: Error | null; data?: TowsAnalyticsResponse };
  filters: AnalyticsFilters;
  grain: TowAnalyticsGrain;
  periodLabel: string;
  fromIso: string;
  toIso: string;
  tzOffset: number;
}) {
  const { q, filters, grain, periodLabel, fromIso, toIso, tzOffset } = props;
  const [exporting, setExporting] = useState(false);
  const data = q.data;

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => matchFilters(r, filters)),
    [data?.rows, filters]
  );
  const computed = useMemo(
    () =>
      summarizeTowAnalytics(rows, {
        fromIso,
        toIso,
        grain,
        tzOffsetMinutes: tzOffset
      }),
    [rows, fromIso, toIso, grain, tzOffset]
  );

  const kpis = [
    { label: "Буксировок", value: String(computed.summary.tows), hint: `событий: ${computed.summary.events}` },
    {
      label: "Ср. на событие",
      value: fmtNum(computed.summary.avgTowsPerEvent),
      hint: "обычно закатка + выкатка"
    },
    {
      label: "Ср. длительность, мин",
      value: fmtNum(computed.summary.avgTowDurationMin),
      hint: `медиана ${fmtNum(computed.summary.medianTowDurationMin)}`
    },
    {
      label: "Ср. занятие МС, ч",
      value: fmtNum(computed.summary.avgOccupancyH),
      hint: "от начала буксировки до конца МС"
    },
    {
      label: "Пик одновременных",
      value: String(computed.summary.peakConcurrent),
      hint: computed.summary.peakConcurrentAt
        ? dayjs(computed.summary.peakConcurrentAt).format("DD.MM HH:mm")
        : "окно движения"
    },
    {
      label: "Закатка / выкатка / перест.",
      value: `${computed.summary.inCount} / ${computed.summary.outCount} / ${computed.summary.transferCount}`
    },
    {
      label: "Сдвиги плана",
      value: computed.summary.changedStartPct == null ? "—" : `${fmtNum(computed.summary.changedStartPct)}%`,
      hint: "есть причина изменения начала"
    },
    {
      label: "Занятие / слот ТО",
      value: computed.summary.avgOccupancyToSlotPct == null ? "—" : `${fmtNum(computed.summary.avgOccupancyToSlotPct)}%`,
      hint: "доля слота, занятая с момента буксировки"
    }
  ];

  const hourData = useMemo<ChartData<"bar">>(
    () => ({
      labels: computed.hours.map((h) => h.label),
      datasets: [
        {
          label: "Старт буксировки",
          data: computed.hours.map((h) => h.count),
          backgroundColor: "rgba(13, 148, 136, 0.55)",
          borderRadius: 3
        }
      ]
    }),
    [computed.hours]
  );
  const hourOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#64748b", maxRotation: 0 } },
        y: { beginAtZero: true, ticks: { precision: 0, color: "#64748b" }, grid: { color: "rgba(148, 163, 184, 0.25)" } }
      }
    }),
    []
  );

  const onExport = async () => {
    setExporting(true);
    try {
      await exportTowsExcel({
        periodLabel,
        detailLabel: DETAIL_LEVEL_LABEL[grain],
        kpis,
        directions: computed.directions,
        reasons: computed.reasons,
        routes: computed.routes,
        hangars: computed.hangars.map((h) => ({
          Ангар: h.hangar,
          Буксировок: h.tows,
          Событий: h.events,
          Закатка: h.inCount,
          Выкатка: h.outCount,
          Перестановка: h.transferCount,
          "Ср. длительность, мин": h.avgTowDurationMin == null ? "" : Number(h.avgTowDurationMin.toFixed(1)),
          "Занятие МС, ч": Number(h.occupancyH.toFixed(1))
        })),
        timeline: computed.timeline.map((p) => ({
          Интервал: p.label,
          Буксировок: p.tows,
          "Занятие МС, ч": Number(p.occupancyH.toFixed(1)),
          "Движение, ч": Number(p.movementH.toFixed(1)),
          "Пик одновременных": p.peakConcurrent
        })),
        tows: rows.map((r) => ({
          Борт: r.aircraft,
          Событие: r.eventTitle,
          "Тип события": r.eventType,
          Ангар: r.hangar,
          Направление: r.directionLabel,
          Откуда: r.fromStand,
          Куда: r.toStand,
          "Длительность, мин": r.towDurationMin,
          "Занятие МС, мин": r.occupancyMin,
          "Слот ТО, мин": r.slotMin,
          "Причина сдвига": r.startChangeReason,
          Старт: r.startAt
        })),
        hourChart: {
          labels: computed.hours.map((h) => h.label),
          counts: computed.hours.map((h) => h.count)
        },
        timelineChart: {
          labels: computed.timeline.map((p) => p.label),
          tows: computed.timeline.map((p) => p.tows),
          occupancyH: computed.timeline.map((p) => Number(p.occupancyH.toFixed(1))),
          peakConcurrent: computed.timeline.map((p) => p.peakConcurrent)
        }
      });
    } finally {
      setExporting(false);
    }
  };

  if (q.isLoading && !data) return <div className="muted">Загрузка…</div>;
  if (q.error && !data) return <div className="error">{String((q.error as Error).message ?? q.error)}</div>;
  if (!data) return null;

  return (
    <div className="analyticsStack">
      <div className="analyticsModuleHead">
        <div>
          <strong>Tows</strong>
          <span className="muted">
            {" "}
            · {periodLabel} · {DETAIL_LEVEL_LABEL[grain]}
          </span>
        </div>
        <ExcelExportButton
          onClick={() => void onExport()}
          disabled={exporting || rows.length === 0}
          title="Выгрузить аналитику буксировок в Excel (таблицы + графики)"
        />
      </div>

      <p className="muted small">
        Бенчмарк по плановым буксировкам контура: объём и микс направлений, длительность движения, занятие МС относительно
        слота ТО, одновременность (ёмкость тягачей/бригад) и полнота маршрута. Факт движения в модели не хранится —
        сдвиги плана видны по полю причины изменения начала.
      </p>

      <StatCards items={kpis} />

      <div className="analyticsSplit">
        <HorizontalBars
          title="Направления"
          empty="Нет буксировок"
          items={computed.directions}
          color="rgba(13, 148, 136, 0.55)"
        />
        <HorizontalBars
          title="Причины сдвига начала"
          empty="Нет причин"
          items={computed.reasons}
          color="rgba(180, 83, 9, 0.5)"
        />
      </div>

      <section className="card analyticsCard">
        <div className="analyticsEffHeader">
          <div>
            <h3>Таймлайн буксировок</h3>
            <p className="muted small">Объём, занятие МС и пик одновременных окон движения · {DETAIL_LEVEL_LABEL[grain]}</p>
          </div>
        </div>
        <TowsTimelineChart points={computed.timeline} />
      </section>

      <div className="analyticsSplit">
        <section className="card analyticsCard">
          <h3>Старт по часам</h3>
          <p className="muted small">Час начала буксировки в выбранном часовом поясе</p>
          <div className="analyticsTatChartWrap">
            <Chart type="bar" data={hourData} options={hourOptions} />
          </div>
        </section>
        <HorizontalBars
          title="Маршруты МС"
          empty="Нет маршрутов"
          items={computed.routes}
          color="rgba(14, 116, 144, 0.45)"
        />
      </div>

      <section className="card analyticsCard">
        <h3>Ангары</h3>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>Ангар</th>
                <th>Букс.</th>
                <th>Событий</th>
                <th>IN / OUT / XFER</th>
                <th>Ср. длит., мин</th>
                <th>Занятие МС, ч</th>
              </tr>
            </thead>
            <tbody>
              {computed.hangars.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Нет данных
                  </td>
                </tr>
              ) : (
                computed.hangars.map((h) => (
                  <tr key={h.hangarId}>
                    <td>{h.hangar}</td>
                    <td>{h.tows}</td>
                    <td>{h.events}</td>
                    <td>
                      {h.inCount} / {h.outCount} / {h.transferCount}
                    </td>
                    <td>{fmtNum(h.avgTowDurationMin)}</td>
                    <td>{fmtNum(h.occupancyH)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card analyticsCard">
        <h3>Буксировки</h3>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>Борт</th>
                <th>Событие</th>
                <th>Маршрут</th>
                <th>Длит., мин</th>
                <th>МС, мин</th>
                <th>Причина сдвига</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Нет буксировок за период
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.aircraft}</td>
                    <td>
                      <div className="analyticsEventTitle">{r.eventTitle}</div>
                      <div className="muted">
                        {r.directionLabel || "—"}
                        {r.hangar ? ` · ${r.hangar}` : ""}
                        {` · ${dayjs(r.startAt).format("DD.MM HH:mm")}`}
                      </div>
                    </td>
                    <td>
                      {r.fromStand || "—"} → {r.toStand || "—"}
                    </td>
                    <td className={r.towDurationMin != null && r.towDurationMin > 60 ? "analyticsBad" : undefined}>
                      {fmtNum(r.towDurationMin, 0)}
                    </td>
                    <td>{fmtNum(r.occupancyMin, 0)}</td>
                    <td title={r.startChangeReason || undefined}>{r.startChangeReason || "—"}</td>
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
