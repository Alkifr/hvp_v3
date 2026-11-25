import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";

import { buildTowRegistryLetter, describeTowSendDiff } from "./towRegistryMail.js";
import type { TowReportRow } from "./towReport.js";
import { buildTowRegistryXlsx } from "./towReportXlsx.js";

function row(partial: Partial<TowReportRow>): TowReportRow {
  return {
    id: "t1",
    eventId: "e1",
    eventTitle: "C-check",
    eventStatus: "IN_PROGRESS",
    eventTypeId: "",
    eventType: "",
    seq: 1,
    direction: "IN",
    directionLabel: "Закатка",
    towDurationMinutes: 30,
    hangarId: "h1",
    hangarNumber: "Ангар 1",
    aircraftTypeId: "t1",
    aircraftType: "320",
    aircraftId: "a1",
    tailNumber: "RA-100",
    operatorId: "o1",
    operator: "AFL",
    fromStand: "МС",
    toStand: "A1",
    plannedStartAt: "2026-11-01T07:00:00.000Z",
    plannedStartMsk: "01.11.2026 10:00",
    plannedEndAt: "2026-11-01T07:30:00.000Z",
    plannedEndMsk: "01.11.2026 10:30",
    occupancyEndAt: "",
    occupancyEndMsk: "05.11.2026 18:00",
    inferredOccupancyEndAt: "2026-11-05T15:00:00.000Z",
    standOccupancy: "4 д",
    standOccupancyMinutes: 5760,
    notes: "",
    toSlotEndAt: "2026-11-05T15:00:00.000Z",
    toSlotEndMsk: "05.11.2026 18:00",
    toSlotDuration: "",
    toSlotMinutes: null,
    positionComment: "",
    startChangeReason: "",
    fromLabel: "МС",
    toLabel: "A1",
    placementId: "p1",
    ...partial
  };
}

test("registry letter uses the dispatcher columns and the period", () => {
  const letter = buildTowRegistryLetter({
    rows: [row({}), row({ id: "t2", seq: 2, direction: "OUT", tailNumber: "RA-200", fromStand: "A1", toStand: "МС" })],
    periodLabel: "01.11.2026–30.11.2026",
    contour: "Рабочий контур",
    note: "Смена А"
  });
  assert.equal(letter.subject, "Реестр буксировок 01.11.2026–30.11.2026");
  assert.match(letter.text, /Смена А/);
  assert.match(letter.text, /Строк: 2/);
  assert.match(letter.text, /Тип ВС/);
  assert.match(letter.text, /RA-100/);
  assert.match(letter.html, /Ангар 1/);
  assert.match(letter.html, /ffd966/);
  assert.match(letter.html, /RA-200/);
  assert.match(letter.html, /Бортовой номер/);
  assert.doesNotMatch(letter.text, /Статус/);
  assert.doesNotMatch(letter.html, /<script/);
});

test("registry letter highlights added and updated rows", () => {
  const letter = buildTowRegistryLetter({
    rows: [
      row({ changeStatus: "Добавлено" } as TowReportRow & { changeStatus?: string }),
      row({ id: "t2", seq: 2, tailNumber: "RA-200", changeStatus: "Обновлено" } as TowReportRow & { changeStatus?: string })
    ],
    periodLabel: "01.11.2026–30.11.2026",
    contour: "Рабочий контур",
    diffLines: ["Изменения с прошлой фиксации:", "+ RA-100"]
  });
  assert.match(letter.text, /Изменения с прошлой фиксации/);
  assert.match(letter.text, /Статус/);
  assert.match(letter.text, /Добавлено/);
  assert.match(letter.html, /dcfce7/);
  assert.match(letter.html, /fef3c7/);
  assert.match(letter.html, /Обновлено/);
});

test("registry letter keeps only added and updated tows", () => {
  const letter = buildTowRegistryLetter({
    rows: [
      row({ changeStatus: "Добавлено" } as TowReportRow & { changeStatus?: string }),
      row({ id: "t2", seq: 2, tailNumber: "RA-200", changeStatus: "Обновлено" } as TowReportRow & { changeStatus?: string }),
      row({ id: "t3", seq: 3, tailNumber: "RA-300", changeStatus: "" } as TowReportRow & { changeStatus?: string })
    ],
    periodLabel: "01.11.2026–30.11.2026",
    contour: "Рабочий контур"
  });
  assert.match(letter.text, /RA-100/);
  assert.match(letter.text, /RA-200/);
  assert.doesNotMatch(letter.text, /RA-300/);
  assert.doesNotMatch(letter.html, /RA-300/);
  assert.match(letter.text, /Строк: 2/);
});

test("registry letter shows a deleted tow row with status Удалено", () => {
  const letter = buildTowRegistryLetter({
    rows: [
      row({ changeStatus: "Добавлено" } as TowReportRow & { changeStatus?: string }),
      row({
        id: "t9",
        seq: 9,
        tailNumber: "RA-900",
        fromStand: "МС",
        toStand: "MC-2",
        plannedStartMsk: "02.11.2026 12:00",
        changeStatus: "Удалено"
      } as TowReportRow & { changeStatus?: string })
    ],
    periodLabel: "01.11.2026–30.11.2026",
    contour: "Рабочий контур"
  });
  assert.match(letter.text, /RA-900/);
  assert.match(letter.text, /Удалено/);
  assert.match(letter.html, /fee2e2/);
  assert.match(letter.html, /Удалено/);
});

test("attachment hangar band spans every column through status", async () => {
  const buffer = await buildTowRegistryXlsx([
    row({ changeStatus: "Добавлено" } as TowReportRow & { changeStatus?: string }),
    row({ id: "t2", seq: 2, tailNumber: "RA-200", changeStatus: "" } as TowReportRow & { changeStatus?: string })
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("Буксировки");
  assert.ok(sheet);
  assert.equal(sheet.getRow(1).getCell(13).value, "Статус");
  const merges = sheet.model.merges ?? [];
  assert.ok(merges.some((range) => range.endsWith(":M2") || range.endsWith(":M3")));
  const band = sheet.getRow(2);
  const fill = band.getCell(13).fill;
  assert.equal(band.getCell(1).value, "Ангар 1");
  assert.equal(fill && "fgColor" in fill ? fill.fgColor?.argb : "", "FFFFD966");
});

test("send diff lists added, removed and start time changes", () => {
  const lines = describeTowSendDiff(
    [{ id: "keep", tailNumber: "RA-1", plannedStartMsk: "17.11.2026 10:00", fromStand: "МС", toStand: "A1" }, { id: "gone", tailNumber: "RA-2", plannedStartMsk: "17.11.2026 12:00" }],
    [{ id: "keep", tailNumber: "RA-1", plannedStartMsk: "17.11.2026 11:00", fromStand: "МС", toStand: "A1" }, { id: "new", tailNumber: "RA-3", plannedStartMsk: "17.11.2026 15:00", fromStand: "B1", toStand: "МС" }]
  );
  assert.match(lines.join("\n"), /\+ RA-3/);
  assert.match(lines.join("\n"), /- RA-2/);
  assert.match(lines.join("\n"), /RA-1: 17\.11\.2026 10:00 → 17\.11\.2026 11:00/);
});
