import assert from "node:assert/strict";
import test from "node:test";

import { placeAddedRows } from "./towPlanCopies.ts";

const row = (id: string, eventId: string) => ({ id, eventId });

test("copies sit under the source row and stay there after a refresh", () => {
  const base = [row("a", "e1"), row("b", "e2")];
  const copy = { id: "copy-1", eventId: "e1", added: true, copyAnchorId: "a" };
  assert.deepEqual(
    placeAddedRows(base, [copy]).map((item) => item.id),
    ["a", "copy-1", "b"]
  );
  const again = placeAddedRows(base, [copy, { id: "copy-2", eventId: "e1", added: true, copyAnchorId: "a" }]);
  assert.deepEqual(
    again.map((item) => item.id),
    ["a", "copy-1", "copy-2", "b"]
  );
});

test("a copy whose source row disappeared stays with the same event", () => {
  const base = [row("event:e1", "e1"), row("b", "e2")];
  const copy = { id: "copy-1", eventId: "e1", added: true, copyAnchorId: "gone" };
  assert.deepEqual(
    placeAddedRows(base, [copy]).map((item) => item.id),
    ["event:e1", "copy-1", "b"]
  );
});
