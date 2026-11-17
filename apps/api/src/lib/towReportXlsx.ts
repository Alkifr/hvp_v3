import ExcelJS from "exceljs";

import { groupTowReportRows } from "./towRegistryMail.js";
import { TOW_EXPORT_COLUMNS, type TowReportRow } from "./towReport.js";

export async function buildTowRegistryXlsx(rows: TowReportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP";
  const ws = wb.addWorksheet("Буксировки", { views: [{ state: "frozen", ySplit: 1 }] });
  const span = TOW_EXPORT_COLUMNS.length;
  ws.addRow(TOW_EXPORT_COLUMNS.map((column) => column.title));
  ws.getRow(1).font = { bold: true };
  for (const group of groupTowReportRows(rows)) {
    const band = ws.addRow([group.label]);
    ws.mergeCells(band.number, 1, band.number, span);
    band.font = { bold: true };
    band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } };
    for (const row of group.rows) {
      ws.addRow(TOW_EXPORT_COLUMNS.map((column) => row[column.key] ?? ""));
    }
  }
  ws.columns = TOW_EXPORT_COLUMNS.map((column) => ({
    width: Math.min(48, Math.max(14, column.title.length + 4))
  }));
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
