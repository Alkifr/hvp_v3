import assert from "node:assert/strict";
import test from "node:test";

import { hexLuminance, lightenForDarkText } from "./colorContrast.ts";

test("lightenForDarkText raises dark fills above readable luminance", () => {
  const out = lightenForDarkText("#0b1f4a");
  assert.ok(hexLuminance(out) >= 0.62);
  const raw = out.replace("#", "");
  const r = parseInt(raw.slice(0, 2), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  assert.ok(b > r, "hue stays bluish");
});

test("lightenForDarkText leaves already light fills", () => {
  assert.equal(lightenForDarkText("#c4e8ff").toLowerCase(), "#c4e8ff");
});
