import assert from "node:assert/strict";
import test from "node:test";

import { formatSmtpError, isSmtpReady, resolveFrom, smtpConfigFromSettings } from "./mailer.js";

const base = {
  smtpHost: "smtp.atechnics.ru",
  smtpPort: 25,
  smtpSecure: false,
  smtpUser: null as string | null,
  smtpPass: null as string | null,
  mailFrom: null as string | null
};

test("SMTP ready without password when From is set", () => {
  assert.equal(isSmtpReady({ ...base, mailFrom: "HVP рассылка (prod) <hvp-prod@atechnics.ru>" }), true);
  assert.equal(isSmtpReady(base), false);
  assert.equal(isSmtpReady({ ...base, smtpHost: null }), false);
});

test("SMTP user can stand in for From", () => {
  assert.equal(isSmtpReady({ ...base, smtpUser: "hvp@atechnics.ru" }), true);
});

test("resolveFrom prefers mailFrom display name", () => {
  const cfg = smtpConfigFromSettings({
    ...base,
    smtpUser: "user@corp.ru",
    mailFrom: "HVP рассылка (prod) <hvp-prod@atechnics.ru>"
  });
  assert.ok(cfg);
  assert.equal(resolveFrom(cfg), "HVP рассылка (prod) <hvp-prod@atechnics.ru>");
});

test("formatSmtpError explains connection timeout", () => {
  const cfg = smtpConfigFromSettings({ ...base, mailFrom: "hvp-ml@atechnics.ru" });
  assert.ok(cfg);
  const text = formatSmtpError({ code: "ETIMEDOUT", message: "Connection timeout" }, cfg);
  assert.match(text, /Таймаут SMTP smtp.atechnics.ru:25/);
  assert.match(text, /файрвол/);
});
