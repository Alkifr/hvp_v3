import assert from "node:assert/strict";
import test from "node:test";

import { ganttBarNotesText, rowHasGanttBarNotes } from "./ganttBarNotes.ts";

test("gantt bar notes hide completed and cancelled events", () => {
  assert.equal(ganttBarNotesText({ notes: "открыто", status: "IN_PROGRESS" }), "открыто");
  assert.equal(ganttBarNotesText({ notes: "готово", status: "DONE" }), "");
  assert.equal(ganttBarNotesText({ notes: "снято", status: "CANCELLED" }), "");
  assert.equal(ganttBarNotesText({ notes: "   ", status: "IN_PROGRESS" }), "");
});

test("row has notes only when an active event has text", () => {
  assert.equal(
    rowHasGanttBarNotes([
      { ev: { notes: "есть", status: "DONE" } },
      { ev: { notes: "ещё", status: "IN_PROGRESS" } }
    ]),
    true
  );
  assert.equal(
    rowHasGanttBarNotes([
      { ev: { notes: "есть", status: "DONE" } },
      { ev: { notes: "ещё", status: "CANCELLED" } }
    ]),
    false
  );
});
