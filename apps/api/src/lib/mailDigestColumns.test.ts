import assert from "node:assert/strict";
import test from "node:test";

import {
  aircraftDisplayName,
  aircraftTypeDisplayName,
  DEFAULT_DIGEST_COLUMNS,
  digestCellText,
  parseDigestColumns
} from "./mailDigestColumns.js";

test("aircraftDisplayName uses tail number, not serial code", () => {
  assert.equal(
    aircraftDisplayName({ tailNumber: "RA-73100", serialNumber: "41234" }),
    "RA-73100"
  );
  assert.equal(aircraftDisplayName({ virtualLabel: "Slot A", serialNumber: "99" }), "Slot A");
  assert.equal(aircraftDisplayName({ serialNumber: "41234" }), "41234");
});

test("aircraftTypeDisplayName prefers name over ICAO code", () => {
  assert.equal(aircraftTypeDisplayName({ name: "Боинг 737-800", icaoType: "B738" }), "Боинг 737-800");
  assert.equal(aircraftTypeDisplayName({ name: "", icaoType: "B738" }), "B738");
});

test("parseDigestColumns keeps order and drops unknown keys", () => {
  assert.deepEqual(parseDigestColumns(null), DEFAULT_DIGEST_COLUMNS);
  assert.deepEqual(parseDigestColumns(["aircraft", "bogus", "aircraft", "title"]), ["aircraft", "title"]);
});

test("digestCellText maps aircraft to name column", () => {
  const row = {
    kind: "added" as const,
    operatorLabel: "АФЛ",
    aircraftTypeName: "Боинг 737-800",
    aircraftTypeCode: "B738",
    aircraftName: "RA-73100",
    aircraftCode: "41234",
    title: "C-check",
    detail: "на 01-10.08.26",
    period: "01-10.08.26",
    previous: ""
  };
  assert.equal(digestCellText(row, "aircraft"), "RA-73100");
  assert.equal(digestCellText(row, "aircraftCode"), "41234");
  assert.equal(digestCellText(row, "aircraftType"), "Боинг 737-800");
});
