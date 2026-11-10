/** Сколько событий уходит в один HTTP-запрос очистки.
 * Пакет короче типичного idle-timeout прокси (30–60 с): сервер пишет его отдельными транзакциями.
 */
export const CLEANUP_APPLY_CHUNK = 400;

export function chunkIds<T>(items: T[], size = CLEANUP_APPLY_CHUNK): T[][] {
  if (items.length === 0) return [];
  const step = Math.max(1, size);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

export async function applyCleanupChunks(params: {
  ids: string[];
  size?: number;
  post: (ids: string[]) => Promise<{ updated: number }>;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ updated: number }> {
  const total = params.ids.length;
  const chunks = chunkIds(params.ids, params.size ?? CLEANUP_APPLY_CHUNK);
  let updated = 0;
  let done = 0;
  params.onProgress?.(0, total);
  for (const chunk of chunks) {
    const res = await params.post(chunk);
    updated += res.updated;
    done += chunk.length;
    params.onProgress?.(done, total);
  }
  return { updated };
}
