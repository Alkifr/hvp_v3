import type { PrismaClient } from "@prisma/client";

import { startOfMskDay } from "./mailDigestPeriod.js";

/** Session/xact key1 for scheduled digest; unique among HVP advisory locks. */
export const MAIL_DIGEST_ADVISORY_LOCK = 872341001;

export function canClaimDigestSlot(lastAutoSentAt: Date | null, now = new Date()): boolean {
  if (!lastAutoSentAt) return true;
  return lastAutoSentAt < startOfMskDay(now);
}

/** Stable signed 32-bit key for pg advisory lock (key2). */
export function digestVariantLockKey(variantId: string): number {
  let h = 2166136261;
  for (let i = 0; i < variantId.length; i++) {
    h ^= variantId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/**
 * Захватывает слот автоотправки варианта на текущие сутки МСК.
 * Два инстанса API не смогут оба пройти: advisory xact lock + updateMany.
 * SMTP вызывается уже после commit.
 */
export async function claimScheduledDigestSlot(
  prisma: PrismaClient,
  variantId: string,
  now = new Date()
): Promise<boolean> {
  const cutoff = startOfMskDay(now);
  const lockKey = digestVariantLockKey(variantId);
  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${MAIL_DIGEST_ADVISORY_LOCK}, ${lockKey}) AS locked
    `;
    if (!lockRows[0]?.locked) return false;
    const updated = await tx.mailDigestVariant.updateMany({
      where: {
        id: variantId,
        isActive: true,
        OR: [{ lastAutoSentAt: null }, { lastAutoSentAt: { lt: cutoff } }]
      },
      data: { lastAutoSentAt: now }
    });
    return updated.count > 0;
  });
}
