import assert from "node:assert/strict";
import test from "node:test";
import { EventStatus } from "./eventStatusCatalog.js";

import {
  isVirtualAircraftPlaceholder,
  statusAllowsVirtualAircraft,
  VIRTUAL_AIRCRAFT_LABEL,
  virtualAircraftDisplayLabel
} from "./virtualAircraft.js";

test("virtual aircraft is allowed only while pending, cancelled or deleted", () => {
  assert.equal(statusAllowsVirtualAircraft(EventStatus.PENDING_EXECUTOR_APPROVAL), true);
  assert.equal(statusAllowsVirtualAircraft(EventStatus.PENDING_CUSTOMER_APPROVAL), true);
  assert.equal(statusAllowsVirtualAircraft(EventStatus.CANCELLED), true);
  assert.equal(statusAllowsVirtualAircraft(EventStatus.DELETED), true);
  assert.equal(statusAllowsVirtualAircraft(EventStatus.APPROVED_BY_EXECUTOR), false);
  assert.equal(statusAllowsVirtualAircraft(EventStatus.APPROVED_BY_CUSTOMER), false);
  assert.equal(statusAllowsVirtualAircraft(EventStatus.IN_PROGRESS), false);
  assert.equal(statusAllowsVirtualAircraft(EventStatus.DONE), false);
});

test("placeholder is virtual only without a real aircraftId", () => {
  assert.equal(isVirtualAircraftPlaceholder({ aircraftId: null, virtualAircraft: { label: "old" } }), true);
  assert.equal(isVirtualAircraftPlaceholder({ aircraftId: "a1", virtualAircraft: { label: "old" } }), false);
  assert.equal(isVirtualAircraftPlaceholder({ aircraftId: null, virtualAircraft: null }), false);
});

test("display label is always VIRT", () => {
  assert.equal(VIRTUAL_AIRCRAFT_LABEL, "VIRT");
  assert.equal(virtualAircraftDisplayLabel("— Стр. 6.16"), "VIRT");
});
