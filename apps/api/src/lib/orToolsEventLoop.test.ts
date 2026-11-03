import assert from "node:assert/strict";
import test from "node:test";

import { CpModel, CpSat, CpSolver, isWorkerBridgeAvailable, terminateWorkerBridge } from "or-tools-wasm/cp-sat";

function queensModel(n: number) {
  const model = new CpModel();
  const queens = [];
  for (let i = 0; i < n; i++) queens.push(model.newIntVar(0, n - 1, `q${i}`));
  model.addAllDifferent(queens);
  const diag1 = [];
  const diag2 = [];
  for (let i = 0; i < n; i++) {
    diag1.push(queens[i]!.plus(i));
    diag2.push(queens[i]!.minus(i));
  }
  model.addAllDifferent(diag1);
  model.addAllDifferent(diag2);
  return model;
}

test("mass-plan OR-Tools solve keeps the API event loop free", async () => {
  assert.equal(isWorkerBridgeAvailable(), true);
  CpSat.setWorkerBridgeEnabled(true);
  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = 1.2;
  solver.parameters.numSearchWorkers = 1;
  solver.parameters.enumerateAllSolutions = true;
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 100);
  try {
    const status = await solver.solve(queensModel(14));
    assert.equal(solver.statusName(status), "FEASIBLE");
    assert.ok(ticks >= 4, `event loop stayed blocked during solve, ticks=${ticks}`);
  } finally {
    clearInterval(timer);
    terminateWorkerBridge("test finished");
  }
});
