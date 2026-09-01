import assert from "node:assert/strict";
import test from "node:test";

import { parseLineBase, resolveEventLineBase } from "./lineBase.js";

test("parseLineBase accepts LINE and BASE", () => {
  assert.equal(parseLineBase("LINE"), "LINE");
  assert.equal(parseLineBase("BASE"), "BASE");
  assert.equal(parseLineBase(""), null);
  assert.equal(parseLineBase(null), null);
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
