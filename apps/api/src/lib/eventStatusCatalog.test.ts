import assert from "node:assert/strict";
import test from "node:test";

import { EventStatus, resolveImportEventStatus } from "./eventStatusCatalog.js";

test("resolves import status by catalog name or code", () => {
  const catalog = [
    { code: EventStatus.DONE, name: "Завершено" },
    { code: EventStatus.APPROVED_BY_CUSTOMER, name: "Согласовано с заказчиком" }
  ];
  assert.equal(resolveImportEventStatus("", catalog), null);
  assert.equal(resolveImportEventStatus("  ", catalog), null);
  assert.equal(resolveImportEventStatus("Завершено", catalog), EventStatus.DONE);
  assert.equal(resolveImportEventStatus("DONE", catalog), EventStatus.DONE);
  assert.equal(resolveImportEventStatus("В работе", catalog), EventStatus.IN_PROGRESS);
  assert.equal(resolveImportEventStatus("нет такого", catalog), null);
});
