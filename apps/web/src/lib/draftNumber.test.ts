import assert from "node:assert/strict";
import test from "node:test";

import { commitDraftNumber, liveDraftInteger, liveDraftNumber, parseDraftNumber } from "./draftNumber.ts";

test("TAT draft can be cleared and replaced without snapping back", () => {
  assert.equal(liveDraftInteger("72", 1, 8760), 72);
  assert.equal(liveDraftInteger("7", 1, 8760), 7);
  assert.equal(liveDraftInteger("", 1, 8760), null);
  assert.equal(liveDraftInteger("0", 1, 8760), null);
  assert.equal(liveDraftInteger("12", 1, 8760), 12);
  assert.equal(commitDraftNumber("", 72, 1, 8760), 72);
  assert.equal(commitDraftNumber("12", 72, 1, 8760), 12);
  assert.equal(commitDraftNumber("0", 72, 1, 8760), 1);
  assert.equal(commitDraftNumber("9000", 72, 1, 8760), 8760);
});

test("readiness can be cleared even when zero is allowed", () => {
  assert.equal(liveDraftNumber("80", 0, 100), 80);
  assert.equal(liveDraftNumber("8", 0, 100), 8);
  assert.equal(liveDraftNumber("", 0, 100), null);
  assert.equal(liveDraftNumber("0", 0, 100), 0);
  assert.equal(liveDraftNumber("15", 0, 100), 15);
  assert.equal(commitDraftNumber("", 80, 0, 100), 80);
  assert.equal(commitDraftNumber("150", 80, 0, 100), 100);
});

test("decimal draft keeps the fraction and allows a leading minus", () => {
  assert.equal(liveDraftNumber("12.", -1000, 1000, true), null);
  assert.equal(liveDraftNumber("12.5", -1000, 1000, true), 12.5);
  assert.equal(liveDraftNumber("-2.5", -1000, 1000, true), -2.5);
  assert.equal(commitDraftNumber("12.5", 0, -1000, 1000, true), 12.5);
  assert.equal(commitDraftNumber("-2.5", 0, -1000, 1000, true), -2.5);
});

test("parseDraftNumber ignores blank and unfinished input", () => {
  assert.equal(parseDraftNumber(""), null);
  assert.equal(parseDraftNumber("  "), null);
  assert.equal(parseDraftNumber("-"), null);
  assert.equal(parseDraftNumber("12."), 12);
  assert.equal(parseDraftNumber("12,5"), 12.5);
  assert.equal(parseDraftNumber("нет"), null);
});
