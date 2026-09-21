import assert from "node:assert/strict";
import test from "node:test";

import {
  skillCodeToDepartment,
  collectLaborMetricsFromImportRow,
  isLiveLaborExcelColumn
} from "./primaryMetricDepartments.js";

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
    laborAddBudget_ME: 1,
    laborNrcBudget_AV: 2,
    laborMps_CabRep: "2,5",
    laborAddPlan_ME: 4,
    laborNrcActual_INT: 1,
    laborActual_CAB_REP: 3,
    laborActual_ME: ""
  });
  assert.deepEqual(
    metrics.sort((a, b) => `${a.block}:${a.department}`.localeCompare(`${b.block}:${b.department}`)),
    [
      { block: "ADD_BUDGET", department: "ME", manHours: 1 },
      { block: "ADD_PLAN", department: "ME", manHours: 4 },
      { block: "LABOR_BUDGET", department: "AV", manHours: 5 },
      { block: "LABOR_BUDGET", department: "ME", manHours: 10 },
      { block: "NRC_ACTUAL", department: "INT", manHours: 1 },
      { block: "NRC_BUDGET", department: "AV", manHours: 2 },
      { block: "WP_ACTUAL", department: "CAB_REP", manHours: 3 },
      { block: "WP_PLAN_MPS", department: "CAB_REP", manHours: 2.5 }
    ]
  );
});

test("recognizes live labor excel columns including ADD/NRC", () => {
  assert.equal(isLiveLaborExcelColumn("AX"), true);
  assert.equal(isLiveLaborExcelColumn("fu"), true);
  assert.equal(isLiveLaborExcelColumn("CJ"), true);
  assert.equal(isLiveLaborExcelColumn("ed"), true);
  assert.equal(isLiveLaborExcelColumn("BO"), false);
});
