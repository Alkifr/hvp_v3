import assert from "node:assert/strict";
import test from "node:test";

import { pgRoleNameFromEmail, publicDbTarget, quoteIdent, quoteLiteral } from "./pgAccess.js";

test("pgRoleNameFromEmail is a stable postgres identifier", () => {
  const a = pgRoleNameFromEmail("ivan.petrov@corp.local");
  const b = pgRoleNameFromEmail("Ivan.Petrov@CORP.local");
  assert.equal(a, b);
  assert.match(a, /^[a-z][a-z0-9_]{0,62}$/);
  assert.ok(a.startsWith("hvp_ro_"));
  assert.notEqual(pgRoleNameFromEmail("ivan@corp.local"), pgRoleNameFromEmail("ivan@other.local"));
});

test("quoteIdent and quoteLiteral escape safely", () => {
  assert.equal(quoteIdent("hvp_ro_ivan_ab12cd"), '"hvp_ro_ivan_ab12cd"');
  assert.equal(quoteIdent("User"), '"User"');
  assert.equal(quoteLiteral("a'b"), "'a''b'");
  assert.throws(() => quoteIdent("drop table;"));
  assert.throws(() => quoteLiteral("x\u0000y"));
});

test("publicDbTarget reads database and port without exposing host", () => {
  const t = publicDbTarget("postgresql://hangar:secret@db.internal:5433/hangar_planning?schema=public");
  assert.equal(t.database, "hangar_planning");
  assert.equal(t.port, 5433);
  const fallback = publicDbTarget("");
  assert.equal(fallback.database, "hangar_planning");
  assert.equal(fallback.port, 5432);
});
