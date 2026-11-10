import assert from "node:assert/strict";
import test from "node:test";

import { CLEANUP_APPLY_CHUNK, applyCleanupChunks, chunkIds } from "./cleanupBatch.js";

test("chunkIds держит пакет короче таймаута прокси", () => {
  const ids = Array.from({ length: 3120 }, (_, i) => `e${i}`);
  const chunks = chunkIds(ids);
  assert.ok(CLEANUP_APPLY_CHUNK <= 400);
  assert.equal(chunks.length, Math.ceil(3120 / CLEANUP_APPLY_CHUNK));
  assert.equal(chunks[0]?.length, CLEANUP_APPLY_CHUNK);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.length, 0), 3120);
});

test("applyCleanupChunks суммирует пакеты и останавливается на ошибке", async () => {
  const seen: string[][] = [];
  const progress: number[] = [];
  const ids = ["a", "b", "c", "d", "e"];
  const res = await applyCleanupChunks({
    ids,
    size: 2,
    post: async (chunk) => {
      seen.push(chunk);
      return { updated: chunk.length };
    },
    onProgress: (done) => progress.push(done)
  });
  assert.deepEqual(seen, [
    ["a", "b"],
    ["c", "d"],
    ["e"]
  ]);
  assert.deepEqual(progress, [0, 2, 4, 5]);
  assert.equal(res.updated, 5);

  const partial: string[][] = [];
  await assert.rejects(
    () =>
      applyCleanupChunks({
        ids,
        size: 2,
        post: async (chunk) => {
          partial.push(chunk);
          if (partial.length > 1) throw new Error("сеть");
          return { updated: chunk.length };
        }
      }),
    /сеть/
  );
  assert.equal(partial.length, 2);
});
