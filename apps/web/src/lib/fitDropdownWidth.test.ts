import assert from "node:assert/strict";
import test from "node:test";

import { fitDropdownWidth } from "./fitDropdownWidth.ts";

test("fitDropdownWidth grows with the longest label and stays within cap", () => {
  const short = fitDropdownWidth(["все", "ME"]);
  const long = fitDropdownWidth(["все", "На согласовании с исполнителем"]);
  assert.ok(long > short);
  assert.ok(long <= 200);
  assert.ok(short >= 64);
});
