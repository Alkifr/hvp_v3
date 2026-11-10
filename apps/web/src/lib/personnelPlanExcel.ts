import ExcelJS from "exceljs";
import dayjs from "dayjs";

const SHEET_CHART = "Chart";
const SHEET_RESOURCE = "Available resource";
const SHEET_PLAN = "Plan-Availability";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const HOURS_PER_DAY = 24;
const CATEGORY_ROW_HEIGHT = 10.5;
const LABEL_COLUMNS = 5;
const MONTH_HOUR_WIDTH = 0.3;
const WEEK_HOUR_WIDTH = 1.08;
const CLOCK_FONT = 12;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function columnWidthPx(pixels: number) {
  return Math.max(0.1, Math.round(((pixels - 5) / 7) * 100) / 100);
}

const PLAN_ORDER = ["ME", "AV", "INT", "NDT", "SHOP", "CAB_REP", "PAINT"] as const;
const HAIR = { style: "thin" as const, color: { argb: "FFE2E8F0" } };
const TOW_RED = "FFEF4444";

export type PersonnelPlanExcelInput = {
  from: string;
  to: string;
  scale?: "week" | "month";
  dates: string[];
  shifts: Array<{ id: string; code: string; name: string; startMin: number }>;
  sheets: Array<{
    workshopId: string;
    code: string;
    name: string;
    aircraftTypes: Array<{ id: string; name: string; icaoType?: string | null }>;
    categories: Array<{ code: string; department: string | null }>;
    items: Array<{ date: string; shiftId: string; aircraftTypeId: string; categoryCode: string; headcount: number }>;
  }>;
  days: Array<{
    date: string;
    normHours: number;
    eventDemand?: Array<{ id: string; byDepartment: Record<string, number> }>;
  }>;
  events: Array<{
    id: string;
    title: string;
    tail: string;
    hangarLabel: string;
    workshopId: string;
    workshop: string;
    operator: string;
    aircraftTypeId: string;
    aircraftType: string;
    stand: string;
    status: string;
    startAt: string;
    endAt: string;
    color: string;
    towSegments: Array<{ startAt: string; endAt: string }>;
  }>;
  departments: string[];
  slices: Array<{ workshopId: string; workshop: string; aircraftTypeId: string; aircraftType: string }>;
};

type ResourceRefs = {
  departmentDay: Map<string, string>;
  typePeriod: Map<string, string>;
  allTypesDay: Map<string, string>;
};

type PlanRefs = {
  eventCell: Map<string, string>;
  demandCell: Map<string, string>;
  workshopCol: number;
  typeCol: number;
  totalCol: number;
  firstRow: number;
  lastRow: number;
};

type ChartEvent = PersonnelPlanExcelInput["events"][number];

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

function localRef(col: number, row: number, absolute = false) {
  const letter = colLetter(col);
  return absolute ? `$${letter}$${row}` : `${letter}${row}`;
}

function externalRef(sheet: string, col: number, row: number) {
  return `'${sheet}'!${colLetter(col)}${row}`;
}

function formulaText(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function sumOf(refs: string[]) {
  if (!refs.length) return "0";
  if (refs.length === 1) return refs[0]!;
  return `SUM(${refs.join(",")})`;
}

function argb(color: string | null | undefined, fallback = "FF64748B") {
  const raw = String(color ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `FF${raw.toUpperCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(raw)) return raw.toUpperCase();
  return fallback;
}

function solid(argbColor: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: argbColor } };
}

function box(cell: ExcelJS.Cell) {
  cell.border = { top: HAIR, left: HAIR, bottom: HAIR, right: HAIR };
}

function put(cell: ExcelJS.Cell, value: ExcelJS.CellValue, options?: { fill?: string; bold?: boolean; numFmt?: string; align?: "center" | "left"; color?: string; size?: number; wrap?: boolean; note?: string }) {
  cell.value = value;
  box(cell);
  cell.alignment = { vertical: "middle", horizontal: options?.align ?? "left", wrapText: options?.wrap ?? false };
  cell.font = {
    bold: options?.bold ?? false,
    size: options?.size ?? 10,
    color: options?.color ? { argb: options.color } : undefined
  };
  if (options?.fill) cell.fill = solid(options.fill);
  if (options?.numFmt) cell.numFmt = options.numFmt;
  if (options?.note) cell.note = options.note;
}

function formula(cell: ExcelJS.Cell, expression: string, options?: { fill?: string; bold?: boolean; numFmt?: string; align?: "center" | "left"; size?: number }) {
  put(cell, { formula: expression }, { ...options, align: options?.align ?? "center", numFmt: options?.numFmt ?? "0.0" });
}

function shiftLabel(shift: { code: string; name: string; startMin: number }) {
  const code = shift.code.toUpperCase();
  if (code === "DAY" || code.includes("ДЕН")) return "D";
  if (code === "NIGHT" || code.includes("НОЧ") || code.includes("EVE")) return "N";
  return shift.startMin >= 18 * 60 ? "N" : shift.startMin <= 10 * 60 ? "D" : shift.name;
}

function moscowDate(value: string) {
  return new Date(new Date(value).getTime() + 180 * 60_000);
}

function fmtClock(value: string) {
  const date = moscowDate(value);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function fmtEdge(prefix: "from" | "till", value: string) {
  const date = moscowDate(value);
  return `${prefix} ${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCFullYear()).slice(2)} ${fmtClock(value)}`;
}

function fmtDayMonth(value: string) {
  const [, month, day] = value.split("-");
  return day && month ? `${day}.${month}` : value;
}

function weekdayName(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1)).getUTCDay()] ?? "";
}

function fmtShort(value: string) {
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}.${month}.${year}` : value;
}

function dayStart(date: string) {
  return new Date(`${date}T00:00:00+03:00`).getTime();
}

function overlap(a0: number, a1: number, b0: number, b1: number) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function visibleDepartments(departments: string[]) {
  const active = new Set(departments);
  return PLAN_ORDER.filter((department) => active.has(department));
}

function typeLabel(type: { name: string; icaoType?: string | null }) {
  return type.icaoType || type.name;
}

function sheetTitle(sheet: { code: string; name: string }) {
  return sheet.name && sheet.name !== sheet.code ? `${sheet.code} · ${sheet.name}` : (sheet.code || "Shop");
}

function fit(ws: ExcelJS.Worksheet) {
  ws.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
  };
}

