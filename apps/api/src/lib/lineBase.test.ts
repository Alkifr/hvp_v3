import assert from "node:assert/strict";
import test from "node:test";

import { parseImportLineBase, parseLineBase, resolveEventLineBase } from "./lineBase.js";

test("parseLineBase accepts LINE and BASE", () => {
  assert.equal(parseLineBase("LINE"), "LINE");
  assert.equal(parseLineBase("BASE"), "BASE");
  assert.equal(parseLineBase(""), null);
  assert.equal(parseLineBase(null), null);
});

test("parseImportLineBase accepts Excel aliases", () => {
  assert.equal(parseImportLineBase("L"), "LINE");
  assert.equal(parseImportLineBase("L (Line)"), "LINE");
  assert.equal(parseImportLineBase("линейный"), "LINE");
  assert.equal(parseImportLineBase("B"), "BASE");
  assert.equal(parseImportLineBase("B (Base)"), "BASE");
  assert.equal(parseImportLineBase(""), null);
  assert.equal(parseImportLineBase("xyz"), null);
});

test("create without explicit value uses workshop default", () => {
  assert.equal(
    resolveEventLineBase({
      requestedProvided: false,
      workshopDefault: "LINE"
    }),
    "LINE"
  );
});

test("create with explicit value keeps manual override", () => {
  assert.equal(
    resolveEventLineBase({
      requestedProvided: true,
      requested: "BASE",
      workshopDefault: "LINE"
    }),
    "BASE"
  );
});

test("patch without workshop or lineBase keeps stored value", () => {
  assert.equal(
    resolveEventLineBase({
      requestedProvided: false,
      workshopDefault: "LINE",
      stored: "BASE"
    }),
    "BASE"
  );
});

test("workshop change applies new default unless stored is kept when default is empty", () => {
  assert.equal(
    resolveEventLineBase({
      requestedProvided: false,
      workshopDefault: "BASE",
      stored: "LINE",
      workshopChanged: true
    }),
    "BASE"
  );
  assert.equal(
    resolveEventLineBase({
      requestedProvided: false,
      workshopDefault: null,
      stored: "LINE",
      workshopChanged: true
    }),
    "LINE"
  );
});
