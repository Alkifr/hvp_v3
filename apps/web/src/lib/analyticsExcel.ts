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

import { lightenForDarkText } from "./colorContrast";
import { occupiedHalfRanges } from "./monthlyPlanLayout";

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

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function argbHex(color: string | null | undefined, fallback = "FF7DD3FC"): string {
  const raw = String(color ?? "").trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `FF${hex.toUpperCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return hex.toUpperCase();
  return fallback;
}

export type MonthlyBasePlanExcelInput = {
  periodLabel: string;
  nrcFactor: number;
  days: Array<{ key: string; label: string; weekend: boolean }>;
  events: Array<{
    title: string;
    aircraft: string;
    aircraftType: string;
    operatorCode: string;
    hangarName: string;
    workshopName: string;
    color: string;
    startAt: string;
    endAt: string;
    occupied: Array<{ day: boolean; evening: boolean }>;
    labor: Array<{ day: number; evening: number }>;
    qualifications: {
      ME: number;
      AV: number;
      INT: number;
      NDT: number;
      SHOP: number;
      CAB_REP: number;
    };
  }>;
  shops: Array<{
    workshopName: string;
    planned: number[];
    plannedWithNrc: number[];
  }>;
};

const SHIFT_COL_WIDTH = 3.4;
const AC_GREEN = "FF66FF33";
const DAY_LINE = { style: "thin" as const, color: { argb: "FF475569" } };
const SHIFT_LINE = { style: "dashed" as const, color: { argb: "FF94A3B8" } };
const HAIR_LINE = { style: "hair" as const, color: { argb: "FFCBD5E1" } };
const QUAL_COLUMNS = [
  { key: "ME" as const, label: "ME" },
  { key: "AV" as const, label: "AV" },
  { key: "INT" as const, label: "INT" },
  { key: "NDT" as const, label: "NDT" },
  { key: "SHOP" as const, label: "SHOP" },
  { key: "CAB_REP" as const, label: "CabRep" }
];

function verticalShiftBorders(col: number, firstShiftCol: number) {
  const evening = (col - firstShiftCol) % 2 === 1;
  return {
    left: evening ? SHIFT_LINE : DAY_LINE,
    right: evening ? DAY_LINE : SHIFT_LINE,
    top: HAIR_LINE,
    bottom: HAIR_LINE
  };
}

function applyShiftGrid(ws: ExcelJS.Worksheet, row: number, firstShiftCol: number, lastCol: number) {
  for (let c = firstShiftCol; c <= lastCol; c++) {
    const cell = ws.getCell(row, c);
    cell.border = { ...cell.border, ...verticalShiftBorders(c, firstShiftCol) };
  }
}

function applyFitToWidth(ws: ExcelJS.Worksheet) {
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
  };
}

function addLaborDetailSheet(wb: ExcelJS.Workbook, params: MonthlyBasePlanExcelInput) {
  const ws = wb.addWorksheet("ЧЧ по квалификациям", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = [
    "Ангар",
    "Тип ВС",
    "Борт",
    "Оператор",
    "Ответственный цех",
    "Событие",
    "Начало",
    "Окончание",
    ...QUAL_COLUMNS.map((c) => c.label),
    "Итого"
  ];
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  for (const ev of params.events) {
    const q = ev.qualifications;
    const total = QUAL_COLUMNS.reduce((s, c) => s + (q[c.key] ?? 0), 0);
    const row = ws.addRow([
      ev.hangarName,
      ev.aircraftType,
      ev.aircraft,
      ev.operatorCode,
      ev.workshopName,
      ev.title,
      ev.startAt ? new Date(ev.startAt) : "",
      ev.endAt ? new Date(ev.endAt) : "",
      ...QUAL_COLUMNS.map((c) => (q[c.key] > 0 ? q[c.key] : "")),
      total > 0 ? Math.round(total * 10) / 10 : ""
    ]);
    row.getCell(7).numFmt = "dd.mm.yyyy hh:mm";
    row.getCell(8).numFmt = "dd.mm.yyyy hh:mm";
    for (let c = 9; c <= 15; c++) row.getCell(c).numFmt = "0.0";
  }
  ws.columns = [
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 18 },
    { width: 28 },
    { width: 18 },
    { width: 18 },
    ...QUAL_COLUMNS.map(() => ({ width: 10 })),
    { width: 10 }
  ];
  if (params.events.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: headers.length } };
  applyFitToWidth(ws);
}

export async function exportMonthlyBasePlanExcel(params: MonthlyBasePlanExcelInput) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP Analytics";
  const ws = wb.addWorksheet("Месячный план Base", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 6 }]
  });

  const dayCount = params.days.length;
  const lastCol = 3 + dayCount * 2;
  ws.mergeCells(1, 1, 1, Math.max(6, lastCol));
  ws.getCell(1, 1).value = `Месячный план Base · ${params.periodLabel}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, Math.max(6, lastCol));
  ws.getCell(2, 1).value =
    "Строка оператора — слот ТО. Строка цеха — плановые ч/ч (Д / Н). Ангар — только разделительный заголовок. Расчётные трудовые ресурсы — заглушки. NRC = план × " +
    String(params.nrcFactor).replace(".", ",");
  ws.getCell(2, 1).font = { italic: true, color: { argb: "FF64748B" } };

  const headerRow = 5;
  const halfRow = 6;
  ws.getCell(headerRow, 1).value = "Тип ВС";
  ws.getCell(headerRow, 2).value = "Рег. номер";
  ws.getCell(headerRow, 3).value = "Оператор / цех";
  for (let i = 0; i < dayCount; i++) {
    const c = 4 + i * 2;
    ws.mergeCells(headerRow, c, headerRow, c + 1);
    const cell = ws.getCell(headerRow, c);
    cell.value = params.days[i]!.label;
    cell.alignment = { horizontal: "center", wrapText: true };
    cell.font = { bold: true };
    if (params.days[i]!.weekend) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA9D08E" } };
      ws.getCell(headerRow, c + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA9D08E" } };
    }
    ws.getCell(halfRow, c).value = "Д";
    ws.getCell(halfRow, c + 1).value = "Н";
    ws.getCell(halfRow, c).alignment = { horizontal: "center" };
    ws.getCell(halfRow, c + 1).alignment = { horizontal: "center" };
  }
  for (let c = 1; c <= lastCol; c++) {
    ws.getCell(headerRow, c).font = { ...(ws.getCell(headerRow, c).font ?? {}), bold: true };
    ws.getCell(halfRow, c).font = { bold: true, size: 9, color: { argb: "FF64748B" } };
  }
  applyShiftGrid(ws, headerRow, 4, lastCol);
  applyShiftGrid(ws, halfRow, 4, lastCol);

  const laborRowsByShop = new Map<string, number[]>();
  let r = 7;
  let lastHangar = "";
  for (const ev of params.events) {
    if (ev.hangarName !== lastHangar) {
      lastHangar = ev.hangarName;
      ws.mergeCells(r, 1, r, lastCol);
      ws.getCell(r, 1).value = ev.hangarName;
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      r += 1;
    }
    const slotRow = r;
    const laborRow = r + 1;
    ws.mergeCells(slotRow, 1, laborRow, 1);
    ws.getCell(slotRow, 1).value = ev.aircraftType;
    ws.getCell(slotRow, 1).alignment = { vertical: "middle", wrapText: true };
    ws.getCell(slotRow, 1).font = { bold: true, size: 10 };
    ws.getCell(slotRow, 2).value = ev.aircraft;
    ws.getCell(slotRow, 3).value = ev.operatorCode;
    ws.getCell(laborRow, 3).value = ev.workshopName;
    for (const col of [2, 3]) {
      for (const row of [slotRow, laborRow]) {
        ws.getCell(row, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AC_GREEN } };
        ws.getCell(row, col).font = { bold: true, size: 10 };
        ws.getCell(row, col).alignment = { vertical: "middle" };
      }
    }
    const fillArgb = argbHex(lightenForDarkText(ev.color));
    applyShiftGrid(ws, slotRow, 4, lastCol);
    applyShiftGrid(ws, laborRow, 4, lastCol);
    ws.getRow(slotRow).alignment = { wrapText: false, shrinkToFit: false, vertical: "middle" };
    const ranges = occupiedHalfRanges(ev.occupied);
    const titleCol = ranges[0] ? 4 + ranges[0].from : null;
    for (const range of ranges) {
      const c1 = 4 + range.from;
      const c2 = 4 + range.to;
      for (let c = c1; c <= c2; c++) {
        const cell = ws.getCell(slotRow, c);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        cell.value = null;
        cell.alignment = { wrapText: false, shrinkToFit: false, vertical: "middle", horizontal: "left" };
      }
    }
    if (titleCol != null) {
      const cell = ws.getCell(slotRow, titleCol);
      cell.value = ev.title;
      cell.font = { color: { argb: "FF0F172A" }, size: 11, bold: true };
      cell.alignment = { horizontal: "left", vertical: "middle", wrapText: false, shrinkToFit: false };
    }
    for (let i = 0; i < dayCount; i++) {
      const lab = ev.labor[i];
      const c = 4 + i * 2;
      if ((lab?.day ?? 0) > 0) {
        const cell = ws.getCell(laborRow, c);
        cell.value = lab!.day;
        cell.font = { size: 10 };
        cell.alignment = { horizontal: "center" };
      }
      if ((lab?.evening ?? 0) > 0) {
        const cell = ws.getCell(laborRow, c + 1);
        cell.value = lab!.evening;
        cell.font = { size: 10 };
        cell.alignment = { horizontal: "center" };
      }
    }
    const list = laborRowsByShop.get(ev.workshopName) ?? [];
    list.push(laborRow);
    laborRowsByShop.set(ev.workshopName, list);
    r += 2;
  }

  r += 1;
  ws.mergeCells(r, 1, r, 3);
  ws.getCell(r, 1).value = `Запланированный объём работ с учётом NRC (×${params.nrcFactor})`;
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
  r += 1;
  const plannedRows: number[] = [];
  for (const shop of params.shops) {
    ws.getCell(r, 1).value = shop.workshopName;
    ws.getCell(r, 3).value = "план + NRC";
    const rows = laborRowsByShop.get(shop.workshopName) ?? [];
    for (let i = 0; i < dayCount; i++) {
      for (const offset of [0, 1]) {
        const c = 4 + i * 2 + offset;
        const cell = ws.getCell(r, c);
        if (rows.length === 0) {
          cell.value = shop.plannedWithNrc[i] != null && offset === 0 ? shop.plannedWithNrc[i] : null;
        } else {
          const parts = rows.map((row) => `${colLetter(c)}${row}`);
          cell.value = { formula: `(${parts.join("+")})*${params.nrcFactor}` };
        }
        cell.numFmt = "0.0";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
      }
    }
    plannedRows.push(r);
    r += 1;
  }

  r += 1;
  ws.mergeCells(r, 1, r, 3);
  ws.getCell(r, 1).value = "Расчётные трудовые ресурсы (заглушка — заполните вручную)";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  r += 1;
  const capacityRows: Array<{ shop: string; row: number }> = [];
  for (const shop of params.shops) {
    ws.getCell(r, 1).value = shop.workshopName;
    ws.getCell(r, 3).value = "ёмкость";
    for (let c = 4; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
      cell.border = {
        top: { style: "dotted", color: { argb: "FFD4A017" } },
        left: { style: "dotted", color: { argb: "FFD4A017" } },
        bottom: { style: "dotted", color: { argb: "FFD4A017" } },
        right: { style: "dotted", color: { argb: "FFD4A017" } }
      };
    }
    if (capacityRows.length === 0) {
      ws.getCell(r, 4).note = "Введите расчётные трудовые ресурсы цеха по дням. Ячейки выгружаются пустыми специально.";
    }
    capacityRows.push({ shop: shop.workshopName, row: r });
    r += 1;
    ws.getCell(r, 1).value = shop.workshopName;
    ws.getCell(r, 3).value = "AM/SM";
    for (let c = 4; c <= lastCol; c++) {
      ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    }
    r += 1;
  }

  r += 1;
  ws.mergeCells(r, 1, r, 3);
  ws.getCell(r, 1).value = "Разница (ёмкость − план с NRC)";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
  r += 1;
  for (let i = 0; i < params.shops.length; i++) {
    const shop = params.shops[i]!;
    const planRow = plannedRows[i];
    const cap = capacityRows.find((x) => x.shop === shop.workshopName);
    ws.getCell(r, 1).value = shop.workshopName;
    ws.getCell(r, 3).value = "Δ";
    for (let c = 4; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      if (planRow && cap) {
        const capRef = `${colLetter(c)}${cap.row}`;
        const planRef = `${colLetter(c)}${planRow}`;
        cell.value = { formula: `IF(${capRef}="","",${capRef}-${planRef})` };
      }
      cell.numFmt = "0.0";
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
    }
    r += 1;
  }

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 12;
  for (let c = 4; c <= lastCol; c++) {
    ws.getColumn(c).width = SHIFT_COL_WIDTH;
  }
  ws.getRow(headerRow).height = 22;
  ws.pageSetup.printTitlesRow = `${headerRow}:${halfRow}`;
  applyFitToWidth(ws);

  addLaborDetailSheet(wb, params);

  await downloadWorkbook(wb, `monthly-base-plan-${dayjs().format("YYYY-MM-DD_HHmm")}.xlsx`);
}

