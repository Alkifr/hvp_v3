import assert from "node:assert/strict";
import test from "node:test";

import { EVENT_STATUS_CATALOG, overlayStatusCatalog } from "./eventStatusCatalog.ts";

test("overlayStatusCatalog добавляет пользовательские статусы", () => {
  const merged = overlayStatusCatalog([
    { code: "IN_PROGRESS", name: "В работе (переименован)", sortOrder: 50, selectable: true },
    {
      code: "ON_HOLD",
      name: "На паузе",
      color: "#64748b",
      sortOrder: 55,
      selectable: true,
      manualOnly: true,
      allowsAutoInProgress: false
    }
  ]);
  const codes = merged.map((item) => item.code);
  assert.ok(codes.includes("ON_HOLD"));
  assert.equal(merged.find((item) => item.code === "IN_PROGRESS")?.name, "В работе (переименован)");
  assert.equal(merged.find((item) => item.code === "ON_HOLD")?.name, "На паузе");
  assert.equal(merged.find((item) => item.code === "ON_HOLD")?.isSystem, false);
  assert.equal(merged.find((item) => item.code === "DONE")?.isSystem, true);
  assert.ok(merged.length > EVENT_STATUS_CATALOG.length);
});

test("overlayStatusCatalog без строк справочника оставляет системные статусы", () => {
  const merged = overlayStatusCatalog(null);
  assert.equal(merged.length, EVENT_STATUS_CATALOG.length);
});
