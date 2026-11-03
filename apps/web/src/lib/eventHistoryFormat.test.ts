import assert from "node:assert/strict";
import test from "node:test";

import { extractDiffEntries, formatActionLabel, historyCommentRow, historyTableRows, resolveHistoryValue } from "./eventHistoryFormat.ts";

test("imported labor metrics are shown as hours, not missing reservations", () => {
  const entries = extractDiffEntries({
    imported: {
      laborMetrics: [
        { block: "LABOR_BUDGET", department: "ME", manHours: 10 },
        { block: "LABOR_BUDGET", department: "AV", manHours: 0 },
        { block: "LABOR_BUDGET", department: "INT", manHours: 5 },
        { block: "WP_ACTUAL", department: "CAB_REP", manHours: 2 }
      ],
      actualStartAt: "2026-01-02T08:00:00.000Z"
    }
  });
  const labor = entries.find((entry) => entry.rawKey === "laborMetrics");
  assert.ok(labor);
  assert.equal(labor.field, "Трудоёмкость");
  assert.equal(labor.initial, true);
  const text = resolveHistoryValue(labor.rawKey, labor.to);
  assert.equal(text.includes("Резерв отсутствует"), false);
  assert.equal(text, "Бюджет / routine: ME 10, INT 5; Факт / routine: CabRep 2");
});

test("imported labor metrics that are all zero are omitted", () => {
  const entries = extractDiffEntries({
    imported: {
      laborMetrics: [
        { block: "WP_PLAN_MPS", department: "ME", manHours: 0 },
        { block: "WP_PLAN_MPS", department: "AV", manHours: 0 }
      ],
      actualStartAt: "2026-01-02T08:00:00.000Z"
    }
  });
  assert.equal(entries.some((entry) => entry.rawKey === "laborMetrics"), false);
  assert.equal(entries.map((entry) => resolveHistoryValue(entry.rawKey, entry.to)).join(" ").includes("Резерв отсутствует"), false);
});

test("placement history keeps budget and actual periods", () => {
  const [entry] = extractDiffEntries({
    placements: {
      from: [
        {
          startAt: "2026-01-01T08:00:00.000Z",
          endAt: "2026-01-02T08:00:00.000Z",
          origin: "MANUAL"
        }
      ],
      to: [
        {
          startAt: "2026-01-01T08:00:00.000Z",
          endAt: "2026-01-02T08:00:00.000Z",
          origin: "MANUAL",
          budgetStartAt: "2026-01-01T08:00:00.000Z",
          budgetEndAt: "2026-01-03T08:00:00.000Z",
          actualStartAt: "2026-01-04T08:00:00.000Z",
          actualEndAt: "2026-01-05T08:00:00.000Z"
        }
      ]
    }
  });
  const text = resolveHistoryValue(entry?.rawKey, entry?.to);
  assert.match(text, /бюджет 01\.01\.2026 .+ — 03\.01\.2026/);
  assert.match(text, /факт 04\.01\.2026 .+ — 05\.01\.2026/);
});

test("tow history keeps the route for a new interval and a removed one", () => {
  const added = extractDiffEntries({
    tow: {
      add: {
        startAt: "2026-01-01T08:00:00.000Z",
        endAt: "2026-01-01T09:00:00.000Z",
        fromLabel: "МС-1",
        toLabel: "H1"
      }
    }
  });
  assert.match(added[0]?.note ?? "", /МС-1 → H1/);

  const addedMany = extractDiffEntries({
    tow: {
      add: [
        { startAt: "2026-01-01T08:00:00.000Z", endAt: "2026-01-01T08:30:00.000Z", fromLabel: "МС", toLabel: "A1" },
        { startAt: "2026-01-01T15:30:00.000Z", endAt: "2026-01-01T16:00:00.000Z", fromLabel: "A1", toLabel: "МС" }
      ]
    }
  });
  assert.equal(addedMany.length, 2);
  assert.match(addedMany[1]?.note ?? "", /A1 → МС/);

  const removed = extractDiffEntries({
    tow: {
      delete: {
        startAt: "2026-01-01T08:00:00.000Z",
        endAt: "2026-01-01T09:00:00.000Z",
        fromLabel: "H1",
        toLabel: "МС-1"
      }
    }
  });
  assert.equal(removed[0]?.field, "Интервал буксировки удалён");
  assert.match(removed[0]?.note ?? "", /H1 → МС-1/);

  const edited = extractDiffEntries({
    tow: {
      fromLabel: { from: "МС-1", to: "МС-2" },
      toLabel: { from: "H1", to: "H2" },
      placementLabel: { from: "H9 · MC-0", to: "H1 · MC-1" }
    }
  });
  assert.equal(edited.find((entry) => entry.rawKey === "fromLabel")?.to, "МС-2");
  assert.equal(edited.find((entry) => entry.rawKey === "placementLabel")?.field, "Этап размещения");
});

