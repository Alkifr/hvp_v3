import assert from "node:assert/strict";
import test from "node:test";

import { classifyAircraftWorkshopImport, readWorkshopImportRecords } from "./aircraftWorkshopImportPlan.js";

const aircraft = [
  {
    id: "ac-330",
    tailNumber: "RA-73789",
    typeName: "A330",
    icaoType: "A333",
    operatorName: "Аэрофлот",
    operatorCode: "AFL"
  },
  {
    id: "ac-320",
    tailNumber: "RA-73781",
    typeName: "A320 CEO",
    icaoType: "A320",
    operatorName: "Аэрофлот",
    operatorCode: "AFL"
  },
  {
    id: "ac-737",
    tailNumber: "RA-73155",
    typeName: "B737-800",
    icaoType: "B738",
    operatorName: "Аэрофлот",
    operatorCode: "AFL"
  }
];

const workshops = [
  { id: "w3", code: "ЦПТО3", name: "Цех 3" },
  { id: "w5", code: "ЦПТО5", name: "Цех 5" }
];

const hangars = [
  { id: "h1", code: "H1", name: "Ангар 1" },
  { id: "h3", code: "H3", name: "Ангар 3" },
  { id: "h5", code: "H5", name: "Ангар 5" }
];

function classify(rows: Array<Record<string, unknown>>, existing: Parameters<typeof classifyAircraftWorkshopImport>[0]["existing"] = []) {
  const read = readWorkshopImportRecords(rows);
  assert.ok(!("error" in read), "error" in read ? read.error : "");
  return classifyAircraftWorkshopImport({ rows: read.rows, aircraft, workshops, hangars, existing });
}

test("russian headers become source rows and a sheet without columns is rejected", () => {
  const read = readWorkshopImportRecords([{ Борт: "73789", Форма: "C-check", Цех: "ЦПТО3", Ангар: "3" }]);
  assert.ok(!("error" in read));
  if ("error" in read) return;
  assert.equal(read.rows[0]?.rowIndex, 2);
  assert.equal(read.rows[0]?.tail, "73789");
  assert.equal(read.rows[0]?.check, "C-check");
  const missing = readWorkshopImportRecords([{ Колонка: "tail", Описание: "борт" }]);
  assert.equal("error" in missing, true);
});

test("a new tail binding is created and an unknown tail is an error", () => {
  const result = classify([
    { tail: "73789", check: "C", workshop: "ЦПТО3", hangar: "3", type: "A330", operator: "Аэрофлот" },
    { tail: "00000", check: "A", workshop: "ЦПТО3", hangar: "1" }
  ]);
  assert.equal(result.summary.createRows, 1);
  assert.equal(result.summary.errorRows, 1);
  assert.equal(result.rows[0]?.status, "create");
  assert.equal(result.rows[0]?.conflict, false);
  assert.equal(result.rows[0]?.hangar, "3");
  assert.match(result.rows[1]?.message ?? "", /не найден/);
  assert.equal(result.actions[0]?.hangarIds[0], "h3");
});

test("slash workshop expands to primary hangar 1 and alternate hangar 5", () => {
  const result = classify([{ tail: "RA-73781", check: "C-check", workshop: "ЦПТО3/ЦПТО5", hangar: "1, 5" }]);
  assert.deepEqual(
    result.rows.map((row) => [row.workshop, row.hangar, row.status, row.conflict]),
    [
      ["ЦПТО3", "1", "create", false],
      ["ЦПТО5", "5", "create", false]
    ]
  );
  assert.equal(result.actions[1]?.dependsOnCustomerPlan, true);
  assert.equal(result.actions[1]?.choice, "ALTERNATE");
});

test("changed hangar is a conflict that will update, identical row stays unchanged", () => {
  const existing = [
    {
      aircraftId: "ac-330",
      checkKind: "C" as const,
      workshopId: "w3",
      choice: "FIXED" as const,
      dependsOnCustomerPlan: false,
      note: null,
      hangarIds: ["h1"]
    }
  ];
  const changed = classify([{ tail: "73789", check: "C", workshop: "ЦПТО3", hangar: "Ангар 3" }], existing);
  assert.equal(changed.rows[0]?.status, "update");
  assert.equal(changed.rows[0]?.conflict, true);
  assert.match(changed.rows[0]?.message ?? "", /1 → 3/);
  const same = classify([{ tail: "73789", check: "C", workshop: "ЦПТО3", hangar: "1" }], existing);
  assert.equal(same.rows[0]?.status, "unchanged");
  assert.equal(same.rows[0]?.conflict, false);
  assert.equal(same.actions.length, 0);
});

test("duplicate file rows, missing hangar, type mismatch and a new workshop are visible before write", () => {
  const result = classify([
    { tail: "73789", check: "A", workshop: "ЦПТО9", hangar: "3", type: "A320", operator: "Россия" },
    { tail: "73789", check: "A", workshop: "ЦПТО9", hangar: "5" },
    { tail: "73155", check: "C", workshop: "ЦПТО5", hangar: "9" },
    { tail: "73155", check: "X", workshop: "ЦПТО5", hangar: "5" }
  ]);
  assert.equal(result.rows[0]?.status, "create");
  assert.equal(result.rows[0]?.conflict, true);
  assert.match(result.rows[0]?.message ?? "", /Тип в файле/);
  assert.match(result.rows[0]?.message ?? "", /Оператор в файле/);
  assert.match(result.rows[0]?.message ?? "", /ЦПТО9 будет создан/);
  assert.equal(result.rows[1]?.status, "error");
  assert.match(result.rows[1]?.message ?? "", /Конфликт со строкой 2/);
  assert.match(result.rows[2]?.message ?? "", /Ангар не найден: 9/);
  assert.match(result.rows[3]?.message ?? "", /Некорректная форма/);
  assert.deepEqual(result.summary.workshopsToCreate, ["ЦПТО9"]);
  assert.equal(result.summary.conflictRows, 1);
});

test("737 C-check on ЦПТО5 keeps the customer-plan flag without marking a clean row as a conflict", () => {
  const result = classify([{ tail: "73155", check: "C", workshop: "ЦПТО5", hangar: "5" }]);
  assert.equal(result.rows[0]?.conflict, false);
  assert.equal(result.actions[0]?.dependsOnCustomerPlan, true);
  assert.match(result.rows[0]?.message ?? "", /План заказчика включён/);
});
