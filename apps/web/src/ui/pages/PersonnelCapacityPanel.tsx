import { useMemo } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions
} from "chart.js";
import { Chart } from "react-chartjs-2";

import {
  capacityHours,
  categoryCapacity,
  formatPersonnelNumber,
  type CapacityHours
} from "../../lib/personnelPlanning";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);

type CapacityLine = {
  key: string;
  label: string;
  planDepartment: string | null;
  supply: "department" | "qualification";
};

type CapacityDay = {
  date: string;
  demand?: Record<string, number>;
  authorizedSupply?: Record<string, number>;
  qualificationSupply?: Record<string, number>;
  overallDemand: number;
  overallSupply: number;
};

type ResourceSlice = {
  workshopId: string;
  aircraftTypeId: string;
  planned: number;
  available: number;
  difference: number;
};

const EPS = 0.05;

function dayLabel(value: string) {
  const [, month, day] = value.slice(0, 10).split("-");
  return day && month ? `${day}.${month}` : value;
}

function formatSigned(value: number) {
  const text = formatPersonnelNumber(value);
  return value > EPS ? `+${text}` : text;
}

function formatHeatHours(value: number) {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 1) return "0";
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatLoadFactor(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%`;
}

function heatTone(point: CapacityHours): { background: string; color: string } {
  if (point.capacity <= EPS && point.load <= EPS) return { background: "#f8fafc", color: "#94a3b8" };
  if (point.slack < -EPS) {
    const depth = point.loadFactorPct == null ? 1 : Math.min(1, Math.max(0.28, (point.loadFactorPct - 100) / 40));
    return { background: `rgba(185, 28, 28, ${0.18 + depth * 0.55})`, color: depth > 0.55 ? "#fff" : "#7f1d1d" };
  }
  if (point.slack > EPS) {
    const room = point.loadFactorPct == null ? 1 : Math.min(1, Math.max(0.22, (100 - point.loadFactorPct) / 40));
    return { background: `rgba(21, 128, 61, ${0.14 + room * 0.45})`, color: "#14532d" };
  }
  return { background: "#e2e8f0", color: "#334155" };
}

export function PersonnelCapacityPanel(props: {
  days: CapacityDay[];
  lines: CapacityLine[];
  slices: ResourceSlice[];
  workshops: Array<{ id: string; code: string; name: string }>;
  aircraftTypes: Array<{ id: string; name: string; icaoType?: string | null }>;
}) {
  const { days, lines, slices, workshops, aircraftTypes } = props;
  const model = useMemo(() => {
    const byDay = days.map((day) => {
      const overall = capacityHours(day.overallDemand, day.overallSupply);
      const categories = lines.map((line) => ({ line, point: categoryCapacity(day, line) }));
      return { day, overall, categories };
    });
    const overall = capacityHours(
      days.reduce((sum, day) => sum + day.overallDemand, 0),
      days.reduce((sum, day) => sum + day.overallSupply, 0)
    );
    const byLine = lines.map((line) => {
      const cells = byDay.map((row) => row.categories.find((item) => item.line.key === line.key)?.point ?? capacityHours(0, 0));
      return {
        line,
        cells,
        total: capacityHours(
          cells.reduce((sum, cell) => sum + cell.load, 0),
          cells.reduce((sum, cell) => sum + cell.capacity, 0)
        )
      };
    });
    const ranked = [...byLine].sort((a, b) => a.total.slack - b.total.slack || a.line.label.localeCompare(b.line.label, "ru"));
    return { byDay, overall, byLine, ranked };
  }, [days, lines]);

  const labels = model.byDay.map((row) => dayLabel(row.day.date));
  const dense = labels.length > 20;

  const levelData = useMemo<ChartData<"bar" | "line">>(() => ({
    labels,
    datasets: [
      {
        type: "bar",
        label: "Загрузка",
        data: model.byDay.map((row) => Number(row.overall.load.toFixed(1))),
        backgroundColor: "rgba(180, 83, 9, 0.72)",
        hoverBackgroundColor: "rgba(180, 83, 9, 0.9)",
        borderRadius: dense ? 0 : 3,
        maxBarThickness: 36,
        order: 2
      },
      {
        type: "line",
        label: "Ёмкость",
        data: model.byDay.map((row) => Number(row.overall.capacity.toFixed(1))),
        borderColor: "#0e7490",
        backgroundColor: "#0e7490",
        pointRadius: dense ? 0 : 3,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.2,
        order: 1
      }
    ]
  }), [dense, labels, model.byDay]);

  const levelOptions = useMemo<ChartOptions<"bar" | "line">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", align: "start", labels: { boxWidth: 12, boxHeight: 12, color: "#475569", font: { size: 12 } } },
      tooltip: {
        callbacks: {
          afterBody: (items) => {
            const row = model.byDay[items[0]?.dataIndex ?? 0];
            if (!row) return [];
            return [`Резерв: ${formatSigned(row.overall.slack)} ч·ч`, `Загрузка: ${formatLoadFactor(row.overall.loadFactorPct)}`];
          }
        }
      }
    },
    scales: {
      x: { grid: { color: "rgba(148, 163, 184, 0.2)" }, ticks: { color: "#64748b", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
      y: { min: 0, title: { display: true, text: "ч·ч", color: "#64748b" }, grid: { color: "rgba(148, 163, 184, 0.25)" }, ticks: { color: "#64748b" } }
    }
  }), [model.byDay]);

  const slackData = useMemo<ChartData<"bar">>(() => ({
    labels,
    datasets: [{
      label: "Резерв",
      data: model.byDay.map((row) => Number(row.overall.slack.toFixed(1))),
      backgroundColor: model.byDay.map((row) => row.overall.slack < -EPS ? "rgba(185, 28, 28, 0.78)" : row.overall.slack > EPS ? "rgba(21, 128, 61, 0.72)" : "rgba(100, 116, 139, 0.45)"),
      borderRadius: dense ? 0 : 3,
      maxBarThickness: 36
    }]
  }), [dense, labels, model.byDay]);

  const slackOptions = useMemo<ChartOptions<"bar">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
      plugins: {
      legend: { position: "top", align: "start", labels: { boxWidth: 12, boxHeight: 12, color: "#475569", font: { size: 12 } } },
      tooltip: { callbacks: { label: (item) => `Резерв: ${formatSigned(Number(item.raw))} ч·ч` } }
    },
    scales: {
      x: { grid: { color: "rgba(148, 163, 184, 0.2)" }, ticks: { color: "#64748b", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
      y: { title: { display: true, text: "ч·ч", color: "#64748b" }, grid: { color: "rgba(148, 163, 184, 0.25)" }, ticks: { color: "#64748b" } }
    }
  }), []);

  const workshopName = new Map(workshops.map((row) => [row.id, row.code || row.name]));
  const typeName = new Map(aircraftTypes.map((row) => [row.id, row.icaoType || row.name]));
  const sliceRows = [...slices]
    .map((row) => ({ ...row, point: capacityHours(row.planned, row.available) }))
    .sort((a, b) => a.point.slack - b.point.slack || (workshopName.get(a.workshopId) || "").localeCompare(workshopName.get(b.workshopId) || "", "ru"));
  const slackScale = Math.max(1, ...model.ranked.map((row) => Math.abs(row.total.slack)));

  return (
    <div className="personnelCapacity">
      <section className="card">
        <div className="personnelSectionHead">
          <div>
            <h2>Capacity</h2>
          </div>
        </div>
        <div className="analyticsStats">
          <article className="card analyticsStat">
            <div className="analyticsStatLabel">Ёмкость</div>
            <div className="analyticsStatValue">{formatPersonnelNumber(model.overall.capacity)}</div>
            <div className="analyticsStatHint muted">ч·ч за период</div>
          </article>
          <article className="card analyticsStat">
            <div className="analyticsStatLabel">Загрузка</div>
            <div className="analyticsStatValue">{formatPersonnelNumber(model.overall.load)}</div>
            <div className="analyticsStatHint muted">ч·ч, план MPS</div>
          </article>
          <article className="card analyticsStat">
            <div className="analyticsStatLabel">Резерв</div>
            <div className={`analyticsStatValue balance-${model.overall.slack < -EPS ? "negative" : model.overall.slack > EPS ? "positive" : "neutral"}`}>{formatSigned(model.overall.slack)}</div>
            <div className="analyticsStatHint muted">ёмкость − загрузка, ч·ч</div>
          </article>
          <article className="card analyticsStat">
            <div className="analyticsStatLabel">Загрузка ёмкости</div>
            <div className="analyticsStatValue">{formatLoadFactor(model.overall.loadFactorPct)}</div>
            <div className="analyticsStatHint muted">выше 100% — перегруз</div>
          </article>
        </div>
      </section>

      <div className="personnelCapacityCharts">
        <section className="card">
          <h3>Загрузка и ёмкость</h3>
          <div className="personnelCapacityChart">{days.length ? <Chart type="bar" data={levelData} options={levelOptions} /> : <div className="muted">Нет суток в периоде.</div>}</div>
        </section>
        <section className="card">
          <h3>Резерв по суткам</h3>
          <div className="personnelCapacityChart">{days.length ? <Chart type="bar" data={slackData} options={slackOptions} /> : <div className="muted">Нет суток в периоде.</div>}</div>
        </section>
      </div>

      <section className="card">
        <div className="personnelSectionHead">
          <div>
            <h2>Резерв по категориям</h2>
            <div className="muted">В ячейке — резерв категории за сутки, ч·ч. Красный — загрузка выше ёмкости, зелёный — избыток. Насыщенность показывает, насколько загрузка ушла от 100% ёмкости.</div>
          </div>
        </div>
        <div className="personnelHeatLegend">
          <span><i className="personnelHeatSwatch isOver" />Перегруз</span>
          <span><i className="personnelHeatSwatch isFit" />Без разрыва</span>
          <span><i className="personnelHeatSwatch isSlack" />Избыток</span>
        </div>
        <div className="personnelTableScroll">
          <table className="personnelHeat" style={{ ["--heat-days" as string]: Math.max(model.byDay.length, 1) }}>
            <colgroup>
              <col className="personnelHeatLabel" />
              {model.byDay.map((row) => <col key={row.day.date} />)}
              <col className="personnelHeatTotal" />
            </colgroup>
            <thead>
              <tr>
                <th>Категория</th>
                {model.byDay.map((row) => <th key={row.day.date}>{dayLabel(row.day.date)}</th>)}
                <th>Период</th>
              </tr>
            </thead>
            <tbody>
              {model.byLine.map((row) => (
                <tr key={row.line.key}>
                  <th>{row.line.label}</th>
                  {row.cells.map((cell, index) => (
                    <td key={model.byDay[index]?.day.date ?? index} style={heatTone(cell)} title={`${row.line.label}: ёмкость ${formatPersonnelNumber(cell.capacity)}, загрузка ${formatPersonnelNumber(cell.load)}, ${formatLoadFactor(cell.loadFactorPct)}`}>
                      {cell.capacity <= EPS && cell.load <= EPS ? "" : formatHeatHours(cell.slack)}
                    </td>
                  ))}
                  <td style={heatTone(row.total)}>{formatHeatHours(row.total.slack)}</td>
                </tr>
              ))}
              <tr>
                <th>Итого</th>
                {model.byDay.map((row) => (
                  <td key={row.day.date} style={heatTone(row.overall)}>{formatHeatHours(row.overall.slack)}</td>
                ))}
                <td style={heatTone(model.overall)}>{formatHeatHours(model.overall.slack)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {model.ranked.length ? (
          <div className="personnelSlackList">
            {model.ranked.map((row) => {
              const width = `${(Math.abs(row.total.slack) / slackScale) * 50}%`;
              const surplus = row.total.slack >= 0;
              return (
                <div key={row.line.key} className="personnelSlackRow">
                  <span>{row.line.label}</span>
                  <div className="personnelSlackTrack" aria-hidden="true">
                    <i />
                    <span className={surplus ? "isSlack" : "isOver"} style={surplus ? { left: "50%", width } : { right: "50%", width }} />
                  </div>
                  <b className={row.total.slack < -EPS ? "isOverText" : row.total.slack > EPS ? "isSlackText" : undefined}>{formatSigned(row.total.slack)} · {formatLoadFactor(row.total.loadFactorPct)}</b>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {sliceRows.length ? (
        <section className="card">
          <div className="personnelSectionHead">
            <div>
              <h2>Ёмкость по цеху и типу ВС</h2>
              <div className="muted">Сначала строки с наименьшим резервом. Это тот же разрез, что сводка под графиком.</div>
            </div>
          </div>
          <div className="personnelTableScroll">
            <table className="personnelCapacityTable">
              <thead>
                <tr>
                  <th>Цех</th>
                  <th>Тип ВС</th>
                  <th className="num">Ёмкость</th>
                  <th className="num">Загрузка</th>
                  <th className="num">Резерв</th>
                  <th className="num">Загрузка</th>
                </tr>
              </thead>
              <tbody>
                {sliceRows.map((row) => (
                  <tr key={`${row.workshopId}:${row.aircraftTypeId}`}>
                    <td>{workshopName.get(row.workshopId) || "—"}</td>
                    <td>{typeName.get(row.aircraftTypeId) || "—"}</td>
                    <td className="num">{formatPersonnelNumber(row.point.capacity)}</td>
                    <td className="num">{formatPersonnelNumber(row.point.load)}</td>
                    <td className={`num balance-${row.point.slack < -EPS ? "negative" : row.point.slack > EPS ? "positive" : "neutral"}`}>{formatSigned(row.point.slack)}</td>
                    <td className="num">{formatLoadFactor(row.point.loadFactorPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
