import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { serializeUserError, userMessageFor, UserMsg } from "./userErrors.js";

test("maps error codes to Russian user text", () => {
  assert.equal(userMessageFor("FORBIDDEN"), UserMsg.FORBIDDEN);
  assert.equal(userMessageFor("SANDBOX_READ_ONLY"), UserMsg.SANDBOX_READ_ONLY);
  assert.equal(userMessageFor("EVENT_NOT_FOUND"), UserMsg.EVENT_NOT_FOUND);
  assert.equal(userMessageFor("PROMOTE_DELETE_DENIED"), UserMsg.PROMOTE_DELETE_DENIED);
  assert.equal(userMessageFor("MUST_CHANGE_PASSWORD"), UserMsg.MUST_CHANGE_PASSWORD);
});

test("maps English throw messages to Russian user text", () => {
  assert.equal(userMessageFor("Event not found"), UserMsg.EVENT_NOT_FOUND);
  assert.equal(userMessageFor("endAt must be after startAt"), UserMsg.END_AFTER_START);
  assert.equal(userMessageFor("changeReason is required when updating an event"), UserMsg.CHANGE_REASON_REQUIRED);
  assert.equal(userMessageFor("Stand does not belong to selected layout"), UserMsg.STAND_NOT_IN_LAYOUT);
});

test("keeps already user-facing Russian text", () => {
  assert.equal(userMessageFor("Место уже занято: C-check"), "Место уже занято: C-check");
});

test("unknown English becomes a generic user message", () => {
  assert.equal(userMessageFor("Cannot read properties of undefined"), UserMsg.INTERNAL);
});

test("serializeUserError: codes become 4xx with user message, no admin notify", () => {
  const err: any = new Error("FORBIDDEN");
  err.statusCode = 403;
  const out = serializeUserError(err);
  assert.equal(out.statusCode, 403);
  assert.equal(out.message, UserMsg.FORBIDDEN);
  assert.equal(out.notifyAdmins, false);
});

test("serializeUserError: English 400-style throw without status is not 500", () => {
  const out = serializeUserError(new Error("Event not found"));
  assert.equal(out.statusCode, 404);
  assert.equal(out.message, UserMsg.EVENT_NOT_FOUND);
  assert.equal(out.notifyAdmins, false);
});

test("serializeUserError: Russian business error without status is 4xx, no notify", () => {
  const out = serializeUserError(new Error("Место уже занято: A320"));
  assert.equal(out.statusCode, 409);
  assert.equal(out.message, "Место уже занято: A320");
  assert.equal(out.notifyAdmins, false);
});

test("serializeUserError: unexpected crash notifies admins and hides internals", () => {
  const out = serializeUserError(new TypeError("Cannot read properties of undefined"));
  assert.equal(out.statusCode, 500);
  assert.equal(out.message, UserMsg.INTERNAL);
  assert.equal(out.notifyAdmins, true);
  assert.match(String(out.adminDetail), /Cannot read properties/);
});

test("serializeUserError: Zod issues become a field-level user message", () => {
  const parsed = z.object({ endAt: z.string() }).safeParse({});
  assert.equal(parsed.success, false);
  const out = serializeUserError(parsed.error);
  assert.equal(out.statusCode, 400);
  assert.equal(out.notifyAdmins, false);
  assert.match(out.message, /Дата окончания|поля/i);
});
