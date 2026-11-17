import assert from "node:assert/strict";
import test from "node:test";

import { buildTowEventRegistryLetter } from "./towRegistryMail.js";
import {
  buildRegistryRows,
  compareRegistrySnapshots,
  coveredEdgeRole,
  eventIntersectsWindow,
  markRegistryRows,
  plannedEdgeCreates,
  snapshotFromRow,
  type RegistryEventInput,
  type TowRegistrySnapshotRow
} from "./towRegistry.js";

const FROM = new Date("2026-11-17T05:00:00.000Z");
const TO = new Date("2026-11-18T05:00:00.000Z");

function event(partial: Partial<RegistryEventInput> = {}): RegistryEventInput {
  return {
    id: "e1",
    title: "C-check",
    status: "IN_PROGRESS",
    startAt: new Date("2026-11-17T05:00:00.000Z"),
    endAt: new Date("2026-11-18T15:00:00.000Z"),
    hangarId: "h1",
    hangarName: "Ангар 1",
    hangarCode: "A1",
    tailNumber: "RA-100",
    aircraftId: "ac1",
    virtual: false,
    aircraftTypeId: "ty1",
    aircraftType: "320",
    operatorId: "op1",
    operator: "AFL",
    placements: [
      {
        id: "p1",
        origin: "MANUAL",
        startAt: new Date("2026-11-17T05:00:00.000Z"),
        endAt: new Date("2026-11-18T15:00:00.000Z"),
        hangarId: "h1",
        hangarName: "Ангар 1",
        hangarCode: "A1",
        standCode: "MC-1"
      }
    ],
    tows: [],
    waivedRoles: [],
    ...partial
  };
}

test("operational window keeps an overlapping event and drops one that only starts at the end", () => {
  assert.equal(eventIntersectsWindow(FROM, new Date("2026-11-17T20:00:00.000Z"), FROM, TO), true);
  assert.equal(eventIntersectsWindow(TO, new Date("2026-11-18T15:00:00.000Z"), FROM, TO), false);
  assert.equal(eventIntersectsWindow(new Date("2026-11-16T05:00:00.000Z"), FROM, FROM, TO), false);
});

test("registry row stays when the event has no rollout", () => {
  const [row] = buildRegistryRows([event()], 30);
  assert.ok(row);
  assert.equal(row.inEdge.state, "empty");
  assert.equal(row.outEdge.state, "empty");
  assert.equal(row.export.inMark, "не назначена");
  assert.equal(row.export.outMark, "не назначена");
  assert.equal(row.inEdge.planStartAt, "2026-11-17T05:00:00.000Z");
  assert.equal(row.outEdge.planEndAt, "2026-11-18T15:00:00.000Z");
  assert.match(row.outEdge.note, /Норматив 30 мин/);
});

test("waiver is an explicit edge and is not offered for auto fill", () => {
  const [row] = buildRegistryRows([event({ waivedRoles: ["event-out"] })], 30);
  assert.equal(row.outEdge.state, "waived");
  assert.equal(row.export.outMark, "не требуется");
  assert.equal(row.inEdge.state, "empty");
  const creates = plannedEdgeCreates({
    minutes: 30,
    placements: event().placements,
    existing: [],
    waivedRoles: ["event-out"]
  });
  assert.deepEqual(
    creates.map((tow) => tow.role),
    ["event-in"]
  );
});

test("assigned edge keeps its own minute window", () => {
  const [row] = buildRegistryRows(
    [
      event({
        tows: [
          {
            id: "t-in",
            placementId: "p1",
            startAt: new Date("2026-11-17T05:00:00.000Z"),
            endAt: new Date("2026-11-17T05:30:00.000Z"),
            fromLabel: "МС",
            toLabel: "MC-1"
          }
        ]
      })
    ],
    30
  );
  assert.equal(row.inEdge.state, "assigned");
  assert.equal(row.inEdge.towId, "t-in");
  assert.equal(row.export.inStartMsk, "17.11.2026 08:00");
  assert.equal(row.export.inEndMsk, "17.11.2026 08:30");
  assert.equal(row.outEdge.state, "empty");
  assert.equal(
    coveredEdgeRole(
      { startAt: new Date("2026-11-17T05:00:00.000Z"), endAt: new Date("2026-11-17T05:30:00.000Z") },
      event().placements
    ),
    "event-in"
  );
});

