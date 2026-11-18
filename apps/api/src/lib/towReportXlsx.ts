import ExcelJS from "exceljs";

import { groupTowReportRows } from "./towRegistryMail.js";
import { TOW_EXPORT_COLUMNS, type TowReportRow } from "./towReport.js";

const TOW_EXPORT_WIDTHS = [6, 12, 14, 14, 12, 12, 20, 22, 18, 20, 14, 24];
const HANGAR_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } };

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

export async function buildTowRegistryXlsx(rows: TowReportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP";
  const ws = wb.addWorksheet("Буксировки", { views: [{ state: "frozen", ySplit: 1 }] });
  const widths = TOW_EXPORT_COLUMNS.map((_, index) => TOW_EXPORT_WIDTHS[index] ?? 16);
  const header = ws.addRow(TOW_EXPORT_COLUMNS.map((column) => column.title));
  header.height = excelRowHeight(
    TOW_EXPORT_COLUMNS.map((column) => column.title),
    widths
  );
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  });
  const labelSpan = Math.min(3, TOW_EXPORT_COLUMNS.length);
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
      const values = TOW_EXPORT_COLUMNS.map((column) => row[column.key] ?? "");
      const data = ws.addRow(values);
      data.height = excelRowHeight(values, widths);
      data.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { wrapText: true, vertical: "middle" };
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