test("history table keeps previous and current versions on one row", () => {
  const [entry] = extractDiffEntries({
    laborMetrics: {
      from: [{ block: "WP_PLAN_MPS", department: "AV", manHours: 1 }],
      to: [{ block: "WP_PLAN_MPS", department: "AV", manHours: 4 }]
    }
  });
  const [row] = historyTableRows(entry!);
  assert.equal(row?.field, "Трудоёмкость");
  assert.equal(row?.previous, "MPS / routine: AV 1");
  assert.equal(row?.current, "MPS / routine: AV 4");
});

test("imported value leaves the previous version empty", () => {
  const entries = extractDiffEntries({
    imported: { actualStartAt: "2026-01-02T08:00:00.000Z" }
  });
  const [row] = historyTableRows(entries[0]!);
  assert.equal(row?.field, "Фактическое начало");
  assert.equal(row?.previous, "");
  assert.match(row?.current ?? "", /02\.01\.2026/);
});

test("change comment is a table row", () => {
  const row = historyCommentRow("Импорт из Excel");
  assert.equal(row.field, "Комментарий");
  assert.equal(row.previous, "");
  assert.equal(row.current, "Импорт из Excel");
});

test("import column names use the card labels", () => {
  const entries = extractDiffEntries({
    imported: {
      Status: "DONE",
      Reason: "Трудности с выдачей",
      LineBase: "BASE",
      Workshop: "ЦПТО3"
    }
  });
  const byField = new Map(entries.map((entry) => [entry.field, historyTableRows(entry)[0]]));
  assert.equal(byField.get("Статус")?.previous, "");
  assert.equal(byField.get("Статус")?.current, "Завершено");
  assert.equal(byField.get("Причина")?.current, "Трудности с выдачей");
  assert.equal(byField.get("L/B")?.current, "B (Base)");
  assert.equal(byField.get("Цех")?.current, "ЦПТО3");
});

test("available resource save is labeled separately from an event update", () => {
  const changes = {
    kind: "personnelAvailability",
    "12.01.2027 · Дневная · A320 CEO · B1": { from: 11, to: 14 }
  };
  const [entry] = extractDiffEntries(changes);
  assert.equal(formatActionLabel("UPDATE", changes), "Изменён доступный ресурс");
  assert.equal(entry?.field, "12.01.2027 · Дневная · A320 CEO · B1");
  assert.equal(resolveHistoryValue(entry?.rawKey, entry?.from), "11");
  assert.equal(resolveHistoryValue(entry?.rawKey, entry?.to), "14");
});

test("manual labor save is a history update with previous and next hours", () => {
  const changes = {
    laborMetrics: {
      from: [{ block: "WP_PLAN_MPS", department: "AV", manHours: 1 }],
      to: [{ block: "WP_PLAN_MPS", department: "AV", manHours: 4 }]
    }
  };
  const [entry] = extractDiffEntries(changes);
  assert.equal(entry?.field, "Трудоёмкость");
  assert.equal(resolveHistoryValue(entry?.rawKey, entry?.from), "MPS / routine: AV 1");
  assert.equal(resolveHistoryValue(entry?.rawKey, entry?.to), "MPS / routine: AV 4");
  assert.equal(formatActionLabel("UPDATE", changes), "Изменена трудоёмкость");
});

test("saving the card does not log dates and placements that only lost seconds", () => {
  const changes = {
    endAt: { from: "2027-03-31T20:59:41.999Z", to: "2027-03-31T20:59:00.000Z" },
    startAt: { from: "2027-03-10T20:59:43.000Z", to: "2027-03-10T20:59:00.000Z" },
    placements: {
      from: [
        {
          endAt: "2027-03-31T20:59:41.999Z",
          startAt: "2027-03-10T20:59:43.000Z",
          hangarId: "h3",
          layoutId: "uni",
          standId: "mc3"
        }
      ],
      to: [
        {
          endAt: "2027-03-31T20:59:00.000Z",
          startAt: "2027-03-10T20:59:00.000Z",
          hangarId: "h3",
          layoutId: "uni",
          standId: "mc3"
        }
      ]
    },
    allowOverlap: { from: false, to: true }
  };
  const entries = extractDiffEntries(changes);
  assert.deepEqual(
    entries.map((entry) => entry.rawKey),
    ["allowOverlap"]
  );
  const [row] = historyTableRows(entries[0]!);
  assert.equal(row?.field, "Разрешить пересечение");
  assert.equal(row?.previous, "нет");
  assert.equal(row?.current, "да");
  assert.equal(formatActionLabel("UPDATE", changes), "Изменено пересечение");
});

test("mass plan history names the strict hangar limit", () => {
  const entries = extractDiffEntries({
    massPlan: {
      placed: true,
      placementMode: "auto",
      strictHangars: true
    }
  });
  const strict = entries.find((entry) => entry.rawKey === "strictHangars");
  assert.equal(strict?.field, "Только выбранные ангары");
  assert.equal(resolveHistoryValue("strictHangars", true), "да");
  assert.equal(resolveHistoryValue("strictHangars", false), "нет");
});
