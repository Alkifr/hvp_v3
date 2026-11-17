import ExcelJS from "exceljs";

import {
  diffPlanPayloads,
  fmtStamp,
  historyEventPlace,
  wasBecameText,
  type HistoryChange,
  type HistoryEvent,
  type HistoryPayload
} from "./personnelPlanHistory";

const DEPARTMENTS = ["ME", "AV", "INT", "NDT", "SHOP", "CAB_REP", "PAINT"];

function solid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function put(cell: ExcelJS.Cell, value: string | number, fill?: string) {
  cell.value = value;
  cell.font = { name: "Calibri", size: 11 };
  cell.alignment = { vertical: "top", wrapText: true };
  cell.border = {
    top: { style: "thin", color: { argb: "FFE2E8F0" } },
    left: { style: "thin", color: { argb: "FFE2E8F0" } },
    bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
    right: { style: "thin", color: { argb: "FFE2E8F0" } }
  };
  if (fill) cell.fill = solid(fill);
}

function hoursOf(event: HistoryEvent, payload: HistoryPayload) {
  const totals: Record<string, number> = {};
  for (const day of payload.calculation ?? []) {
    const item = day.eventDemand?.find((row) => row.id === event.id);
    if (!item?.byDepartment) continue;
    for (const [department, hours] of Object.entries(item.byDepartment)) {
      totals[department] = (totals[department] ?? 0) + Number(hours || 0);
    }
  }
  return totals;
}

function fmtHours(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function buildPersonnelPlanHistoryWorkbook(input: {
  before: HistoryPayload;
  after: HistoryPayload;
  baselineAt: string;
  targetAt: string;
  asOfLabel: string;
  title: string;
}) {
  const changes = diffPlanPayloads(input.before, input.after);
  const byEvent = new Map(changes.filter((row) => row.eventId).map((row) => [row.eventId, row]));
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP";
  const changesSheet = wb.addWorksheet("Было-Стало");
  const planSheet = wb.addWorksheet("План на дату");
  writeChanges(changesSheet, input, changes);
  writePlan(planSheet, input.after, byEvent, input);
  return wb;
}

function writeChanges(ws: ExcelJS.Worksheet, input: { before: HistoryPayload; after: HistoryPayload; baselineAt: string; targetAt: string; asOfLabel: string; title: string }, changes: HistoryChange[]) {
  ws.mergeCells(1, 1, 1, 5);
  put(ws.getCell(1, 1), `${input.title}. Состояние на ${input.asOfLabel} (МСК). Снимок ${fmtStamp(input.targetAt)}. Исходный план ${fmtStamp(input.baselineAt)}.`, "FFFFF7ED");
  ws.getRow(1).height = 32;
  const headers = ["Что", "Что изменилось", "Было", "Стало", "Было / Стало"];
  headers.forEach((header, index) => put(ws.getCell(3, index + 1), header, "FFE2E8F0"));
  const rows = changes.length ? changes : [{ what: "Изменений нет", changed: "—", before: "—", after: "—", eventId: "", kind: "total" as const }];
  rows.forEach((row, index) => {
    const line = 4 + index;
    const fill = row.kind === "added" ? "FFDCFCE7" : row.kind === "removed" ? "FFFEE2E2" : row.kind === "changed" ? "FFFFF7ED" : undefined;
    put(ws.getCell(line, 1), row.what, fill);
    put(ws.getCell(line, 2), row.changed, fill);
    put(ws.getCell(line, 3), row.before, fill);
    put(ws.getCell(line, 4), row.after, fill);
    put(ws.getCell(line, 5), wasBecameText(row), fill);
  });
  ws.columns = [{ width: 36 }, { width: 22 }, { width: 54 }, { width: 54 }, { width: 54 }];
  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 5 } };
}

function writePlan(ws: ExcelJS.Worksheet, payload: HistoryPayload, byEvent: Map<string, HistoryChange>, input: { targetAt: string; baselineAt: string; asOfLabel: string }) {
  ws.mergeCells(1, 1, 1, 12);
  put(ws.getCell(1, 1), `План ${payload.from}–${payload.to} на ${input.asOfLabel} (МСК). Это уже изменённый снимок от ${fmtStamp(input.targetAt)}. Исходное формирование ${fmtStamp(input.baselineAt)}.`, "FFFFF7ED");
  ws.getRow(1).height = 32;
  const headers = ["Борт", "Событие", "Цех", "Заказчик", "Тип ВС", "Ангар / место", "Начало", "Окончание", "Статус", "Часы", "Было", "Стало"];
  headers.forEach((header, index) => put(ws.getCell(3, index + 1), header, "FFE2E8F0"));
  const events = [...(payload.events ?? [])].sort((a, b) => (a.aircraftLabel || "").localeCompare(b.aircraftLabel || "", "ru") || (a.title || "").localeCompare(b.title || "", "ru"));
  events.forEach((event, index) => {
    const line = 4 + index;
    const change = byEvent.get(event.id);
    const fill = change?.kind === "added" ? "FFDCFCE7" : change ? "FFFFF7ED" : undefined;
    const hours = hoursOf(event, payload);
    const hourText = DEPARTMENTS.flatMap((department) => Math.abs(hours[department] ?? 0) >= 0.05 ? [`${department} ${fmtHours(hours[department] ?? 0)}`] : []).join(", ");
    const values = [
      event.aircraftLabel || "—",
      event.title || "—",
      event.workshop?.code || event.workshop?.name || "—",
      event.operator?.code || event.operator?.name || "—",
      event.aircraftType?.icaoType || event.aircraftType?.name || "—",
      change ? "" : "",
      fmtStamp(event.startAt),
      fmtStamp(event.endAt),
      event.statusLabel || event.status || "—",
      hourText || "—",
      change?.before ?? "",
      change?.after ?? ""
    ];
    const place = historyEventPlace(event, payload.from, payload.to);
    values[5] = `${place.hangar} / ${place.stand}`;
    values.forEach((value, column) => put(ws.getCell(line, column + 1), value, fill));
  });
  if (!events.length) put(ws.getCell(4, 1), "В снимке нет событий.");
  ws.columns = [{ width: 14 }, { width: 28 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 22 }, { width: 54 }, { width: 54 }];
  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 12 } };
}

export async function exportPersonnelPlanHistoryExcel(input: {
  before: HistoryPayload;
  after: HistoryPayload;
  baselineAt: string;
  targetAt: string;
  asOfLabel: string;
  title: string;
}) {
  const wb = buildPersonnelPlanHistoryWorkbook(input);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = input.asOfLabel.replace(/[^\d]/g, "").slice(0, 12);
  link.href = url;
  link.download = `plan-history-${input.after.from}_${input.after.to}-${stamp || "asof"}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
