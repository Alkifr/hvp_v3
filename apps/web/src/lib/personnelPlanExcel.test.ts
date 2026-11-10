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
    },
    {
      id: "e3",
      title: "Ночная",
      tail: "RA-777",
      hangarLabel: "Ангар 1",
      workshopId: "w1",
      workshop: "ЦПТО3",
      operator: "AFL",
      aircraftTypeId: "a320",
      aircraftType: "A320",
      stand: "7",
      status: "План",
      startAt: "2026-11-02T07:00:00Z",
      endAt: "2026-11-04T02:00:00Z",
      color: "#111827",
      towSegments: []
    },
    {
      id: "e4",
      title: "Late",
      tail: "RA-230",
      hangarLabel: "Ангар 1",
      workshopId: "w1",
      workshop: "ЦПТО3",
      operator: "AFL",
      aircraftTypeId: "a320",
      aircraftType: "A320",
      stand: "2",
      status: "План",
      startAt: "2026-11-03T19:00:00Z",
      endAt: "2026-11-03T20:59:00Z",
      color: "#0f766e",
      towSegments: []
    },
    {
      id: "e5",
      title: "Inbound",
      tail: "RA-100",
      hangarLabel: "Ангар 1",
      workshopId: "w1",
      workshop: "ЦПТО3",
      operator: "AFL",
      aircraftTypeId: "a320",
      aircraftType: "A320",
      stand: "1",
      status: "План",
      startAt: "2026-11-01T18:00:00Z",
      endAt: "2026-11-02T08:00:00Z",
      color: "#7c3aed",
      towSegments: []
    }
  ],
  departments: ["ME", "AV"],
  slices: [{ workshopId: "w1", workshop: "ЦПТО3", aircraftTypeId: "a320", aircraftType: "A320" }]
};