function setOrder(ws: ExcelJS.Worksheet, orderNo: number) {
  (ws as ExcelJS.Worksheet & { orderNo: number }).orderNo = orderNo;
}

function titleBlock(ws: ExcelJS.Worksheet, title: string, note: string, width: number) {
  const last = Math.max(width, 6);
  ws.mergeCells(1, 1, 1, last);
  ws.mergeCells(2, 1, 2, last);
  put(ws.getCell(1, 1), title, { bold: true, size: 14, fill: "FFF8FAFC" });
  put(ws.getCell(2, 1), note, { color: "FF64748B", wrap: true, size: 10 });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 36;
  return 4;
}

function headcountOf(sheet: PersonnelPlanExcelInput["sheets"][number], typeId: string, code: string, date: string, shiftId: string) {
  return sheet.items.reduce((sum, item) => (
    item.aircraftTypeId === typeId && item.categoryCode === code && item.date === date && item.shiftId === shiftId
      ? sum + item.headcount
      : sum
  ), 0);
}

function towOnInterval(event: ChartEvent, from: number, to: number) {
  const eventStart = new Date(event.startAt).getTime();
  const eventEnd = new Date(event.endAt).getTime();
  const eventOn = overlap(eventStart, eventEnd, from, to);
  if (eventOn <= 0) return { kind: "none" as const, note: "" };
  let covered = 0;
  const labels: string[] = [];
  for (const tow of event.towSegments) {
    const towStart = Math.max(new Date(tow.startAt).getTime(), eventStart);
    const towEnd = Math.min(new Date(tow.endAt).getTime(), eventEnd);
    const hit = overlap(towStart, towEnd, from, to);
    if (hit <= 0) continue;
    covered += hit;
    labels.push(`${fmtClock(tow.startAt)}–${fmtClock(tow.endAt)}`);
  }
  if (covered <= 0) return { kind: "none" as const, note: "" };
  return { kind: "full" as const, note: `Tow ${labels.join("; ")}` };
}

function sortedEvents(events: ChartEvent[]) {
  const hangarKey = (label: string) => (label === "Без ангара" ? "\uffff" : label);
  return [...events].sort((a, b) => (
    hangarKey(a.hangarLabel).localeCompare(hangarKey(b.hangarLabel), "ru", { numeric: true })
    || a.workshop.localeCompare(b.workshop, "ru", { numeric: true })
    || a.operator.localeCompare(b.operator, "ru", { numeric: true })
    || a.aircraftType.localeCompare(b.aircraftType, "ru", { numeric: true })
    || a.tail.localeCompare(b.tail, "ru", { numeric: true })
    || a.title.localeCompare(b.title, "ru")
  ));
}

