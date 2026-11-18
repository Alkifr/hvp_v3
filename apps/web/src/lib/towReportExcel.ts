import ExcelJS from "exceljs";

export const TOW_EXPORT_COLUMNS: Array<{ key: string; title: string }> = [
  { key: "seq", title: "№" },
  { key: "aircraftType", title: "Тип ВС" },
  { key: "tailNumber", title: "Бортовой номер" },
  { key: "operator", title: "Оператор" },
  { key: "fromStand", title: "Откуда (с МС)" },
  { key: "toStand", title: "Куда (на МС)" },
  { key: "plannedStartMsk", title: "Плановое время начала буксировки (мск)" },
  { key: "standOccupancy", title: "Требуемая продолжительность занятия МС" },
  { key: "notes", title: "Примечание" },
  { key: "toSlotDuration", title: "Продолжительность слотов ТО" },
  { key: "positionComment", title: "Позиция" },
  { key: "startChangeReason", title: "Причина изменения времени начала буксировки (<60 мин)" }
];

export const TOW_REGISTRY_EXPORT_COLUMNS: Array<{ key: string; title: string }> = [
  { key: "seq", title: "Строка" },
  { key: "hangarNumber", title: "Ангар" },
  { key: "aircraftType", title: "Тип ВС" },
  { key: "tailNumber", title: "Бортовой номер" },
  { key: "operator", title: "Оператор" },
  { key: "eventTitle", title: "Событие" },
  { key: "eventStartMsk", title: "Начало события (мск)" },
  { key: "eventEndMsk", title: "Окончание события (мск)" },
  { key: "inMark", title: "Закатка" },
  { key: "inFrom", title: "Закатка откуда" },
  { key: "inTo", title: "Закатка куда" },
  { key: "inStartMsk", title: "Закатка начало (мск)" },
  { key: "inEndMsk", title: "Закатка окончание (мск)" },
  { key: "outMark", title: "Выкатка" },
  { key: "outFrom", title: "Выкатка откуда" },
  { key: "outTo", title: "Выкатка куда" },
  { key: "outStartMsk", title: "Выкатка начало (мск)" },
  { key: "outEndMsk", title: "Выкатка окончание (мск)" },
  { key: "changeMark", title: "Отличие от отправки" }
];

function hangarBandLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Без ангара";
  if (/^ангар\b/i.test(trimmed)) return trimmed.replace(/^ангар/i, "Ангар");
  const number = trimmed.match(/(\d+)/);
  if (number) return `Ангар ${number[1]}`;
  return `Ангар ${trimmed}`;
}

function hangarSortKey(name: string): number {
  const number = name.match(/(\d+)/);
  return number ? Number(number[1]) : Number.MAX_SAFE_INTEGER;
}

function groupRows(rows: Array<Record<string, string | number | null | undefined>>) {
  const sorted = rows
    .map((row, index) => ({ row, index, label: hangarBandLabel(String(row.hangarNumber ?? "")) }))
    .sort((a, b) => hangarSortKey(a.label) - hangarSortKey(b.label) || a.label.localeCompare(b.label, "ru") || a.index - b.index);
  const groups: Array<{ label: string; rows: Array<Record<string, string | number | null | undefined>> }> = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const seq = last?.label === item.label ? last.rows.length + 1 : 1;
    const next = { ...item.row, seq };
    if (last?.label === item.label) last.rows.push(next);
    else groups.push({ label: item.label, rows: [next] });
  }
  return groups;
}

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

function writeTowSheet(
  ws: ExcelJS.Worksheet,
  columns: Array<{ key: string; title: string }>,
  groups: Array<{ label: string; rows: Array<Record<string, string | number | null | undefined>> }>
) {
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
  const labelSpan = Math.min(3, columns.length);
  for (const group of groups) {
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
      const values = columns.map((column) => row[column.key] ?? "");
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
}

export async function downloadTowReportXlsx(
  rows: Array<Record<string, string | number | null | undefined>>,
  fileName: string,
  columns: Array<{ key: string; title: string }> = TOW_EXPORT_COLUMNS
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP";
  const ws = wb.addWorksheet("Буксировки", { views: [{ state: "frozen", ySplit: 1 }] });
  writeTowSheet(ws, columns, groupRows(rows));
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
