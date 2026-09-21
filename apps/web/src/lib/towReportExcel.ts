import ExcelJS from "exceljs";

export const TOW_EXPORT_COLUMNS: Array<{ key: string; title: string }> = [
  { key: "seq", title: "Строка" },
  { key: "hangarNumber", title: "Ангар" },
  { key: "aircraftType", title: "Тип ВС" },
  { key: "tailNumber", title: "Бортовой номер" },
  { key: "operator", title: "Оператор" },
  { key: "fromStand", title: "Откуда (с МС)" },
  { key: "toStand", title: "Куда (на МС)" },
  { key: "plannedStartMsk", title: "Плановое время начала буксировки (мск)" },
  { key: "occupancyEndMsk", title: "Конец (мск)" },
  { key: "standOccupancy", title: "Продолжительность занятия МС" },
  { key: "notes", title: "Примечание" },
  { key: "toSlotEndMsk", title: "Слот ТО" },
  { key: "positionComment", title: "Позиция" },
  { key: "startChangeReason", title: "Причина изменения времени начала буксировки" }
];

export async function downloadTowReportXlsx(
  rows: Array<Record<string, string | number | null | undefined>>,
  fileName: string
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP";
  const ws = wb.addWorksheet("Буксировки", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(TOW_EXPORT_COLUMNS.map((c) => c.title));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(TOW_EXPORT_COLUMNS.map((c) => row[c.key] ?? ""));
  }
  ws.columns = TOW_EXPORT_COLUMNS.map((c) => ({
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
