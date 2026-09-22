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

test("accepts migration labor column aliases", () => {
  const metrics = collectLaborMetricsFromImportRow({
    laborBudget_Add_ME: 7,
    laborBudget_Nrc_AV: "1,5",
    laborMPS_Add_INT: 3,
    laborMPS_Nrc_NDT: 4,
    laborActual_Add_SHOP: 8,
    laborActual_Nrc_CabRep: 2
  });
  assert.deepEqual(
    metrics.sort((a, b) => `${a.block}:${a.department}`.localeCompare(`${b.block}:${b.department}`)),
    [
      { block: "ADD_ACTUAL", department: "SHOP", manHours: 8 },
      { block: "ADD_BUDGET", department: "ME", manHours: 7 },
      { block: "ADD_PLAN", department: "INT", manHours: 3 },
      { block: "NRC_ACTUAL", department: "CAB_REP", manHours: 2 },
      { block: "NRC_BUDGET", department: "AV", manHours: 1.5 },
      { block: "NRC_PLAN", department: "NDT", manHours: 4 }
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
