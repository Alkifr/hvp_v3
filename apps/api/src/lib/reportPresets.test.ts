import assert from "node:assert/strict";
import test from "node:test";

import { EVENT_COUNT_FIELD } from "./reportAggregates.js";
import { CHECK_EVENT_COUNT_FIELDS, checkEventCountPresets, checkEventCountReportConfig } from "./reportPresets.js";

test("check event count presets use primary table, listed fields and event count", () => {
  const presets = checkEventCountPresets({ aCheck: "A‑check", cCheck: "C‑check" });
  assert.equal(presets.length, 2);
  assert.equal(CHECK_EVENT_COUNT_FIELDS.length, 16);

  const cCheck = checkEventCountReportConfig(presets[0]!.eventTypeName);
  assert.equal(cCheck.dataset, "primary_events");
  assert.deepEqual(cCheck.fields, [...CHECK_EVENT_COUNT_FIELDS]);
  assert.deepEqual(cCheck.groupBy, [...CHECK_EVENT_COUNT_FIELDS]);
  assert.deepEqual(cCheck.aggregates, [{ field: EVENT_COUNT_FIELD, fn: "count" }]);
  assert.deepEqual(cCheck.filters.conditions, [{ field: "primary.l", op: "eq", value: presets[0]!.eventTypeName }]);

  const aCheck = checkEventCountReportConfig(presets[1]!.eventTypeName);
  assert.equal(aCheck.filters.conditions[0]?.value, presets[1]!.eventTypeName);
});
