import assert from "node:assert/strict";
import test from "node:test";

import {
  auditsForRecipient,
  describeAudit,
  formatWatchLetter,
  notesFromAuditWrite,
  summarizeChanges
} from "./eventWatchMail.ts";

test("notesFromAuditWrite читает create и createMany", () => {
  const one = notesFromAuditWrite(
    "create",
    { data: { eventId: "e1", sandboxId: null, action: "UPDATE", actor: "a@b.c", changes: { title: { from: "A", to: "B" } } } },
    null
  );
  assert.equal(one.length, 1);
  assert.equal(one[0]?.eventId, "e1");

  const many = notesFromAuditWrite(
    "createMany",
    {
      data: [
        { eventId: "e1", action: "UPDATE", actor: "system" },
        { eventId: "", action: "UPDATE", actor: "system" }
      ]
    },
    { count: 1 }
  );
  assert.equal(many.length, 1);
  assert.equal(notesFromAuditWrite("update", { data: { eventId: "e1" } }, null).length, 0);
});

test("summarizeChanges показывает было и стало", () => {
  const lines = summarizeChanges({
    startAt: { from: "2026-11-01T06:00:00.000Z", to: "2026-11-02T06:00:00.000Z" },
    notes: { from: "", to: "ок" }
  });
  assert.equal(lines[0]?.startsWith("Начало:"), true);
  assert.match(lines[0] ?? "", /→/);
  assert.equal(lines[1], "Примечание: — → ок");
});

test("свои правки автору не дублируются письмом", () => {
  const notes = [
    { eventId: "e1", sandboxId: null, action: "UPDATE", actor: "Me@Example.com", reason: null, changes: null },
    { eventId: "e1", sandboxId: null, action: "UPDATE", actor: "other@example.com", reason: "перенос", changes: null }
  ];
  const visible = auditsForRecipient(notes, "me@example.com");
  assert.equal(visible.length, 1);
  assert.match(describeAudit(visible[0]!)[0] ?? "", /перенос/);
});

test("тема письма одно событие или несколько", () => {
  const one = formatWatchLetter([
    { title: "C-Check", aircraft: "RA-1", contour: "Рабочий контур", lines: ["Данные изменены"], link: null }
  ]);
  assert.equal(one.subject, "HVP: изменение «C-Check»");
  assert.match(one.text, /RA-1/);
  assert.match(one.html, /Подписки/);

  const many = formatWatchLetter([
    { title: "A", aircraft: "", contour: "Рабочий контур", lines: ["x"], link: null },
    { title: "B", aircraft: "", contour: "Песочница", lines: ["y"], link: "https://hvp.example/#gantt?event=1" }
  ]);
  assert.equal(many.subject, "HVP: изменения 2 событий");
  assert.match(many.html, /Открыть событие/);
});
