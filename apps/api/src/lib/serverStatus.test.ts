import assert from "node:assert/strict";
import test from "node:test";

import { databaseStatus, diskStatus, hostStatus, processStatus } from "./serverStatus.js";

test("processStatus warns when the process holds most of the machine memory", () => {
  assert.equal(processStatus(81, 100).level, "warn");
  assert.equal(processStatus(80, 100).level, "ok");
});

test("hostStatus warns on low memory or load above the cpu count", () => {
  assert.equal(hostStatus({ memFreeBytes: 9, memTotalBytes: 100, load1: 1, cpuCount: 4 }).level, "warn");
  assert.equal(hostStatus({ memFreeBytes: 10, memTotalBytes: 100, load1: 4, cpuCount: 4 }).level, "ok");
  assert.equal(hostStatus({ memFreeBytes: 50, memTotalBytes: 100, load1: 4.1, cpuCount: 4 }).level, "warn");
  assert.match(hostStatus({ memFreeBytes: 1, memTotalBytes: 100, load1: 8, cpuCount: 2 }).note ?? "", /памяти/);
});

test("diskStatus warns below 10 percent free", () => {
  assert.equal(diskStatus(9, 100).level, "warn");
  assert.equal(diskStatus(10, 100).level, "ok");
  assert.equal(diskStatus(0, 0).level, "ok");
});

test("databaseStatus marks a dead database and a slow reply", () => {
  assert.equal(databaseStatus(false, null).level, "down");
  assert.equal(databaseStatus(true, 500).level, "warn");
  assert.equal(databaseStatus(true, 499).level, "ok");
});
