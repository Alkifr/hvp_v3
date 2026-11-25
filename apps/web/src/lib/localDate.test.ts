import assert from "node:assert/strict";
import test from "node:test";

import { addInputMskMinutes, formatMskDateTime, fromInputMskOptional, nextTowEndLocal, toInputMsk } from "./localDate.ts";

test("datetime-local roundtrips as MSK wall clock", () => {
  const iso = fromInputMskOptional("2026-10-23T10:30");
  assert.equal(iso, "2026-10-23T07:30:00.000Z");
  assert.equal(toInputMsk(iso), "2026-10-23T10:30");
  assert.equal(formatMskDateTime(iso), "23.10.2026 10:30");
});

test("empty datetime-local stays empty", () => {
  assert.equal(fromInputMskOptional(""), null);
  assert.equal(toInputMsk(null), "");
  assert.equal(formatMskDateTime(undefined), "");
  assert.equal(addInputMskMinutes("", 30), "");
});

test("tow end defaults to 30 minutes and keeps a custom end", () => {
  assert.equal(addInputMskMinutes("2026-10-23T23:50", 30), "2026-10-24T00:20");
  assert.equal(nextTowEndLocal("", "", "2026-10-23T10:00"), "2026-10-23T10:30");
  assert.equal(nextTowEndLocal("2026-10-23T10:00", "2026-10-23T10:30", "2026-10-23T11:00"), "2026-10-23T11:30");
  assert.equal(nextTowEndLocal("2026-10-23T10:00", "2026-10-23T12:00", "2026-10-23T11:00"), "2026-10-23T12:00");
  assert.equal(nextTowEndLocal("2026-10-23T10:00", "2026-10-23T10:20", "2026-10-23T11:00"), "2026-10-23T11:30");
  assert.equal(nextTowEndLocal("2026-10-23T10:00", "2026-10-23T10:30", ""), "");
  assert.equal(nextTowEndLocal("2026-10-23T10:00", "2026-10-23T12:00", ""), "2026-10-23T12:00");
});
