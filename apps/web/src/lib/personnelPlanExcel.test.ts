import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import { buildPersonnelPlanWorkbook, type PersonnelPlanExcelInput } from "./personnelPlanExcel.ts";

function textOf(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "formula" in value) return String(value.formula);
  if (typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  return "";
}

function formulaOf(cell: ExcelJS.Cell) {
  return textOf(cell.value);
}

function noteOf(cell: ExcelJS.Cell) {
  const note = cell.note;
  if (!note) return "";
  if (typeof note === "string") return note;
  return note.texts?.map((part) => part.text).join("") ?? "";
}

function findCell(ws: ExcelJS.Worksheet, needle: string) {
  for (let row = 1; row <= ws.rowCount; row += 1) {
    for (let col = 1; col <= (ws.columnCount || 12); col += 1) {
      if (textOf(ws.getCell(row, col).value) === needle) return { row, col };
    }
  }
  return null;
}

function columnWith(ws: ExcelJS.Worksheet, row: number, needle: string) {
  for (let col = 1; col <= Math.max(ws.columnCount, 12); col += 1) {
    if (textOf(ws.getCell(row, col).value) === needle) return col;
  }
  return 0;
}

const input: PersonnelPlanExcelInput = {
  from: "2026-11-02",
  to: "2026-11-03",
  dates: ["2026-11-02", "2026-11-03"],
  shifts: [{ id: "day", code: "DAY", name: "День", startMin: 8 * 60 }],
  sheets: [{
    workshopId: "w1",
    code: "ЦПТО3",
    name: "Цех 3",
    aircraftTypes: [{ id: "a320", name: "Airbus A320", icaoType: "A320" }],
    categories: [
      { code: "B1", department: "ME" },
      { code: "LBMM", department: "ME" },
      { code: "AM", department: "AV" }
    ],
    items: [
      { date: "2026-11-02", shiftId: "day", aircraftTypeId: "a320", categoryCode: "B1", headcount: 2 },
      { date: "2026-11-02", shiftId: "day", aircraftTypeId: "a320", categoryCode: "LBMM", headcount: 1 },
      { date: "2026-11-02", shiftId: "day", aircraftTypeId: "a320", categoryCode: "AM", headcount: 4 }
    ]
  }],
  days: [
    {
      date: "2026-11-02",
      normHours: 10,
      eventDemand: [{ id: "e1", byDepartment: { ME: 5, AV: 1.5 } }]
    },
    { date: "2026-11-03", normHours: 8, eventDemand: [] }
  ],
  events: [
    {
      id: "e1",
      title: "C-check",
      tail: "RA-123",
      hangarLabel: "Ангар 1",
      workshopId: "w1",
      workshop: "ЦПТО3",
      operator: "AFL",
      aircraftTypeId: "a320",
      aircraftType: "A320",
      stand: "12",
      status: "В работе",
      startAt: "2026-11-02T05:00:00Z",
      endAt: "2026-11-03T15:00:00Z",
      color: "#336699",
      towSegments: [{ startAt: "2026-11-02T06:00:00Z", endAt: "2026-11-02T07:00:00Z" }]
    },
    {
      id: "e2",
      title: "Выкатка",
      tail: "RA-999",
      hangarLabel: "Ангар 1",
      workshopId: "w1",
      workshop: "ЦПТО3",
      operator: "AFL",
      aircraftTypeId: "a320",
      aircraftType: "A320",
      stand: "4",
      status: "План",
      startAt: "2026-11-03T06:00:00Z",
      endAt: "2026-11-03T07:00:00Z",
      color: "#22c55e",
      towSegments: [{ startAt: "2026-11-03T06:00:00Z", endAt: "2026-11-03T07:00:00Z" }]
    }
  ],
  departments: ["ME", "AV"],
  slices: [{ workshopId: "w1", workshop: "ЦПТО3", aircraftTypeId: "a320", aircraftType: "A320" }]
};

