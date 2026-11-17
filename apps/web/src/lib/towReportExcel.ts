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

export async function downloadTowReportXlsx(
  rows: Array<Record<string, string | number | null | undefined>>,
  fileName: string,
  columns: Array<{ key: string; title: string }> = TOW_EXPORT_COLUMNS
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP";
  const ws = wb.addWorksheet("Буксировки", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(columns.map((c) => c.title));
  ws.getRow(1).font = { bold: true };
  const groups = groupRows(rows);
  for (const group of groups) {
    if (groups.length > 1 || group.label) {
      const band = ws.addRow([group.label]);
      ws.mergeCells(band.number, 1, band.number, columns.length);
      band.font = { bold: true };
      band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } };
    }
    for (const row of group.rows) ws.addRow(columns.map((c) => row[c.key] ?? ""));
  }
  ws.columns = columns.map((c) => ({
    header: c.title,
    width: Math.min(48, Math.max(14, c.title.length + 4))
  }));
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