function buildResourceSheet(wb: ExcelJS.Workbook, input: PersonnelPlanExcelInput, departments: string[]): ResourceRefs {
  const ws = wb.addWorksheet(SHEET_RESOURCE);
  const shifts = input.shifts;
  const dates = input.dates;
  const shiftCount = Math.max(shifts.length, 1);
  const gridLast = 4 + dates.length * shiftCount;
  let row = titleBlock(
    ws,
    `Available resource · ${fmtShort(input.from)} – ${fmtShort(input.to)}`,
    "Headcount is the source number of people by qualification, aircraft type and shift. A category row sums its qualifications. Category hours = that sum across types and shifts × the day's hour norm. Shop and aircraft-type hours sum every qualification.",
    gridLast
  );
  const headerRow = row;
  const shiftRow = row + 1;
  for (const [col, label] of ["Shop", "Qualification", "Department", "Aircraft type"].entries()) {
    ws.mergeCells(headerRow, col + 1, shiftRow, col + 1);
    put(ws.getCell(headerRow, col + 1), label, { bold: true, fill: "FFE2E8F0", align: "center" });
    box(ws.getCell(shiftRow, col + 1));
    ws.getCell(shiftRow, col + 1).fill = solid("FFE2E8F0");
  }
  dates.forEach((date, dateIndex) => {
    const start = 5 + dateIndex * shiftCount;
    const end = start + shiftCount - 1;
    if (end > start) ws.mergeCells(headerRow, start, headerRow, end);
    put(ws.getCell(headerRow, start), fmtDayMonth(date), { bold: true, fill: "FFE2E8F0", align: "center" });
    for (let shiftIndex = 0; shiftIndex < shiftCount; shiftIndex += 1) {
      const column = start + shiftIndex;
      if (column !== start) {
        box(ws.getCell(headerRow, column));
        ws.getCell(headerRow, column).fill = solid("FFE2E8F0");
      }
      put(ws.getCell(shiftRow, column), shifts[shiftIndex] ? shiftLabel(shifts[shiftIndex]!) : "—", { bold: true, fill: "FFF8FAFC", align: "center" });
    }
  });
  row = shiftRow + 1;

  const categorySumCell = new Map<string, string>();
  const typeTotalCell = new Map<string, string>();

  const writeHeadcountRow = (workshop: string, qual: string, department: string, type: string, fillColor?: string, bold = false) => {
    put(ws.getCell(row, 1), workshop, { fill: fillColor, bold });
    put(ws.getCell(row, 2), qual, { fill: fillColor, bold });
    put(ws.getCell(row, 3), department, { fill: fillColor, bold });
    put(ws.getCell(row, 4), type, { fill: fillColor, bold });
  };

  for (const sheet of input.sheets) {
    put(ws.getCell(row, 1), sheetTitle(sheet), { bold: true, color: "FFF8FAFC", fill: "FF1E293B" });
    ws.mergeCells(row, 1, row, gridLast);
    for (let col = 2; col <= gridLast; col += 1) {
      box(ws.getCell(row, col));
      ws.getCell(row, col).fill = solid("FF1E293B");
    }
    row += 1;
    if (!sheet.categories.length) {
      put(ws.getCell(row, 1), "No qualifications are assigned to the shop.", { fill: "FFFFF7ED", color: "FF9A3412" });
      ws.mergeCells(row, 1, row, gridLast);
      row += 1;
      continue;
    }
    if (!sheet.aircraftTypes.length) {
      put(ws.getCell(row, 1), "The shop has no headcount rows for the selected aircraft types.", { fill: "FFFFF7ED", color: "FF9A3412" });
      ws.mergeCells(row, 1, row, gridLast);
      row += 1;
      continue;
    }
    const departmentsInSheet: string[] = [];
    for (const category of sheet.categories) {
      if (category.department && !departmentsInSheet.includes(category.department)) departmentsInSheet.push(category.department);
    }
    const typeTotalRows: number[] = [];
    for (const type of sheet.aircraftTypes) {
      const label = typeLabel(type);
      const inputRefs = new Map<string, string[]>();
      for (const department of departmentsInSheet) {
        const group = sheet.categories.filter((category) => category.department === department);
        const first = row;
        for (const category of group) {
          writeHeadcountRow(sheet.code, category.code, department, label);
          dates.forEach((date, dateIndex) => {
            shifts.forEach((shift, shiftIndex) => {
              const column = 5 + dateIndex * shiftCount + shiftIndex;
              const count = headcountOf(sheet, type.id, category.code, date, shift.id);
              put(ws.getCell(row, column), count > 0 ? count : "", { align: "center", numFmt: "0" });
            });
          });
          for (const key of dates.flatMap((date, dateIndex) => shifts.map((shift, shiftIndex) => {
            const column = 5 + dateIndex * shiftCount + shiftIndex;
            return { key: `${date}|${shift.id}`, ref: localRef(column, row) };
          }))) {
            inputRefs.set(key.key, [...(inputRefs.get(key.key) ?? []), key.ref]);
          }
          row += 1;
        }
        const last = row - 1;
        writeHeadcountRow(sheet.code, department, department, label, "FFF8FAFC", true);
        dates.forEach((date, dateIndex) => {
          shifts.forEach((shift, shiftIndex) => {
            const column = 5 + dateIndex * shiftCount + shiftIndex;
            const range = `${localRef(column, first)}:${localRef(column, last)}`;
            formula(ws.getCell(row, column), `IF(COUNT(${range})=0,"",SUM(${range}))`, { fill: "FFF8FAFC", bold: true, numFmt: "0" });
            categorySumCell.set(`${sheet.workshopId}|${department}|${type.id}|${date}|${shift.id}`, localRef(column, row));
          });
        });
        row += 1;
      }
      const bare = sheet.categories.filter((category) => !category.department);
      for (const category of bare) {
        writeHeadcountRow(sheet.code, category.code, "—", label);
        dates.forEach((date, dateIndex) => {
          shifts.forEach((shift, shiftIndex) => {
            const column = 5 + dateIndex * shiftCount + shiftIndex;
            const count = headcountOf(sheet, type.id, category.code, date, shift.id);
            put(ws.getCell(row, column), count > 0 ? count : "", { align: "center", numFmt: "0" });
            const key = `${date}|${shift.id}`;
            inputRefs.set(key, [...(inputRefs.get(key) ?? []), localRef(column, row)]);
          });
        });
        row += 1;
      }
      writeHeadcountRow(sheet.code, "Total", "headcount", label, "FFE2E8F0", true);
      dates.forEach((date, dateIndex) => {
        shifts.forEach((shift, shiftIndex) => {
          const column = 5 + dateIndex * shiftCount + shiftIndex;
          const refs = inputRefs.get(`${date}|${shift.id}`) ?? [];
          formula(ws.getCell(row, column), refs.length ? `IF(COUNT(${refs.join(",")})=0,"",SUM(${refs.join(",")}))` : "0", { fill: "FFE2E8F0", bold: true, numFmt: "0" });
          typeTotalCell.set(`${sheet.workshopId}|${type.id}|${date}|${shift.id}`, localRef(column, row));
        });
      });
      typeTotalRows.push(row);
      row += 1;
    }
    writeHeadcountRow(sheet.code, "Total", "all aircraft types", "All", "FFCBD5E1", true);
    dates.forEach((date, dateIndex) => {
      shifts.forEach((shift, shiftIndex) => {
        const column = 5 + dateIndex * shiftCount + shiftIndex;
        const refs = typeTotalRows.map((totalRow) => localRef(column, totalRow));
        formula(ws.getCell(row, column), refs.length ? `IF(COUNT(${refs.join(",")})=0,"",SUM(${refs.join(",")}))` : "0", { fill: "FFCBD5E1", bold: true, numFmt: "0" });
      });
    });
    row += 1;
  }

  row += 1;
  put(ws.getCell(row, 1), "Hour norm", { bold: true, fill: "FFFFFBEB" });
  const normRow = row;
  const normCell = new Map<string, string>();
  dates.forEach((date, index) => {
    const column = 2 + index;
    put(ws.getCell(normRow - 1, column), fmtDayMonth(date), { bold: true, fill: "FFFFFBEB", align: "center" });
    const norm = input.days.find((day) => day.date.slice(0, 10) === date)?.normHours ?? 0;
    put(ws.getCell(normRow, column), norm, { fill: "FFFFFBEB", align: "center", numFmt: "0.0", bold: true });
    normCell.set(date, localRef(column, normRow, true));
  });
  row += 2;

  put(ws.getCell(row, 1), "Available hours by category", { bold: true, size: 12 });
  ws.mergeCells(row, 1, row, 3 + dates.length);
  row += 1;
  ["Shop", "Category", "Aircraft type"].forEach((label, index) => put(ws.getCell(row, index + 1), label, { bold: true, fill: "FFE2E8F0", align: "center" }));
  dates.forEach((date, index) => put(ws.getCell(row, 4 + index), fmtDayMonth(date), { bold: true, fill: "FFE2E8F0", align: "center" }));
  const periodColumn = 4 + dates.length;
  put(ws.getCell(row, periodColumn), "Total", { bold: true, fill: "FFE2E8F0", align: "center" });
  row += 1;

  const workshopDepartmentDay = new Map<string, string>();
  for (const sheet of input.sheets) {
    for (const department of departments) {
      const hasDepartment = sheet.categories.some((category) => category.department === department);
      if (!hasDepartment || !sheet.aircraftTypes.length) continue;
      const first = row;
      for (const type of sheet.aircraftTypes) {
        put(ws.getCell(row, 1), sheet.code, { fill: "FFEFF6FF" });
        put(ws.getCell(row, 2), department, { fill: "FFEFF6FF", bold: true });
        put(ws.getCell(row, 3), typeLabel(type), { fill: "FFEFF6FF" });
        dates.forEach((date, index) => {
          const cells = shifts.map((shift) => categorySumCell.get(`${sheet.workshopId}|${department}|${type.id}|${date}|${shift.id}`)).filter((ref): ref is string => Boolean(ref));
          const factor = normCell.get(date) ?? "0";
          formula(ws.getCell(row, 4 + index), cells.length ? `(${cells.map((ref) => `N(${ref})`).join("+")})*${factor}` : "0", { fill: "FFEFF6FF" });
        });
        formula(ws.getCell(row, periodColumn), `SUM(${localRef(4, row)}:${localRef(3 + dates.length, row)})`, { fill: "FFEFF6FF", bold: true });
        row += 1;
      }
      const last = row - 1;
      put(ws.getCell(row, 1), sheet.code, { fill: "FFDBEAFE", bold: true });
      put(ws.getCell(row, 2), department, { fill: "FFDBEAFE", bold: true });
      put(ws.getCell(row, 3), "All types", { fill: "FFDBEAFE", bold: true });
      dates.forEach((date, index) => {
        const column = 4 + index;
        formula(ws.getCell(row, column), first <= last ? `SUM(${localRef(column, first)}:${localRef(column, last)})` : "0", { fill: "FFDBEAFE", bold: true });
        workshopDepartmentDay.set(`${sheet.workshopId}|${department}|${date}`, localRef(column, row));
      });
      formula(ws.getCell(row, periodColumn), `SUM(${localRef(4, row)}:${localRef(3 + dates.length, row)})`, { fill: "FFDBEAFE", bold: true });
      row += 1;
    }
  }

  const departmentDay = new Map<string, string>();
  for (const department of departments) {
    put(ws.getCell(row, 1), "All shops", { fill: "FFBFDBFE", bold: true });
    put(ws.getCell(row, 2), department, { fill: "FFBFDBFE", bold: true });
    put(ws.getCell(row, 3), "All types", { fill: "FFBFDBFE", bold: true });
    dates.forEach((date, index) => {
      const column = 4 + index;
      const refs = input.sheets.flatMap((sheet) => {
        const ref = workshopDepartmentDay.get(`${sheet.workshopId}|${department}|${date}`);
        return ref ? [ref] : [];
      });
      formula(ws.getCell(row, column), sumOf(refs), { fill: "FFBFDBFE", bold: true });
      departmentDay.set(`${department}|${date}`, externalRef(SHEET_RESOURCE, column, row));
    });
    formula(ws.getCell(row, periodColumn), `SUM(${localRef(4, row)}:${localRef(3 + dates.length, row)})`, { fill: "FFBFDBFE", bold: true });
    row += 1;
  }

  row += 1;
  put(ws.getCell(row, 1), "Available hours by shop and aircraft type", { bold: true, size: 12 });
  ws.mergeCells(row, 1, row, 2 + dates.length);
  row += 1;
  ["Shop", "Aircraft type"].forEach((label, index) => put(ws.getCell(row, index + 1), label, { bold: true, fill: "FFE2E8F0", align: "center" }));
  dates.forEach((date, index) => put(ws.getCell(row, 3 + index), fmtDayMonth(date), { bold: true, fill: "FFE2E8F0", align: "center" }));
  const typePeriodColumn = 3 + dates.length;
  put(ws.getCell(row, typePeriodColumn), "Total", { bold: true, fill: "FFE2E8F0", align: "center" });
  row += 1;

  const typePeriod = new Map<string, string>();
  const typeRows: number[] = [];
  for (const sheet of input.sheets) {
    for (const type of sheet.aircraftTypes) {
      put(ws.getCell(row, 1), sheet.code, { fill: "FFEFF6FF" });
      put(ws.getCell(row, 2), typeLabel(type), { fill: "FFEFF6FF" });
      dates.forEach((date, index) => {
        const cells = shifts.map((shift) => typeTotalCell.get(`${sheet.workshopId}|${type.id}|${date}|${shift.id}`)).filter((ref): ref is string => Boolean(ref));
        const factor = normCell.get(date) ?? "0";
        formula(ws.getCell(row, 3 + index), cells.length ? `(${cells.map((ref) => `N(${ref})`).join("+")})*${factor}` : "0", { fill: "FFEFF6FF" });
      });
      formula(ws.getCell(row, typePeriodColumn), `SUM(${localRef(3, row)}:${localRef(2 + dates.length, row)})`, { fill: "FFEFF6FF", bold: true });
      typePeriod.set(`${sheet.workshopId}|${type.id}`, externalRef(SHEET_RESOURCE, typePeriodColumn, row));
      typeRows.push(row);
      row += 1;
    }
  }
  put(ws.getCell(row, 1), "All shops", { fill: "FFBFDBFE", bold: true });
  put(ws.getCell(row, 2), "All types", { fill: "FFBFDBFE", bold: true });
  const allTypesDay = new Map<string, string>();
  dates.forEach((date, index) => {
    const column = 3 + index;
    const refs = typeRows.map((typeRow) => localRef(column, typeRow));
    formula(ws.getCell(row, column), sumOf(refs), { fill: "FFBFDBFE", bold: true });
    allTypesDay.set(date, externalRef(SHEET_RESOURCE, column, row));
  });
  formula(ws.getCell(row, typePeriodColumn), `SUM(${localRef(3, row)}:${localRef(2 + dates.length, row)})`, { fill: "FFBFDBFE", bold: true });

  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;
  for (let col = 5; col <= Math.max(gridLast, typePeriodColumn, periodColumn); col += 1) ws.getColumn(col).width = 8;
  ws.views = [{ state: "frozen", xSplit: 4, ySplit: shiftRow }];
  ws.properties.tabColor = { argb: "FF2563EB" };
  fit(ws);
  return { departmentDay, typePeriod, allTypesDay };
}

