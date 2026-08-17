import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveWebDist } from "./webDist.js";

test("resolveWebDist uses WEB_DIST when index.html exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hvp-web-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
  assert.equal(resolveWebDist("/tmp", dir), dir);
});

test("resolveWebDist returns null when nothing is built", () => {
  assert.equal(resolveWebDist("/tmp/does-not-exist-hvp", ""), null);
});