export async function exportTowsExcel(params: {
  periodLabel: string;
  detailLabel: string;
  kpis: ExcelKpi[];
  directions: Array<{ label: string; count: number }>;
  reasons: Array<{ label: string; count: number }>;
  routes: Array<{ label: string; count: number }>;
  hangars: Array<Record<string, string | number | null>>;
  timeline: Array<Record<string, string | number | null>>;
  tows: Array<Record<string, string | number | null>>;
  hourChart: { labels: string[]; counts: number[] };
  timelineChart: { labels: string[]; tows: number[]; occupancyH: number[]; peakConcurrent: number[] };
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP Analytics";
  addKpiSheet(wb, params.kpis, [
    ["Модуль", "Tows"],
    ["Период", params.periodLabel],
    ["Детализация", params.detailLabel],
    ["Выгружено", dayjs().format("YYYY-MM-DD HH:mm")]
  ]);
  addSheetFromRows(wb, "Буксировки", params.tows);
  addSheetFromRows(wb, "Ангары", params.hangars);
  addSheetFromRows(wb, "Таймлайн", params.timeline);
  addSheetFromRows(
    wb,
    "Направления",
    params.directions.map((d) => ({ Направление: d.label, Количество: d.count }))
  );
  addSheetFromRows(
    wb,
    "Причины сдвига",
    params.reasons.map((d) => ({ Причина: d.label, Количество: d.count }))
  );
  addSheetFromRows(
    wb,
    "Маршруты",
    params.routes.map((d) => ({ Маршрут: d.label, Количество: d.count }))
  );

  await addChartSheet(wb, "Tows — графики", [
    {
      title: "Таймлайн буксировок",
      config: {
        type: "bar",
        data: {
          labels: params.timelineChart.labels,
          datasets: [
            {
              type: "bar",
              label: "Буксировок",
              data: params.timelineChart.tows,
              yAxisID: "yCount",
              backgroundColor: "rgba(14, 116, 144, 0.35)"
            },
            {
              type: "line",
              label: "Занятие МС, ч",
              data: params.timelineChart.occupancyH,
              yAxisID: "yHours",
              borderColor: "#0d9488"
            },
            {
              type: "line",
              label: "Пик одновременных",
              data: params.timelineChart.peakConcurrent,
              yAxisID: "yCount",
              borderColor: "#b45309"
            }
          ]
        },
        options: {
          scales: {
            yCount: { position: "left", beginAtZero: true },
            yHours: { position: "right", beginAtZero: true, grid: { display: false } }
          }
        }
      }
    },
    {
      title: "Старт по часам",
      config: {
        type: "bar",
        data: {
          labels: params.hourChart.labels,
          datasets: [{ label: "Старт", data: params.hourChart.counts, backgroundColor: "rgba(13, 148, 136, 0.55)" }]
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      }
    }
  ]);

  await downloadWorkbook(wb, `analytics-tows-${dayjs().format("YYYY-MM-DD_HHmm")}.xlsx`);
}