function buildPlanSheet(wb: ExcelJS.Workbook, input: PersonnelPlanExcelInput, departments: string[], resource: ResourceRefs): PlanRefs {
  const ws = wb.addWorksheet(SHEET_PLAN);
  const dates = input.dates;
  const events = sortedEvents(input.events);
  const lastCol = 5 + departments.length + 1;
  let row = titleBlock(
    ws,
    `Plan/Availability · ${fmtShort(input.from)} – ${fmtShort(input.to)}`,
    "Event hours are the planned workload of the day. Daily demand sums the events. Availability is a formula from the Available resource sheet. Difference = availability − demand.",
    lastCol
  );
  const headerRow = row;
  ["Event", "Tail", "Shop", "Aircraft type", "Date"].forEach((label, index) => put(ws.getCell(headerRow, index + 1), label, { bold: true, fill: "FFE2E8F0", align: "center" }));
  departments.forEach((department, index) => put(ws.getCell(headerRow, 6 + index), department, { bold: true, fill: "FFE2E8F0", align: "center" }));
  const totalCol = 6 + departments.length;
  put(ws.getCell(headerRow, totalCol), "Total", { bold: true, fill: "FFE2E8F0", align: "center" });
  row += 1;
  const firstRow = row;
  const demand = new Map<string, number>();
  for (const day of input.days) {
    const date = day.date.slice(0, 10);
    for (const event of day.eventDemand ?? []) {
      for (const department of departments) demand.set(`${event.id}|${date}|${department}`, Number(event.byDepartment?.[department] ?? 0) || 0);
    }
  }
  const eventCell = new Map<string, string>();
  for (const event of events) {
    for (const date of dates) {
      put(ws.getCell(row, 1), event.title);
      put(ws.getCell(row, 2), event.tail);
      put(ws.getCell(row, 3), event.workshop);
      put(ws.getCell(row, 4), event.aircraftType);
      put(ws.getCell(row, 5), fmtShort(date), { align: "center" });
      departments.forEach((department, index) => {
        const column = 6 + index;
        const hours = demand.get(`${event.id}|${date}|${department}`) ?? 0;
        put(ws.getCell(row, column), hours, { align: "center", numFmt: "0.0" });
        eventCell.set(`${event.id}|${date}|${department}`, externalRef(SHEET_PLAN, column, row));
      });
      formula(ws.getCell(row, totalCol), departments.length ? `SUM(${localRef(6, row)}:${localRef(5 + departments.length, row)})` : "0");
      row += 1;
    }
  }
  const lastRow = Math.max(firstRow, row - 1);
  if (!events.length) {
    put(ws.getCell(row, 1), "No events in the selected period.");
    ws.mergeCells(row, 1, row, lastCol);
    row += 1;
  }
  if (events.length) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastRow, column: totalCol } };
  }

  row += 1;
  put(ws.getCell(row, 1), "Daily balance", { bold: true, size: 12 });
  row += 1;
  const balanceHeader = row;
  put(ws.getCell(balanceHeader, 1), "Date", { bold: true, fill: "FFE2E8F0", align: "center" });
  ["Demand", "Supply", "Diff"].forEach((label, index) => put(ws.getCell(balanceHeader, 2 + index), label, { bold: true, fill: "FFE2E8F0", align: "center" }));
  ws.mergeCells(balanceHeader, 1, balanceHeader + 1, 1);
  for (let col = 2; col <= 4; col += 1) ws.mergeCells(balanceHeader, col, balanceHeader + 1, col);
  departments.forEach((department, index) => {
    const start = 5 + index * 3;
    ws.mergeCells(balanceHeader, start, balanceHeader, start + 2);
    put(ws.getCell(balanceHeader, start), department, { bold: true, fill: "FFE2E8F0", align: "center" });
    box(ws.getCell(balanceHeader, start + 1));
    box(ws.getCell(balanceHeader, start + 2));
    ws.getCell(balanceHeader, start + 1).fill = solid("FFE2E8F0");
    ws.getCell(balanceHeader, start + 2).fill = solid("FFE2E8F0");
  });
  row += 1;
  departments.forEach((_, departmentIndex) => {
    ["Demand", "Supply", "Diff"].forEach((label, index) => put(ws.getCell(row, 5 + departmentIndex * 3 + index), label, { bold: true, fill: "FFF8FAFC", align: "center", size: 9 }));
  });
  row += 1;
  const demandCell = new Map<string, string>();
  for (const date of dates) {
    put(ws.getCell(row, 1), fmtShort(date), { bold: true, align: "center" });
    const departmentPlan: string[] = [];
    departments.forEach((department, index) => {
      const planColumn = 5 + index * 3;
      const supplyColumn = planColumn + 1;
      const diffColumn = planColumn + 2;
      const planFormula = events.length
        ? `SUMIF($${colLetter(5)}$${firstRow}:$${colLetter(5)}$${lastRow},${localRef(1, row)},${colLetter(6 + index)}$${firstRow}:${colLetter(6 + index)}$${lastRow})`
        : "0";
      formula(ws.getCell(row, planColumn), planFormula, { fill: "FFFFF7ED" });
      const supply = resource.departmentDay.get(`${department}|${date}`) ?? "0";
      formula(ws.getCell(row, supplyColumn), supply, { fill: "FFEFF6FF" });
      formula(ws.getCell(row, diffColumn), `${localRef(supplyColumn, row)}-${localRef(planColumn, row)}`, { fill: "FFF0FDF4" });
      departmentPlan.push(localRef(planColumn, row));
      demandCell.set(`${department}|${date}`, externalRef(SHEET_PLAN, planColumn, row));
    });
    formula(ws.getCell(row, 2), sumOf(departmentPlan), { fill: "FFFFF7ED", bold: true });
    formula(ws.getCell(row, 3), resource.allTypesDay.get(date) ?? "0", { fill: "FFEFF6FF", bold: true });
    formula(ws.getCell(row, 4), `${localRef(3, row)}-${localRef(2, row)}`, { fill: "FFF0FDF4", bold: true });
    row += 1;
  }

  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;
  ws.getColumn(5).width = 14;
  for (let col = 6; col <= Math.max(lastCol, 4 + departments.length * 3); col += 1) ws.getColumn(col).width = 10;
  ws.views = [{ state: "frozen", xSplit: 5, ySplit: headerRow }];
  ws.properties.tabColor = { argb: "FF16A34A" };
  fit(ws);
  return { eventCell, demandCell, workshopCol: 3, typeCol: 4, totalCol, firstRow, lastRow };
}

