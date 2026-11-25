import type { PrismaClient } from "@prisma/client";

import { publishLive } from "./liveBus.js";

type UserLookup = Pick<PrismaClient, "user">;

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; ids: string[] }>();

async function recipientIds(prisma: UserLookup, adminOnly: boolean): Promise<string[]> {
  const key = adminOnly ? "admin" : "all";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;
  const rows = await prisma.user.findMany({
    where: adminOnly
      ? { isActive: true, roles: { some: { role: { code: { in: ["ADMIN", "SUPER_ADMIN"] } } } } }
      : { isActive: true },
    select: { id: true }
  });
  const ids = rows.map((row) => row.id);
  cache.set(key, { at: Date.now(), ids });
  return ids;
}

/** Колокольчик общий, получатель — каждый активный пользователь (ошибки — только администраторы). */
export async function publishBell(prisma: UserLookup, opts?: { adminOnly?: boolean }) {
  const ids = await recipientIds(prisma, Boolean(opts?.adminOnly));
  for (const id of ids) {
    publishLive({ topic: "notifications", scope: `user:${id}` });
  }
}
