import ExcelJS from "exceljs";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration
} from "chart.js";
import dayjs from "dayjs";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler
);

export type ExcelKpi = { label: string; value: string | number; hint?: string };

async function chartPngBase64(config: ChartConfiguration, width = 960, height = 420): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const chart = new ChartJS(canvas, {
    ...config,
    options: {
      ...(config.options ?? {}),
      responsive: false,
      animation: false,
      devicePixelRatio: 2
    }
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const dataUrl = canvas.toDataURL("image/png");
  chart.destroy();
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

async function downloadWorkbook(wb: ExcelJS.Workbook, fileName: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function addSheetFromRows(wb: ExcelJS.Workbook, name: string, rows: Array<Record<string, string | number | null | undefined>>) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  if (rows.length === 0) {
    ws.addRow(["Нет данных"]);
    return ws;
  }
  const keys = Object.keys(rows[0]!);
  ws.addRow(keys);
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(keys.map((k) => row[k] ?? ""));
  }
  ws.columns = keys.map((k) => ({
    header: k,
    key: k,
    width: Math.min(42, Math.max(12, k.length + 2))
  }));
  return ws;
}

function addKpiSheet(wb: ExcelJS.Workbook, kpis: ExcelKpi[], meta: Array<[string, string]>) {
  const ws = wb.addWorksheet("Сводка");
  ws.addRow(["Параметр", "Значение"]);
  ws.getRow(1).font = { bold: true };
  for (const [k, v] of meta) ws.addRow([k, v]);
  ws.addRow([]);
  ws.addRow(["Метрика", "Значение", "Пояснение"]);
  ws.getRow(ws.rowCount).font = { bold: true };
  for (const k of kpis) ws.addRow([k.label, k.value, k.hint ?? ""]);
  ws.columns = [{ width: 28 }, { width: 18 }, { width: 40 }];
  return ws;
}

async function addChartSheet(wb: ExcelJS.Workbook, title: string, charts: Array<{ title: string; config: ChartConfiguration }>) {
  const ws = wb.addWorksheet("Графики");
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 14 };
  let row = 3;
  for (const c of charts) {
    ws.getCell(`A${row}`).value = c.title;
    ws.getCell(`A${row}`).font = { bold: true };
    row += 1;
    try {
      const base64 = await chartPngBase64(c.config);
      const imgId = wb.addImage({ base64, extension: "png" });
      ws.addImage(imgId, {
        tl: { col: 0, row: row - 1 },
        ext: { width: 860, height: 380 }
      });
      row += 22;
    } catch {
      ws.getCell(`A${row}`).value = "Не удалось сформировать график";
      row += 2;
    }
  }
  ws.getColumn(1).width = 40;
}

