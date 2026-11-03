import assert from "node:assert/strict";
import test from "node:test";

import { expandWorkshopAssignment, hangarCodesFromCell } from "./aircraftWorkshopCatalog.js";

test("AFL 320 C-check split prefers ЦПТО3 hangar 1 and keeps ЦПТО5 hangar 5 as a customer option", () => {
  const rows = expandWorkshopAssignment({
    type: "A320 CEO",
    tail: "73781",
    workshop: "ЦПТО3/ЦПТО5",
    operator: "Аэрофлот",
    check: "C",
    hangar: "1, 5"
  });
  assert.deepEqual(
    rows.map((row) => [row.workshopCode, row.hangarCodes, row.choice, row.dependsOnCustomerPlan]),
    [
      ["ЦПТО3", ["1"], "PRIMARY", false],
      ["ЦПТО5", ["5"], "ALTERNATE", true]
    ]
  );
});

test("A330 C-check on ЦПТО3 keeps hangar 3", () => {
  const [row] = expandWorkshopAssignment({
    type: "A330",
    tail: "73789",
    workshop: "ЦПТО3",
    operator: "Аэрофлот",
    check: "C",
    hangar: "3"
  });
  assert.equal(row?.workshopCode, "ЦПТО3");
  assert.deepEqual(row?.hangarCodes, ["3"]);
  assert.equal(row?.choice, "FIXED");
  assert.equal(row?.dependsOnCustomerPlan, false);
});

test("737 C-check on ЦПТО5 is marked as a customer-plan assignment in hangar 5", () => {
  const [row] = expandWorkshopAssignment({
    type: "B737-800",
    tail: "73155",
    workshop: "ЦПТО5",
    operator: "Аэрофлот",
    check: "C",
    hangar: "5"
  });
  assert.equal(row?.dependsOnCustomerPlan, true);
  assert.deepEqual(row?.hangarCodes, ["5"]);
  assert.equal(row?.choice, "FIXED");
});

test("other workshops keep every listed hangar and do not invent a tail choice", () => {
  assert.deepEqual(hangarCodesFromCell("3,5"), ["3", "5"]);
  const [row] = expandWorkshopAssignment({
    type: "RRJ-95B",
    tail: "89188",
    workshop: "ЦПТО1",
    operator: "Россия",
    check: "A",
    hangar: "3,5"
  });
  assert.equal(row?.choice, "FIXED");
  assert.deepEqual(row?.hangarCodes, ["3", "5"]);
  const [paint] = expandWorkshopAssignment({
    type: "RRJ-95B",
    tail: "89188",
    workshop: "ЦПОИ1",
    operator: "Россия",
    check: "A",
    hangar: ""
  });
  assert.equal(paint?.workshopCode, "ЦПОИ1");
  assert.deepEqual(paint?.hangarCodes, []);
});
