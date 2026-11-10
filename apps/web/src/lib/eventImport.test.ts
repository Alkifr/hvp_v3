import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFileDuplicateWarnings,
  FILE_DUPLICATE_WARNING_PREFIX,
  rowHasProbableDuplicate,
  type EventImportPreviewRow
} from "./eventImport.ts";

function preview(partial: Partial<EventImportPreviewRow> & Pick<EventImportPreviewRow, "rowIndex">): EventImportPreviewRow {
  return {
    ok: true,
    title: `Событие ${partial.rowIndex}`,
    aircraftTail: "RA-00000",
    aircraftId: "aircraft-1",
    eventTypeId: "type-a",
    startAt: "2026-07-15T06:00:00.000Z",
    endAt: "2026-07-18T15:00:00.000Z",
    warnings: [],
    ...partial
  };
}

test("file duplicates are joined across preview chunks and keep the plan warning", () => {
  const rows = applyFileDuplicateWarnings([
    preview({
      rowIndex: 2,
      title: "Из выгрузки А",
      warnings: [`${FILE_DUPLICATE_WARNING_PREFIX} устаревшее предупреждение пакета.`, "Вероятный дубль в плане: уже есть."]
    }),
    preview({
      rowIndex: 260,
      title: "Из выгрузки Б",
      startAt: "2026-07-17T06:00:00.000Z",
      endAt: "2026-07-20T15:00:00.000Z"
    }),
    preview({
      rowIndex: 261,
      eventTypeId: "type-c",
      title: "Другой тип",
      startAt: "2026-07-17T06:00:00.000Z",
      endAt: "2026-07-20T15:00:00.000Z"
    })
  ]);

  const first = rows[0]?.warnings ?? [];
  const second = rows[1]?.warnings ?? [];
  assert.equal(first.filter((warning) => warning.startsWith(FILE_DUPLICATE_WARNING_PREFIX)).length, 1);
  assert.match(first[1] ?? "", /со строкой 260 «Из выгрузки Б»/);
  assert.match(first[0] ?? "", /Вероятный дубль в плане/);
  assert.match(second[0] ?? "", /со строкой 2 «Из выгрузки А»/);
  assert.equal(rows[2]?.warnings?.length ?? 0, 0);
  assert.equal(rows[0]?.ok, true);
  assert.equal(rowHasProbableDuplicate(rows[0]!), true);
  assert.equal(rowHasProbableDuplicate(rows[1]!), true);
  assert.equal(rowHasProbableDuplicate(rows[2]!), false);
  assert.equal(rowHasProbableDuplicate({ warnings: ["Вероятный дубль в плане: уже есть."] }), true);
});
