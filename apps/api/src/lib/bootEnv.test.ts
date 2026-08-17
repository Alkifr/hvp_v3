import assert from "node:assert/strict";
import test from "node:test";

import { assertBootEnv, parseCorsOrigins, resolveJwtSecret } from "./bootEnv.js";

test("parseCorsOrigins: production without list disables reflection", () => {
  assert.equal(parseCorsOrigins("", "production"), false);
  assert.deepEqual(parseCorsOrigins("https://hvp.example.com, https://app.example.com", "production"), [
    "https://hvp.example.com",
    "https://app.example.com"
  ]);
});

test("parseCorsOrigins: development without list reflects request origin", () => {
  assert.equal(parseCorsOrigins(undefined, "development"), true);
});

test("resolveJwtSecret rejects weak secrets in production", () => {
  assert.throws(() => resolveJwtSecret("", "production"));
  assert.throws(() => resolveJwtSecret("change_me_dev_secret", "production"));
  assert.throws(() => resolveJwtSecret("short", "production"));
  assert.equal(resolveJwtSecret("abcdefghijklmnopqrstuvwx", "production"), "abcdefghijklmnopqrstuvwx");
});

test("assertBootEnv requires DATABASE_CLOUD_URL", () => {
  assert.throws(() => assertBootEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv));
  const cfg = assertBootEnv({
    NODE_ENV: "development",
    DATABASE_CLOUD_URL: "postgresql://localhost/hvp"
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.corsOrigin, true);
  assert.ok(cfg.jwtSecret.length > 0);
});
