import assert from "node:assert/strict";
import test from "node:test";

import { resolveAllowOverlap } from "./placementOverlap.js";

test("resolveAllowOverlap skips checks and sticks the flag when slots already overlap", () => {
  assert.deepEqual(resolveAllowOverlap({ requested: false, stored: false, existingOverlap: true }), {
    skipChecks: true,
    storedValue: true
  });
});

test("resolveAllowOverlap keeps the stored flag when the client sends true", () => {
  assert.deepEqual(resolveAllowOverlap({ requested: true, stored: true, existingOverlap: false }), {
    skipChecks: true,
    storedValue: true
  });
});

test("resolveAllowOverlap keeps the stored flag when the client omits the field", () => {
  assert.deepEqual(resolveAllowOverlap({ stored: true, existingOverlap: false }), {
    skipChecks: true,
    storedValue: true
  });
});

test("resolveAllowOverlap lets the user turn the flag off after overlap is gone", () => {
  assert.deepEqual(resolveAllowOverlap({ requested: false, stored: true, existingOverlap: false }), {
    skipChecks: true,
    storedValue: false
  });
});

test("resolveAllowOverlap still requires an explicit flag for a new overlap", () => {
  assert.deepEqual(resolveAllowOverlap({ requested: false, stored: false, existingOverlap: false }), {
    skipChecks: false,
    storedValue: false
  });
});