export async function exportTatExcel(params: {
  periodLabel: string;
  kpis: ExcelKpi[];
  events: Array<Record<string, string | number | null>>;
  deviations: Array<{ label: string; count: number }>;
  reasons: Array<{ reason: string; count: number }>;
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP Analytics";
  addKpiSheet(wb, params.kpis, [
    ["Модуль", "TAT variance"],
    ["Период", params.periodLabel],
    ["Выгружено", dayjs().format("YYYY-MM-DD HH:mm")]
  ]);
  addSheetFromRows(wb, "События", params.events);
  addSheetFromRows(
    wb,
    "Отклонения",
    params.deviations.map((d) => ({ Отклонение: d.label, Количество: d.count }))
  );
  addSheetFromRows(
    wb,
    "Причины",
    params.reasons.map((d) => ({ Причина: d.reason, Количество: d.count }))
  );

  const maxDev = Math.max(1, ...params.deviations.map((d) => d.count));
  const maxReason = Math.max(1, ...params.reasons.map((d) => d.count));
  await addChartSheet(wb, "TAT variance — графики", [
    {
      title: "Типы отклонений",
      config: {
        type: "bar",
        data: {
          labels: params.deviations.map((d) => d.label),
          datasets: [
            {
              label: "Событий",
              data: params.deviations.map((d) => d.count),
              backgroundColor: "rgba(13, 148, 136, 0.55)",
              borderRadius: 4
            }
          ]
        },
        options: {
          indexAxis: "y",
          plugins: { legend: { display: false } },
          scales: { x: { min: 0, suggestedMax: maxDev }, y: { ticks: { autoSkip: false } } }
        }
      }
    },
    {
      title: "Причины",
      config: {
        type: "bar",
        data: {
          labels: params.reasons.map((d) => (d.reason.length > 40 ? `${d.reason.slice(0, 40)}…` : d.reason)),
          datasets: [
            {
              label: "Событий",
              data: params.reasons.map((d) => d.count),
              backgroundColor: "rgba(180, 83, 9, 0.5)",
              borderRadius: 4
            }
          ]
        },
        options: {
          indexAxis: "y",
          plugins: { legend: { display: false } },
          scales: { x: { min: 0, suggestedMax: maxReason }, y: { ticks: { autoSkip: false } } }
        }
      }
    }
  ]);

  await downloadWorkbook(wb, `analytics-tat-${dayjs().format("YYYY-MM-DD_HHmm")}.xlsx`);
}

export async function exportUtilizationExcel(params: {
  periodLabel: string;
  detailLabel: string;
  kpis: ExcelKpi[];
  timeline: Array<Record<string, string | number | null>>;
  hangars: Array<Record<string, string | number | null>>;
  stands: Array<Record<string, string | number | null>>;
  timelineChart: {
    labels: string[];
    aircraftHours: number[];
    standUtilizationPct: number[];
    capacityUtilizationPct: number[];
  };
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP Analytics";
  addKpiSheet(wb, params.kpis, [
    ["Модуль", "Utilization"],
    ["Период", params.periodLabel],
    ["Детализация", params.detailLabel],
    ["Выгружено", dayjs().format("YYYY-MM-DD HH:mm")]
  ]);
  addSheetFromRows(wb, "Таймлайн", params.timeline);
  addSheetFromRows(wb, "Ангары", params.hangars);
  addSheetFromRows(wb, "Места", params.stands);

  await addChartSheet(wb, "Utilization — графики", [
    {
      title: "Таймлайн утилизации",
      config: {
        type: "bar",
        data: {
          labels: params.timelineChart.labels,
          datasets: [
            {
              type: "bar",
              label: "Спрос (ВС·ч)",
              data: params.timelineChart.aircraftHours,
              yAxisID: "yHours",
              backgroundColor: "rgba(14, 116, 144, 0.35)",
              order: 3
            },
            {
              type: "line",
              label: "Stand util, %",
              data: params.timelineChart.standUtilizationPct,
              yAxisID: "yPct",
              borderColor: "#0d9488",
              backgroundColor: "rgba(13, 148, 136, 0.18)",
              fill: true,
              tension: 0.25,
              order: 1
            },
            {
              type: "line",
              label: "Эффективность, %",
              data: params.timelineChart.capacityUtilizationPct,
              yAxisID: "yPct",
              borderColor: "#b45309",
              borderDash: [5, 4],
              fill: false,
              tension: 0.25,
              order: 2
            }
          ]
        },
        options: {
          scales: {
            yPct: { type: "linear", position: "left", min: 0, suggestedMax: 100, title: { display: true, text: "%" } },
            yHours: { type: "linear", position: "right", min: 0, grid: { drawOnChartArea: false }, title: { display: true, text: "ВС·ч" } }
          }
        }
      }
    }
  ]);

  await downloadWorkbook(wb, `analytics-utilization-${dayjs().format("YYYY-MM-DD_HHmm")}.xlsx`);
}

export async function exportCompareExcel(params: {
  periodLabel: string;
  nameA: string;
  nameB: string;
  kpis: ExcelKpi[];
  sides: Array<Record<string, string | number | null>>;
  hangars: Array<Record<string, string | number | null>>;
  events: Array<Record<string, string | number | null>>;
  chart: { labels: string[]; aHours: number[]; bHours: number[] };
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP Analytics";
  addKpiSheet(wb, params.kpis, [
    ["Модуль", "Сценарии A vs B"],
    ["Период", params.periodLabel],
    ["Сценарий A", params.nameA],
    ["Сценарий B", params.nameB],
    ["Выгружено", dayjs().format("YYYY-MM-DD HH:mm")]
  ]);
  addSheetFromRows(wb, "Стороны", params.sides);
  addSheetFromRows(wb, "Ангары", params.hangars);
  addSheetFromRows(wb, "События", params.events);

  await addChartSheet(wb, "Сценарии A vs B — графики", [
    {
      title: "Занятость по ангарам (ч)",
      config: {
        type: "bar",
        data: {
          labels: params.chart.labels,
          datasets: [
            {
              label: `A · ${params.nameA}`,
              data: params.chart.aHours,
              backgroundColor: "rgba(14, 116, 144, 0.45)",
              borderRadius: 3
            },
            {
              label: `B · ${params.nameB}`,
              data: params.chart.bHours,
              backgroundColor: "rgba(180, 83, 9, 0.45)",
              borderRadius: 3
            }
          ]
        },
        options: {
          scales: { y: { beginAtZero: true, title: { display: true, text: "ч" } } }
        }
      }
    }
  ]);

  await downloadWorkbook(wb, `analytics-compare-${dayjs().format("YYYY-MM-DD_HHmm")}.xlsx`);
}
