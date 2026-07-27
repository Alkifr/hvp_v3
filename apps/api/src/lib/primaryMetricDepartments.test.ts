import assert from "node:assert/strict";
import test from "node:test";

import { skillCodeToDepartment, PRIMARY_METRIC_DEPARTMENTS, collectLaborMetricsFromImportRow } from "./primaryMetricDepartments.js";

test("maps skill codes to PrimaryMetricDepartment", () => {
  assert.equal(skillCodeToDepartment("ME"), "ME");
  assert.equal(skillCodeToDepartment("AV"), "AV");
  assert.equal(skillCodeToDepartment("INT"), "INT");
  assert.equal(skillCodeToDepartment("NDT"), "NDT");
  assert.equal(skillCodeToDepartment("SHOP"), "SHOP");
  assert.equal(skillCodeToDepartment("CAB_REP"), "CAB_REP");
  assert.equal(skillCodeToDepartment("CabRep"), "CAB_REP");
  assert.equal(skillCodeToDepartment("MECH"), "ME");
  assert.equal(skillCodeToDepartment("AVIO"), "AV");
  assert.equal(skillCodeToDepartment("UNKNOWN"), null);
});

test("collects labor metrics from import row columns", () => {
  const metrics = collectLaborMetricsFromImportRow({
    laborBudget_ME: "10",
    laborBudget_AV: 5,
    laborMps_CabRep: "2,5",
    laborActual_CAB_REP: 3,
    laborActual_ME: ""
  });
  assert.deepEqual(
    metrics.sort((a, b) => `${a.block}:${a.department}`.localeCompare(`${b.block}:${b.department}`)),
    [
      { block: "LABOR_BUDGET", department: "AV", manHours: 5 },
      { block: "LABOR_BUDGET", department: "ME", manHours: 10 },
      { block: "WP_ACTUAL", department: "CAB_REP", manHours: 3 },
      { block: "WP_PLAN_MPS", department: "CAB_REP", manHours: 2.5 }
    ]
  );
});
