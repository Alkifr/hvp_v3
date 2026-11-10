import assert from "node:assert/strict";
import test from "node:test";

import {
  auditsForRecipient,
  describeAudit,
  formatWatchLetter,
  loadWatchLabels,
  isCleanupAuditNote,
  notesFromAuditWrite,
  summarizeChanges,
  type WatchLabels
} from "./eventWatchMail.js";

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

test("аудит массовой очистки не уходит в рассылку подписчикам", () => {
  const notes = notesFromAuditWrite(
    "createMany",
    {
      data: [
        {
          eventId: "e1",
          action: "UPDATE",
          actor: "a@b.c",
          changes: { status: { from: "IN_PROGRESS", to: "DELETED" }, cleanup: { mode: "logical-delete" } }
        },
        { eventId: "e2", action: "UPDATE", actor: "a@b.c", changes: { status: { from: "IN_PROGRESS", to: "HOLD" } } }
      ]
    },
    { count: 2 }
  );
  assert.equal(notes.length, 2);
  assert.equal(notes.filter((note) => !isCleanupAuditNote(note)).length, 1);
  assert.equal(isCleanupAuditNote(notes[0]!), true);
  assert.equal(isCleanupAuditNote(notes[1]!), false);
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

const HANGAR_A = "11111111-1111-4111-8111-111111111111";
const HANGAR_B = "22222222-2222-4222-8222-222222222222";
const LAYOUT_A = "33333333-3333-4333-8333-333333333333";
const STAND_A = "44444444-4444-4444-8444-444444444444";
const AIRCRAFT = "55555555-5555-4555-8555-555555555555";
const MISSING = "66666666-6666-4666-8666-666666666666";

function labels(partial: Partial<WatchLabels> = {}): WatchLabels {
  return {
    hangars: new Map(),
    layouts: new Map(),
    stands: new Map(),
    aircraft: new Map(),
    eventTypes: new Map(),
    workshops: new Map(),
    statuses: new Map(),
    aircraftTypes: new Map(),
    operators: new Map(),
    ...partial
  };
}

test("summarizeChanges подставляет названия вместо id и кодов", () => {
  const lines = summarizeChanges(
    {
      hangarId: { from: HANGAR_A, to: HANGAR_B },
      aircraftId: { from: null, to: AIRCRAFT },
      status: { from: "IN_PROGRESS", to: "HOLD" },
      level: { from: "OPERATIONAL", to: "STRATEGIC" },
      planningKind: { from: "UNPLANNED", to: "PLANNED" },
      lineBase: { from: "LINE", to: "BASE" },
      title: { from: "Старое", to: "Новое" }
    },
    labels({
      hangars: new Map([
        [HANGAR_A, "Ангар A"],
        [HANGAR_B, "Ангар B"]
      ]),
      aircraft: new Map([[AIRCRAFT, "RA-12345"]]),
      statuses: new Map([["HOLD", "Отложено"]])
    })
  );
  assert.equal(lines[0], "Ангар: Ангар A → Ангар B");
  assert.equal(lines[1], "Борт: — → RA-12345");
  assert.equal(lines[2], "Статус: В работе → Отложено");
  assert.equal(lines[3], "Уровень: Оперативный → Стратегический");
  assert.equal(lines[4], "Вид планирования: Внеплановое → Плановое");
  assert.equal(lines[5], "L/B: L (Line) → B (Base)");
  assert.equal(lines[6], "Название: Старое → Новое");
  assert.equal(lines.join("\n").includes(HANGAR_A), false);
});

test("резерв и неизвестный id не попадают в письмо как идентификаторы", () => {
  const lines = summarizeChanges(
    {
      hangarId: { from: MISSING, to: HANGAR_A },
      reservation: {
        from: null,
        to: {
          layoutId: LAYOUT_A,
          standId: STAND_A,
          startAt: "2026-11-01T06:00:00.000Z",
          endAt: "2026-11-02T06:00:00.000Z"
        }
      }
    },
    labels({
      hangars: new Map([[HANGAR_A, "Ангар A"]]),
      layouts: new Map([[LAYOUT_A, "Ангар A / Схема 1"]]),
      stands: new Map([[STAND_A, "S1"]])
    })
  );
  const text = lines.join("\n");
  assert.match(lines[0] ?? "", /не найдено → Ангар A/);
  assert.match(lines[1] ?? "", /Ангар A \/ Схема 1/);
  assert.match(lines[1] ?? "", /место S1/);
  assert.equal(text.includes(MISSING), false);
  assert.equal(text.includes(LAYOUT_A), false);
  assert.equal(text.includes(STAND_A), false);
});

test("loadWatchLabels запрашивает только встретившиеся ссылки", async () => {
  const seen: Record<string, string[]> = {};
  const prisma = {
    hangar: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        seen.hangar = where.id.in;
        return [{ id: HANGAR_A, name: "Ангар A" }];
      }
    },
    hangarLayout: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        seen.layout = where.id.in;
        return [{ id: LAYOUT_A, name: "Схема 1", hangar: { name: "Ангар A" } }];
      }
    },
    hangarStand: { findMany: async () => [] },
    aircraft: { findMany: async () => [] },
    eventType: { findMany: async () => [] },
    workshop: { findMany: async () => [] },
    eventStatusCatalog: {
      findMany: async ({ where }: { where: { code: { in: string[] } } }) => {
        seen.status = where.code.in;
        return [{ code: "HOLD", name: "Отложено" }];
      }
    },
    aircraftType: { findMany: async () => [] },
    operator: { findMany: async () => [] }
  };
  const loaded = await loadWatchLabels(prisma as never, [
    {
      changes: {
        hangarId: { from: HANGAR_A, to: HANGAR_A },
        status: { from: "IN_PROGRESS", to: "HOLD" },
        reservation: { to: { layoutId: LAYOUT_A, standId: null } }
      }
    }
  ]);
  assert.deepEqual(seen.hangar, [HANGAR_A]);
  assert.deepEqual(seen.layout, [LAYOUT_A]);
  assert.deepEqual(seen.status?.sort(), ["HOLD", "IN_PROGRESS"]);
  assert.equal(loaded.hangars.get(HANGAR_A), "Ангар A");
  assert.equal(loaded.layouts.get(LAYOUT_A), "Ангар A / Схема 1");
  assert.equal(loaded.statuses.get("HOLD"), "Отложено");
  assert.equal(seen.stand, undefined);
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