test("personnel plan workbook pulls chart values from the resource and plan sheets", () => {
  const wb = buildPersonnelPlanWorkbook(input);
  assert.deepEqual(wb.worksheets.map((sheet) => sheet.name), ["Chart", "Available resource", "Plan-Availability"]);

  const resource = wb.getWorksheet("Available resource")!;
  const plan = wb.getWorksheet("Plan-Availability")!;
  const chart = wb.getWorksheet("Chart")!;
  const headcountHeader = findCell(resource, "Qualification")!;
  const dayColumn = columnWith(resource, headcountHeader.row, "02.11");
  const b1 = findRowBy(resource, { 2: "B1", 4: "A320" });
  const lbmm = findRowBy(resource, { 2: "LBMM", 4: "A320" });
  const meSum = findRowBy(resource, { 2: "ME", 3: "ME", 4: "A320" });
  assert.equal(resource.getCell(b1, dayColumn).value, 2);
  assert.equal(resource.getCell(lbmm, dayColumn).value, 1);
  const meSumFormula = formulaOf(resource.getCell(meSum, dayColumn));
  assert.match(meSumFormula, new RegExp(`SUM\\([A-Z]+${b1}:[A-Z]+${lbmm}\\)`));

  const norm = findCell(resource, "Hour norm")!;
  const normColumn = columnWith(resource, norm.row - 1, "02.11");
  assert.equal(resource.getCell(norm.row, normColumn).value, 10);
  const hoursHeader = findCell(resource, "Category")!;
  const hoursDay = columnWith(resource, hoursHeader.row, "02.11");
  const meHours = findRowBy(resource, { 1: "ЦПТО3", 2: "ME", 3: "A320" }, hoursHeader.row);
  const meAllTypes = findRowBy(resource, { 1: "ЦПТО3", 2: "ME", 3: "All types" }, hoursHeader.row);
  const meAllShops = findRowBy(resource, { 1: "All shops", 2: "ME", 3: "All types" }, hoursHeader.row);
  const meHoursFormula = formulaOf(resource.getCell(meHours, hoursDay));
  assert.match(meHoursFormula, /N\([A-Z]+\d+\)/);
  assert.match(meHoursFormula, /\$[A-Z]+\$\d+/);
  assert.match(formulaOf(resource.getCell(meAllTypes, hoursDay)), new RegExp(String(meHours)));
  assert.match(formulaOf(resource.getCell(meAllShops, hoursDay)), /[A-Z]+\d+/);

  const planHeader = findCell(plan, "Event")!;
  const planDate = columnWith(plan, planHeader.row, "Date");
  const planMe = columnWith(plan, planHeader.row, "ME");
  const eventRow = findRowBy(plan, { 1: "C-check", 2: "RA-123", [planDate]: "02.11.2026" });
  assert.equal(plan.getCell(eventRow, planMe).value, 5);
  const balanceDate = findRowBy(plan, { 1: "02.11.2026" }, planHeader.row + 1);
  const balanceHeader = balanceDate - 2;
  const balanceMe = columnWith(plan, balanceHeader, "ME");
  const demandFormula = formulaOf(plan.getCell(balanceDate, balanceMe));
  assert.match(demandFormula, /SUMIF\(/);
  const supplyFormula = formulaOf(plan.getCell(balanceDate, balanceMe + 1));
  assert.match(supplyFormula, /^'Available resource'![A-Z]+\d+$/);

  const chartHeader = findCell(chart, "Tail")!;
  assert.equal(findCell(chart, "Operator")?.col, 2);
  assert.equal(findCell(chart, "Stand")?.col, 3);
  assert.equal(findCell(chart, "Category")?.col, 4);
  assert.equal(findCell(chart, "Status")?.col, 5);
  assert.equal(findCell(chart, "Title"), null);
  assert.equal(chart.getColumn(1).width, 9.29);
  assert.equal(chart.getColumn(2).width, 9.29);
  assert.equal(chart.getColumn(3).width, 9.29);
  const chartDay = columnWith(chart, chartHeader.row, "02.11");
  const chartDay2 = columnWith(chart, chartHeader.row, "03.11");
  assert.equal(chartDay2 - chartDay, 24);
  assert.equal(chart.getColumn(chartDay).width, 0.3);
  assert.equal(chart.getCell(chartHeader.row + 1, chartDay + 8).value, 8);
  assert.equal(chart.getCell(chartHeader.row + 1, chartDay + 10).font?.size, 5);
  const bar = findRowBy(chart, { 1: "RA-123", 2: "AFL", 4: "", 5: "В работе" });
  const fullTow = findRowBy(chart, { 1: "RA-999", 4: "" });
  assert.equal(textOf(chart.getCell(bar, chartDay).value), "08:00");
  assert.equal(chart.getCell(bar, chartDay).alignment?.horizontal, "left");
  assert.equal(chart.getCell(bar, chartDay + 8).isMerged, false);
  assert.equal(textOf(chart.getCell(bar, chartDay + 8).value), "   C-check");
  assert.equal(chart.getCell(bar, chartDay + 8).font?.color?.argb, "FF000000");
  assert.equal(chart.getCell(bar, chartDay + 8).alignment?.horizontal, "left");
  assert.equal((chart.getCell(bar, chartDay + 8).fill as ExcelJS.FillPattern).fgColor?.argb, "FF336699");
  assert.equal(chart.getCell(bar, chartDay + 8).border?.right?.color?.argb, "FF336699");
  assert.equal((chart.getCell(bar, chartDay + 9).fill as ExcelJS.FillPattern).fgColor?.argb, "FFEF4444");
  assert.equal(chart.getCell(bar, chartDay + 9).border?.left?.color?.argb, "FFEF4444");
  assert.match(noteOf(chart.getCell(bar, chartDay + 9)), /Tow 09:00–10:00/);
  assert.equal(textOf(chart.getCell(bar, chartDay2 + 18).value), "18:00");
  assert.equal(chart.getCell(bar, chartDay2 + 18).alignment?.horizontal, "left");
  assert.equal((chart.getCell(bar, chartDay2 + 18).fill as ExcelJS.FillPattern).fgColor?.argb, "FFFFFFFF");
  assert.equal(chart.getCell(bar, chartDay2 + 18).border?.left?.color?.argb, "FFFFFFFF");
  assert.equal(chart.getCell(bar, chartDay + 1).border?.right?.color?.argb, "FFFFFFFF");
  assert.equal(chart.getCell(fullTow, chartDay2 + 9).alignment?.horizontal, "left");
  assert.equal(chart.getCell(fullTow, chartDay2 + 9).font?.color?.argb, "FF000000");
  assert.equal(textOf(chart.getCell(fullTow, chartDay2 + 9).value), "   Выкатка");
  assert.equal(textOf(chart.getCell(fullTow, chartDay2 + 10).value), "10:00");
  assert.equal(chart.getCell(fullTow, chartDay2 + 9).isMerged, false);
  assert.equal((chart.getCell(fullTow, chartDay2 + 9).fill as ExcelJS.FillPattern).fgColor?.argb, "FFEF4444");
  const night = findRowBy(chart, { 1: "RA-777", 4: "" });
  assert.equal(textOf(chart.getCell(night, chartDay + 10).value), "   Ночная");
  const nightTill = columnWith(chart, night, "till 04.11.26 05:00");
  assert.ok(nightTill > chartDay + 10);
  assert.equal(textOf(chart.getCell(night, nightTill).value), "till 04.11.26 05:00");
  const inbound = findRowBy(chart, { 1: "RA-100", 4: "" });
  assert.equal(textOf(chart.getCell(inbound, chartDay).value), "from 01.11.26 21:00");
  assert.ok(columnWith(chart, inbound, "Inbound") > chartDay);
  const late = findRowBy(chart, { 1: "RA-230", 4: "" });
  assert.ok(textOf(chart.getCell(late, chartDay2 + 22).value).includes("Late"));
  assert.equal(columnWith(chart, late, "23:59"), chartDay2 + 23);

  const eventHours = findRowBy(chart, { 1: "RA-123", 4: "ME" });
  assert.equal(chart.getRow(eventHours).height, 10.5);
  assert.equal(chart.getCell(eventHours, 4).font?.size, 8);
  assert.equal(chart.getCell(eventHours, chartDay).font?.size, 8);
  assert.equal(chart.getCell(eventHours, 4).fill?.type, undefined);
  assert.equal(chart.getCell(eventHours, chartDay).fill?.type, undefined);
  const eventFormula = formulaOf(chart.getCell(eventHours, chartDay));
  assert.match(eventFormula, /'Plan-Availability'![A-Z]+\d+/);
  const demandRow = findRowBy(chart, { 1: "Total demand", 4: "ME" });
  const supplyRow = findRowBy(chart, { 1: "Total available", 4: "ME" });
  const diffRow = findRowBy(chart, { 1: "Total difference", 4: "ME" });
  assert.match(formulaOf(chart.getCell(demandRow, chartDay)), /'Plan-Availability'!/);
  assert.match(formulaOf(chart.getCell(supplyRow, chartDay)), /'Available resource'!/);
  const diff = formulaOf(chart.getCell(diffRow, chartDay));
  assert.match(diff, /'Available resource'!/);
  assert.match(diff, /'Plan-Availability'!/);
  assert.match(diff, /-/);
  const summary = findRowBy(chart, { 1: "ЦПТО3 · A320" });
  assert.match(formulaOf(chart.getCell(summary, 2)), /SUMIFS\('Plan-Availability'!/);
  assert.match(formulaOf(chart.getCell(summary, 3)), /'Available resource'!/);
  assert.equal(formulaOf(chart.getCell(summary, 4)), `${textAddress(3, summary)}-${textAddress(2, summary)}`);
  const hangar = findCell(chart, "Ангар 1")!;
  assert.equal((chart.getCell(hangar.row, chartDay).fill as ExcelJS.FillPattern).fgColor?.argb, "FFF97316");
  assert.equal(chart.getCell(hangar.row, chartDay2 + 23).master.address, chart.getCell(hangar.row, 1).address);
  assert.equal(chart.getCell(fullTow, chartDay).isMerged, false);
  assert.equal((chart.getCell(fullTow, chartDay).fill as ExcelJS.FillPattern).fgColor?.argb, "FFFFFFFF");
  assert.equal(chart.getCell(fullTow, chartDay).border?.right?.color?.argb, "FFFFFFFF");

  const week = buildPersonnelPlanWorkbook({ ...input, scale: "week" }).getWorksheet("Chart")!;
  const weekDate = findCell(week, "02.11")!;
  assert.equal(week.getCell(weekDate.row - 1, weekDate.col).value, "Monday");
  assert.equal(week.getCell(weekDate.row - 1, weekDate.col + 24).value, "Tuesday");
  assert.equal(week.getCell(weekDate.row, weekDate.col).value, "02.11");
  assert.equal(week.getColumn(weekDate.col).width, 1.08);
  const weekTow = findRowBy(week, { 1: "RA-999", 4: "" });
  assert.equal(week.getCell(weekTow, weekDate.col).isMerged, false);
  assert.equal((week.getCell(findCell(week, "Ангар 1")!.row, weekDate.col).fill as ExcelJS.FillPattern).fgColor?.argb, "FFF97316");
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
