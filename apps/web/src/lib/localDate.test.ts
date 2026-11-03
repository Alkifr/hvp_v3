import assert from "node:assert/strict";
import test from "node:test";

import { formatMskDateTime, fromInputMskOptional, toInputMsk } from "./localDate.ts";

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
});
