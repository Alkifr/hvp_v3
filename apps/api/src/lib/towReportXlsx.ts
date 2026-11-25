import ExcelJS from "exceljs";

import { groupTowReportRows } from "./towRegistryMail.js";
import { REGISTRY_ADDED, REGISTRY_UPDATED, type RegistryMailRow } from "./towRegistrySheet.js";
import { TOW_EXPORT_COLUMNS } from "./towReport.js";

const TOW_EXPORT_WIDTHS = [6, 12, 14, 14, 12, 12, 20, 22, 18, 20, 14, 24, 16];
const HANGAR_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } };
const ADDED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
const UPDATED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };

function statusFill(status: string | undefined): ExcelJS.Fill | null {
  if (status === REGISTRY_ADDED) return ADDED_FILL;
  if (status === REGISTRY_UPDATED) return UPDATED_FILL;
  return null;
}

function excelLines(value: string | number | null | undefined, width: number): number {
  const room = Math.max(4, width - 1);
  return String(value ?? "")
    .split(/\r?\n/)
    .reduce((sum, part) => sum + Math.max(1, Math.ceil((part.length || 1) / room)), 0);
}

function excelRowHeight(values: Array<string | number | null | undefined>, widths: number[]): number {
  let lines = 1;
  values.forEach((value, index) => {
    lines = Math.max(lines, excelLines(value, widths[index] ?? 14));
  });
  return Math.min(64, 15 * lines + 6);
}

export async function buildTowRegistryXlsx(rows: RegistryMailRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP";
  const ws = wb.addWorksheet("Буксировки", { views: [{ state: "frozen", ySplit: 1 }] });
  const withStatus = rows.some((row) => typeof row.changeStatus === "string");
  const columns = withStatus ? [...TOW_EXPORT_COLUMNS, { key: "changeStatus" as const, title: "Статус" }] : TOW_EXPORT_COLUMNS;
  const widths = columns.map((_, index) => TOW_EXPORT_WIDTHS[index] ?? 16);
  const header = ws.addRow(columns.map((column) => column.title));
  header.height = excelRowHeight(
    columns.map((column) => column.title),
    widths
  );
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  });
  const labelSpan = columns.length;
  for (const group of groupTowReportRows(rows)) {
    const band = ws.addRow([group.label]);
    if (labelSpan > 1) ws.mergeCells(band.number, 1, band.number, labelSpan);
    for (let col = 1; col <= labelSpan; col += 1) {
      const cell = band.getCell(col);
      cell.font = { bold: true };
      cell.fill = HANGAR_FILL;
      cell.alignment = { vertical: "middle", wrapText: true };
    }
    band.height = 20;
    for (const row of group.rows) {
      const values = columns.map((column) => (column.key === "changeStatus" ? row.changeStatus ?? "" : row[column.key] ?? ""));
      const data = ws.addRow(values);
      data.height = excelRowHeight(values, widths);
      const fill = statusFill(row.changeStatus);
      data.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { wrapText: true, vertical: "middle" };
        if (fill) cell.fill = fill;
      });
    }
  }
  widths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
