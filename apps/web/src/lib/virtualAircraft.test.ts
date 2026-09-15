import assert from "node:assert/strict";
import test from "node:test";

import {
  statusAllowsVirtualAircraft,
  VIRTUAL_AIRCRAFT_LABEL,
  virtualAircraftStatusError
} from "./virtualAircraft.ts";

test("virtual aircraft cannot leave pending or cancelled without a real tail", () => {
  assert.equal(statusAllowsVirtualAircraft("PENDING_EXECUTOR_APPROVAL"), true);
  assert.equal(statusAllowsVirtualAircraft("APPROVED_BY_EXECUTOR"), false);
  assert.equal(VIRTUAL_AIRCRAFT_LABEL, "VIRT");
  assert.match(
    virtualAircraftStatusError({
      status: "DONE",
      aircraftId: "",
      hasVirtualAircraft: true
    }) ?? "",
    /реальный борт/
  );
  assert.equal(
    virtualAircraftStatusError({
      status: "DONE",
      aircraftId: "real",
      hasVirtualAircraft: true
    }),
    null
  );
});
