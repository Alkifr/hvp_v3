/** Пакет записи очистки.
 * Интерактивная транзакция Prisma по умолчанию обрывается через 5 с,
 * а один INSERT аудита на весь контур (тысячи строк) держит блокировки до таймаута прокси.
 */
export const CLEANUP_WRITE_BATCH = 200;

export const CLEANUP_TX = { timeout: 25_000, maxWait: 10_000 } as const;

export function chunkList<T>(items: T[], size = CLEANUP_WRITE_BATCH): T[][] {
  if (items.length === 0) return [];
  const step = Math.max(1, size);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}
