import assert from "node:assert/strict";
import test from "node:test";

import { CLEANUP_WRITE_BATCH, chunkList } from "./cleanupBatch.js";

test("chunkList режет список пакетами и не теряет хвост", () => {
  assert.deepEqual(chunkList([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkList([], 2), []);
  assert.deepEqual(chunkList(["a"], 10), [["a"]]);
});

test("очистка контура из 3120 событий не собирается в один пакет", () => {
  const ids = Array.from({ length: 3120 }, (_, i) => i);
  const chunks = chunkList(ids);
  assert.ok(CLEANUP_WRITE_BATCH <= 250);
  assert.equal(chunks.length, Math.ceil(3120 / CLEANUP_WRITE_BATCH));
  assert.equal(chunks[0]?.length, CLEANUP_WRITE_BATCH);
  assert.equal(chunks.at(-1)?.length, 3120 % CLEANUP_WRITE_BATCH);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.length, 0), 3120);
});
