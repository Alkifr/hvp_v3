import type { PrismaClient } from "@prisma/client";

import { startOfMskDay } from "./mailDigestPeriod.js";

/** Session/xact key for scheduled digest; unique among HVP advisory locks. */
export const MAIL_DIGEST_ADVISORY_LOCK = 872341001;

export function canClaimDigestSlot(lastAutoSentAt: Date | null, now = new Date()): boolean {
  if (!lastAutoSentAt) return true;
  return lastAutoSentAt < startOfMskDay(now);
}

/**
 * Захватывает слот автоотправки на текущие сутки МСК.
 * Два инстанса API не смогут оба пройти: advisory xact lock + updateMany.
 * SMTP вызывается уже после commit.
 */
export async function claimScheduledDigestSlot(prisma: PrismaClient, now = new Date()): Promise<boolean> {
  const cutoff = startOfMskDay(now);
  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${MAIL_DIGEST_ADVISORY_LOCK}) AS locked
    `;
    if (!lockRows[0]?.locked) return false;
    const updated = await tx.mailDigestSettings.updateMany({
      where: {
        id: "default",
        isActive: true,
        OR: [{ lastAutoSentAt: null }, { lastAutoSentAt: { lt: cutoff } }]
      },
      data: { lastAutoSentAt: now }
    });
    return updated.count > 0;
  });
}