function buildChartSheet(wb: ExcelJS.Workbook, input: PersonnelPlanExcelInput, departments: string[], resource: ResourceRefs, plan: PlanRefs) {
  const ws = wb.addWorksheet(SHEET_CHART);
  const dates = input.dates;
  const scale = input.scale === "week" ? "week" : "month";
  const hourWidth = scale === "week" ? WEEK_HOUR_WIDTH : MONTH_HOUR_WIDTH;
  const dayCount = Math.max(dates.length, 1);
  const lastCol = LABEL_COLUMNS + dayCount * HOURS_PER_DAY;
  const dayColumn = (dateIndex: number, hour = 0) => LABEL_COLUMNS + 1 + dateIndex * HOURS_PER_DAY + hour;
  const timelineStart = dayColumn(0);
  const timelineEnd = dayColumn(Math.max(dates.length, 1) - 1, HOURS_PER_DAY - 1);
  const paintDay = (dateRow: number, index: number, text: string) => {
    const start = dayColumn(index);
    const end = start + HOURS_PER_DAY - 1;
    put(ws.getCell(dateRow, start), text, { bold: true, fill: "FFE2E8F0", align: "center" });
    ws.mergeCells(dateRow, start, dateRow, end);
    for (let col = start; col <= end; col += 1) {
      box(ws.getCell(dateRow, col));
      ws.getCell(dateRow, col).fill = solid("FFE2E8F0");
    }
  };
  let row = titleBlock(
    ws,
    `Chart/Plan · ${scale === "week" ? "Week" : "Month"} · ${fmtShort(input.from)} – ${fmtShort(input.to)}`,
    scale === "week"
      ? "Week view: weekday above the date. Each tail is its own row. Status stands after Category. Hour columns are about 8 pixels. Hour cells are not merged: the fill stays, and each border uses the fill color. Empty hours have white borders. The orange band separates hangars."
      : "Month view: each day is 24 columns of about 2 pixels. Each tail is its own row. Status stands after Category. Hour cells are not merged: the fill stays, and each border uses the fill color. Empty hours have white borders. The orange band separates hangars.",
    lastCol
  );
  const labelTop = row;
  if (scale === "week") {
    dates.forEach((date, index) => paintDay(row, index, weekdayName(date)));
    row += 1;
  }
  ["Tail", "Operator", "Stand", "Category", "Status"].forEach((label, index) => put(ws.getCell(labelTop, index + 1), label, { bold: true, fill: "FFE2E8F0", align: "center" }));
  const headerRow = row;
  dates.forEach((date, index) => paintDay(headerRow, index, fmtDayMonth(date)));
  row += 1;
  const hourRow = row;
  for (let col = 1; col <= LABEL_COLUMNS; col += 1) {
    box(ws.getCell(hourRow, col));
    ws.getCell(hourRow, col).fill = solid("FFE2E8F0");
    if (labelTop < headerRow) {
      box(ws.getCell(labelTop, col));
      ws.getCell(labelTop, col).fill = solid("FFE2E8F0");
    }
    ws.mergeCells(labelTop, col, hourRow, col);
  }
  for (let index = 0; index < dayCount; index += 1) {
    if (!dates[index]) continue;
    for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
      put(ws.getCell(hourRow, dayColumn(index, hour)), hour, { align: "center", size: 5, fill: "FFF8FAFC" });
    }
  }
  row += 1;
  const periodStart = dayStart(input.from);
  const periodEnd = dayStart(input.to) + DAY_MS;
  const events = sortedEvents(input.events);
  const groups: Array<{ hangarLabel: string; events: ChartEvent[] }> = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (!last || last.hangarLabel !== event.hangarLabel) groups.push({ hangarLabel: event.hangarLabel, events: [event] });
    else last.events.push(event);
  }
  const diffRefs: string[] = [];
  for (const group of groups) {
    put(ws.getCell(row, 1), group.hangarLabel === "Без ангара" ? "No hangar" : group.hangarLabel, { bold: true, color: "FF431407", fill: "FFF97316" });
    for (let col = 2; col <= lastCol; col += 1) {
      box(ws.getCell(row, col));
      ws.getCell(row, col).fill = solid("FFF97316");
    }
    ws.mergeCells(row, 1, row, lastCol);
    row += 1;
    for (const event of group.events) {
      const eventStart = new Date(event.startAt).getTime();
      const eventEnd = new Date(event.endAt).getTime();
      put(ws.getCell(row, 1), event.tail, { bold: true });
      put(ws.getCell(row, 2), event.operator, { bold: true });
      put(ws.getCell(row, 3), event.stand);
      put(ws.getCell(row, 4), "");
      put(ws.getCell(row, 5), event.status);
      const eventColor = argb(event.color);
      const occupied = new Set<number>();
      const slots: number[] = [];
      dates.forEach((date, index) => {
        const day0 = dayStart(date);
        for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
          const hour0 = day0 + hour * HOUR_MS;
          const hour1 = hour0 + HOUR_MS;
          const column = dayColumn(index, hour);
          if (overlap(eventStart, eventEnd, hour0, hour1) <= 0) continue;
          const cell = ws.getCell(row, column);
          const tow = towOnInterval(event, hour0, hour1);
          const fill = tow.kind === "full" ? TOW_RED : eventColor;
          cell.fill = solid(fill);
          const edge = { style: "thin" as const, color: { argb: fill } };
          cell.border = { top: edge, left: edge, bottom: edge, right: edge };
          if (tow.note) cell.note = tow.note;
          occupied.add(column);
          slots.push(column);
        }
      });
      if (slots.length) {
        const first = slots[0]!;
        const last = slots[slots.length - 1]!;
        const startsBefore = eventStart < periodStart;
        const endsAfter = eventEnd > periodEnd;
        const columnsFor = (text: string) => Math.max(1, Math.ceil(text.length / Math.max(hourWidth, 0.1)));
        const paintText = (column: number, text: string, allowOccupied = false) => {
          if (!allowOccupied && occupied.has(column)) return;
          const cell = ws.getCell(row, column);
          if (cell.value) return;
          cell.value = text;
          cell.font = { bold: true, size: CLOCK_FONT, color: { argb: "FF000000" }, name: "Calibri" };
          cell.alignment = { vertical: "middle", horizontal: "left", wrapText: false, shrinkToFit: false };
        };
        if (!startsBefore && first > timelineStart) {
          const clock = fmtClock(event.startAt);
          paintText(Math.max(timelineStart, first - columnsFor(clock)), clock);
        }
        const fromText = startsBefore ? fmtEdge("from", event.startAt) : "";
        const endText = endsAfter ? fmtEdge("till", event.endAt) : fmtClock(event.endAt);
        const outsideEnd = last + 1 <= timelineEnd;
        const endReserve = outsideEnd ? 0 : Math.min(columnsFor(endText), Math.max(1, last - first));
        const endCol = outsideEnd ? last + 1 : Math.max(first + 1, last - endReserve + 1);
        const fromReserve = fromText ? Math.min(columnsFor(fromText), Math.max(0, endCol - first - 1)) : 0;
        const titleCol = Math.min(Math.max(first, first + fromReserve), Math.max(first, endCol - 1));
        const titleText = `${fromReserve > 0 ? "" : "   "}${event.title}`;
        if (fromText && titleCol > first) paintText(first, fromText, true);
        paintText(titleCol, titleCol === first && fromText ? `${fromText} ${titleText.trimStart()}` : titleText, true);
        if (endCol !== titleCol) paintText(endCol, endText, !outsideEnd);
      }
      const whiteEdge = { style: "thin" as const, color: { argb: "FFFFFFFF" } };
      for (let column = timelineStart; column <= timelineEnd; column += 1) {
        if (occupied.has(column)) continue;
        const cell = ws.getCell(row, column);
        cell.fill = solid("FFFFFFFF");
        cell.border = { top: whiteEdge, left: whiteEdge, bottom: whiteEdge, right: whiteEdge };
      }
      ws.getRow(row).height = 22;
      row += 1;
      for (const department of departments) {
        put(ws.getCell(row, 1), event.tail, { color: "FF64748B", size: 8 });
        put(ws.getCell(row, 2), event.operator, { color: "FF64748B", size: 8 });
        put(ws.getCell(row, 3), event.stand, { color: "FF64748B", size: 8 });
        put(ws.getCell(row, 4), department, { align: "center", bold: true, size: 8 });
        put(ws.getCell(row, 5), event.status, { color: "FF64748B", size: 8 });
        dates.forEach((date, index) => {
          const source = plan.eventCell.get(`${event.id}|${date}|${department}`);
          const start = dayColumn(index);
          formula(ws.getCell(row, start), source ? `IF(ABS(${source})<0.0001,"",${source})` : "0", { size: 8 });
          ws.mergeCells(row, start, row, start + HOURS_PER_DAY - 1);
          for (let col = start; col <= start + HOURS_PER_DAY - 1; col += 1) box(ws.getCell(row, col));
        });
        ws.getRow(row).height = CATEGORY_ROW_HEIGHT;
        row += 1;
      }
    }
  }
  if (!input.events.length) {
    put(ws.getCell(row, 1), "No events in the selected period.");
    ws.mergeCells(row, 1, row, lastCol);
    row += 1;
  }

  const totalSpecs = [
    { label: "Total demand", fill: "FFFFF7ED", source: (department: string, date: string) => plan.demandCell.get(`${department}|${date}`) ?? "0" },
    { label: "Total available", fill: "FFEFF6FF", source: (department: string, date: string) => resource.departmentDay.get(`${department}|${date}`) ?? "0" }
  ] as const;
  for (const spec of totalSpecs) {
    for (const department of departments) {
      put(ws.getCell(row, 1), spec.label, { bold: true, fill: "FFE2E8F0" });
      put(ws.getCell(row, 2), "", { fill: "FFE2E8F0" });
      put(ws.getCell(row, 3), "", { fill: "FFE2E8F0" });
      ws.mergeCells(row, 1, row, 3);
      put(ws.getCell(row, 4), department, { bold: true, align: "center", fill: "FFE2E8F0" });
    put(ws.getCell(row, 5), "", { fill: "FFE2E8F0" });
      dates.forEach((date, index) => {
        const start = dayColumn(index);
        formula(ws.getCell(row, start), `IF(ABS(${spec.source(department, date)})<0.0001,"",${spec.source(department, date)})`, { fill: spec.fill, bold: true });
        ws.mergeCells(row, start, row, start + HOURS_PER_DAY - 1);
        for (let col = start; col <= start + HOURS_PER_DAY - 1; col += 1) {
          box(ws.getCell(row, col));
          ws.getCell(row, col).fill = solid(spec.fill);
        }
      });
      row += 1;
    }
  }
  for (const department of departments) {
    put(ws.getCell(row, 1), "Total difference", { bold: true, fill: "FFE2E8F0" });
    put(ws.getCell(row, 2), "", { fill: "FFE2E8F0" });
    put(ws.getCell(row, 3), "", { fill: "FFE2E8F0" });
    ws.mergeCells(row, 1, row, 3);
    put(ws.getCell(row, 4), department, { bold: true, align: "center", fill: "FFE2E8F0" });
    put(ws.getCell(row, 5), "", { fill: "FFE2E8F0" });
    dates.forEach((date, index) => {
      const start = dayColumn(index);
      const supply = resource.departmentDay.get(`${department}|${date}`) ?? "0";
      const demand = plan.demandCell.get(`${department}|${date}`) ?? "0";
      formula(ws.getCell(row, start), `IF(AND(ABS(${supply})<0.0001,ABS(${demand})<0.0001),"",${supply}-${demand})`, { fill: "FFF0FDF4", bold: true });
      ws.mergeCells(row, start, row, start + HOURS_PER_DAY - 1);
      for (let col = start; col <= start + HOURS_PER_DAY - 1; col += 1) {
        box(ws.getCell(row, col));
        ws.getCell(row, col).fill = solid("FFF0FDF4");
      }
      diffRefs.push(localRef(start, row));
    });
    row += 1;
  }
  if (diffRefs.length) {
    ws.addConditionalFormatting({
      ref: `${diffRefs[0]}:${colLetter(lastCol)}${row - 1}`,
      rules: [
        { type: "cellIs", operator: "lessThan", priority: 1, formulae: ["0"], style: { font: { color: { argb: "FFB91C1C" }, bold: true } } },
        { type: "cellIs", operator: "greaterThan", priority: 2, formulae: ["0"], style: { font: { color: { argb: "FF15803D" }, bold: true } } }
      ]
    });
  }

  row += 1;
  put(ws.getCell(row, 1), "Period summary", { bold: true, size: 12 });
  row += 1;
  ["Shop / aircraft type", "Planned workload", "Available resource", "Difference"].forEach((label, index) => put(ws.getCell(row, index + 1), label, { bold: true, fill: "FFE2E8F0", align: "center", wrap: true }));
  ws.getRow(row).height = 32;
  row += 1;
  const slices = [...input.slices].sort((a, b) => a.workshop.localeCompare(b.workshop, "ru", { numeric: true }) || a.aircraftType.localeCompare(b.aircraftType, "ru", { numeric: true }));
  const summaryStart = row;
  for (const slice of slices) {
    put(ws.getCell(row, 1), `${slice.workshop} · ${slice.aircraftType}`, { wrap: true });
    const plannedRange = (col: number) => `'${SHEET_PLAN}'!$${colLetter(col)}$${plan.firstRow}:$${colLetter(col)}$${plan.lastRow}`;
    const planned = plan.lastRow >= plan.firstRow && input.events.length
      ? `SUMIFS(${plannedRange(plan.totalCol)},${plannedRange(plan.workshopCol)},${formulaText(slice.workshop)},${plannedRange(plan.typeCol)},${formulaText(slice.aircraftType)})`
      : "0";
    formula(ws.getCell(row, 2), planned, { fill: "FFFFF7ED" });
    formula(ws.getCell(row, 3), resource.typePeriod.get(`${slice.workshopId}|${slice.aircraftTypeId}`) ?? "0", { fill: "FFEFF6FF" });
    formula(ws.getCell(row, 4), `${localRef(3, row)}-${localRef(2, row)}`, { fill: "FFF0FDF4" });
    row += 1;
  }
  if (slices.length) {
    put(ws.getCell(row, 1), "Total", { bold: true, fill: "FFE2E8F0" });
    formula(ws.getCell(row, 2), `SUM(${localRef(2, summaryStart)}:${localRef(2, row - 1)})`, { fill: "FFE2E8F0", bold: true });
    formula(ws.getCell(row, 3), `SUM(${localRef(3, summaryStart)}:${localRef(3, row - 1)})`, { fill: "FFE2E8F0", bold: true });
    formula(ws.getCell(row, 4), `${localRef(3, row)}-${localRef(2, row)}`, { fill: "FFE2E8F0", bold: true });
  } else {
    put(ws.getCell(row, 1), "No planned workload or available resource for the period.");
    ws.mergeCells(row, 1, row, LABEL_COLUMNS);
  }

  const labelWidth = columnWidthPx(70);
  for (let col = 1; col <= LABEL_COLUMNS; col += 1) ws.getColumn(col).width = labelWidth;
  for (let col = LABEL_COLUMNS + 1; col <= lastCol; col += 1) ws.getColumn(col).width = hourWidth;
  ws.views = [{ state: "frozen", xSplit: LABEL_COLUMNS, ySplit: hourRow }];
  ws.pageSetup.printTitlesRow = `${headerRow}:${hourRow}`;
  ws.properties.tabColor = { argb: "FFF97316" };
  fit(ws);
}

export function buildPersonnelPlanWorkbook(input: PersonnelPlanExcelInput) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HVP";
  wb.calcProperties.fullCalcOnLoad = true;
  const departments = visibleDepartments(input.departments);
  const resource = buildResourceSheet(wb, input, departments);
  const plan = buildPlanSheet(wb, input, departments, resource);
  buildChartSheet(wb, input, departments, resource, plan);
  const byName = new Map(wb.worksheets.map((sheet) => [sheet.name, sheet]));
  setOrder(byName.get(SHEET_CHART)!, 1);
  setOrder(byName.get(SHEET_RESOURCE)!, 2);
  setOrder(byName.get(SHEET_PLAN)!, 3);
  return wb;
}

export async function exportPersonnelPlanExcel(input: PersonnelPlanExcelInput) {
  const wb = buildPersonnelPlanWorkbook(input);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `grafik-plan-${input.from}_${input.to}-${dayjs().format("HHmm")}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
