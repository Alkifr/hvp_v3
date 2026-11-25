export function assertFreshUpdatedAt(current: Date, base: Date | null | undefined) {
  if (!base) return;
  if (current.getTime() === base.getTime()) return;
  const err: Error & { statusCode?: number; updatedAt?: string } = new Error("STALE_WRITE");
  err.statusCode = 409;
  err.updatedAt = current.toISOString();
  throw err;
}