test("marks only the field that differs from the last send of this event", () => {
  const [row] = buildRegistryRows([event()], 30);
  const sent = snapshotFromRow(row);
  sent.inMark = "назначена";
  sent.inStartMsk = "17.11.2026 08:00";
  const marked = markRegistryRows([row], [{ sentAt: "2026-11-17T06:00:00.000Z", fromAt: FROM.toISOString(), toAt: TO.toISOString(), rows: [sent] }], {
    from: FROM.toISOString(),
    to: TO.toISOString()
  });
  assert.equal(marked.items[0]?.mark, "changed");
  assert.deepEqual(marked.items[0]?.changedFields, ["inMark", "inStartMsk"]);
  assert.equal(marked.removed.length, 0);
});

test("an event absent from every send is new, and one missing from this window is removed", () => {
  const [row] = buildRegistryRows([event()], 30);
  const fresh = markRegistryRows([row], [], { from: FROM.toISOString(), to: TO.toISOString() });
  assert.equal(fresh.items[0]?.mark, "new");
  assert.equal(fresh.items[0]?.export.changeMark, "новая строка");

  const gone: TowRegistrySnapshotRow = {
    ...snapshotFromRow(row),
    eventId: "e-gone",
    tailNumber: "RA-900"
  };
  const withGone = markRegistryRows(
    [row],
    [
      {
        sentAt: "2026-11-17T06:00:00.000Z",
        fromAt: FROM.toISOString(),
        toAt: TO.toISOString(),
        rows: [snapshotFromRow(row), gone]
      }
    ],
    { from: FROM.toISOString(), to: TO.toISOString() }
  );
  assert.equal(withGone.items[0]?.mark, "same");
  assert.equal(withGone.removed.length, 1);
  assert.equal(withGone.removed[0]?.eventId, "e-gone");
  assert.equal(withGone.removed[0]?.export.changeMark, "снята");
});

test("two sent versions show added, removed and the changed field", () => {
  const [row] = buildRegistryRows([event()], 30);
  const left = snapshotFromRow(row);
  const right: TowRegistrySnapshotRow = { ...left, outMark: "не требуется" };
  const extra: TowRegistrySnapshotRow = { ...left, eventId: "e2", tailNumber: "RA-200" };
  const diff = compareRegistrySnapshots([left, extra], [right]);
  assert.equal(diff.removed[0]?.eventId, "e2");
  assert.equal(diff.added.length, 0);
  assert.equal(diff.changed[0]?.fields[0]?.key, "outMark");
  assert.equal(diff.changed[0]?.fields[0]?.before, "не назначена");
  assert.equal(diff.changed[0]?.fields[0]?.after, "не требуется");
});

test("event letter lists both edges and the waiver", () => {
  const [row] = buildRegistryRows([event({ waivedRoles: ["event-out"] })], 30);
  const letter = buildTowEventRegistryLetter({
    rows: [{ ...row.export, seq: "1", changeMark: "новая строка" }],
    periodLabel: "17.11.2026 08:00 – 18.11.2026 08:00",
    contour: "Рабочий контур"
  });
  assert.match(letter.subject, /17\.11\.2026 08:00/);
  assert.match(letter.text, /не требуется/);
  assert.match(letter.text, /Закатка/);
  assert.match(letter.text, /Выкатка/);
  assert.match(letter.text, /RA-100/);
  assert.match(letter.html, /Отличие от отправки/);
  assert.doesNotMatch(letter.html, /<script/);
});