test("personnel plan workbook pulls chart values from the resource and plan sheets", () => {
  const wb = buildPersonnelPlanWorkbook(input);
  assert.deepEqual(wb.worksheets.map((sheet) => sheet.name), ["График", "Доступный ресурс", "План-Доступность"]);

  const resource = wb.getWorksheet("Доступный ресурс")!;
  const plan = wb.getWorksheet("План-Доступность")!;
  const chart = wb.getWorksheet("График")!;
  const headcountHeader = findCell(resource, "Квалификация")!;
  const dayColumn = columnWith(resource, headcountHeader.row, "02.11");
  const b1 = findRowBy(resource, { 2: "B1", 4: "A320" });
  const lbmm = findRowBy(resource, { 2: "LBMM", 4: "A320" });
  const meSum = findRowBy(resource, { 2: "ME", 3: "ME", 4: "A320" });
  assert.equal(resource.getCell(b1, dayColumn).value, 2);
  assert.equal(resource.getCell(lbmm, dayColumn).value, 1);
  const meSumFormula = formulaOf(resource.getCell(meSum, dayColumn));
  assert.match(meSumFormula, new RegExp(`SUM\\([A-Z]+${b1}:[A-Z]+${lbmm}\\)`));

  const norm = findCell(resource, "Норма часов")!;
  const normColumn = columnWith(resource, norm.row - 1, "02.11");
  assert.equal(resource.getCell(norm.row, normColumn).value, 10);
  const hoursHeader = findCell(resource, "Категория")!;
  const hoursDay = columnWith(resource, hoursHeader.row, "02.11");
  const meHours = findRowBy(resource, { 1: "ЦПТО3", 2: "ME", 3: "A320" }, hoursHeader.row);
  const meAllTypes = findRowBy(resource, { 1: "ЦПТО3", 2: "ME", 3: "Все типы" }, hoursHeader.row);
  const meAllShops = findRowBy(resource, { 1: "Все цеха", 2: "ME", 3: "Все типы" }, hoursHeader.row);
  const meHoursFormula = formulaOf(resource.getCell(meHours, hoursDay));
  assert.match(meHoursFormula, /N\([A-Z]+\d+\)/);
  assert.match(meHoursFormula, /\$[A-Z]+\$\d+/);
  assert.match(formulaOf(resource.getCell(meAllTypes, hoursDay)), new RegExp(String(meHours)));
  assert.match(formulaOf(resource.getCell(meAllShops, hoursDay)), /[A-Z]+\d+/);

  const planHeader = findCell(plan, "Событие")!;
  const planDate = columnWith(plan, planHeader.row, "Дата");
  const planMe = columnWith(plan, planHeader.row, "ME");
  const eventRow = findRowBy(plan, { 1: "C-check", 2: "RA-123", [planDate]: "02.11.2026" });
  assert.equal(plan.getCell(eventRow, planMe).value, 5);
  const balanceDate = findRowBy(plan, { 1: "02.11.2026" }, planHeader.row + 1);
  const balanceHeader = balanceDate - 2;
  const balanceMe = columnWith(plan, balanceHeader, "ME");
  const demandFormula = formulaOf(plan.getCell(balanceDate, balanceMe));
  assert.match(demandFormula, /SUMIF\(/);
  const supplyFormula = formulaOf(plan.getCell(balanceDate, balanceMe + 1));
  assert.match(supplyFormula, /^'Доступный ресурс'![A-Z]+\d+$/);

  const chartHeader = findCell(chart, "Событие")!;
  const chartDay = columnWith(chart, chartHeader.row, "02.11");
  const chartDay2 = columnWith(chart, chartHeader.row, "03.11");
  const bar = findRowBy(chart, { 1: "RA-123", 3: "" });
  const fullTow = findRowBy(chart, { 1: "RA-999", 3: "" });
  assert.equal(chart.getCell(bar, chartDay).fill?.type, "pattern");
  assert.equal((chart.getCell(bar, chartDay).fill as ExcelJS.FillPattern).pattern, "lightTrellis");
  assert.match(noteOf(chart.getCell(bar, chartDay)), /Буксировка 09:00–10:00/);
  assert.equal((chart.getCell(fullTow, chartDay2).fill as ExcelJS.FillPattern).pattern, "solid");
  assert.equal((chart.getCell(fullTow, chartDay2).fill as ExcelJS.FillPattern).fgColor?.argb, "FFEF4444");

  const eventHours = findRowBy(chart, { 1: "RA-123", 3: "ME" });
  const eventFormula = formulaOf(chart.getCell(eventHours, chartDay));
  assert.match(eventFormula, /'План-Доступность'![A-Z]+\d+/);
  const demandRow = findRowBy(chart, { 1: "Итого потребность", 3: "ME" });
  const supplyRow = findRowBy(chart, { 1: "Итого доступный ресурс", 3: "ME" });
  const diffRow = findRowBy(chart, { 1: "Итого разница", 3: "ME" });
  assert.match(formulaOf(chart.getCell(demandRow, chartDay)), /'План-Доступность'!/);
  assert.match(formulaOf(chart.getCell(supplyRow, chartDay)), /'Доступный ресурс'!/);
  const diff = formulaOf(chart.getCell(diffRow, chartDay));
  assert.match(diff, /'Доступный ресурс'!/);
  assert.match(diff, /'План-Доступность'!/);
  assert.match(diff, /-/);
  const summary = findRowBy(chart, { 1: "ЦПТО3", 2: "A320" });
  assert.match(formulaOf(chart.getCell(summary, 3)), /SUMIFS\('План-Доступность'!/);
  assert.match(formulaOf(chart.getCell(summary, 4)), /'Доступный ресурс'!/);
  assert.equal(formulaOf(chart.getCell(summary, 5)), `${textAddress(4, summary)}-${textAddress(3, summary)}`);
});

function textAddress(col: number, row: number) {
  return `${String.fromCharCode(64 + col)}${row}`;
}

function findRowBy(ws: ExcelJS.Worksheet, expected: Record<number, string>, after = 0) {
  for (let row = after + 1; row <= ws.rowCount; row += 1) {
    const matches = Object.entries(expected).every(([col, value]) => textOf(ws.getCell(row, Number(col)).value) === value);
    if (matches) return row;
  }
  assert.fail(`row not found: ${JSON.stringify(expected)}`);
}
