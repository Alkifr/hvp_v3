import type { PrismaClient } from "@prisma/client";

import { MSK_OFFSET_MINUTES } from "./localDate.js";

export const PRESENCE_PAGES = [
  "gantt",
  "hangar",
  "import",
  "mass",
  "ref",
  "profile",
  "admin",
  "sandboxes",
  "analytics",
  "mail",
  "help"
] as const;

export type PresencePage = (typeof PRESENCE_PAGES)[number];
export type PresenceKind = "LOGIN" | "PAGE" | "ACTION" | "PING";

const PAGE_SET = new Set<string>(PRESENCE_PAGES);
const PAGE_DEDUPE_MS = 2 * 60 * 1000;
const ACTION_DEDUPE_MS = 30 * 1000;
const SEEN_TOUCH_MS = 90 * 1000;
export const PRESENCE_RETENTION_DAYS = 90;
export const HEATMAP_DAYS = 119; // 17 недель

function mskParts(d: Date): { y: number; m: number; day: number; hour: number; weekday: number } {
  const shifted = new Date(d.getTime() + MSK_OFFSET_MINUTES * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay()
  };
}

export function mskDayKey(d: Date): string {
  const p = mskParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function startOfMskDayUtc(d: Date): Date {
  const p = mskParts(d);
  return new Date(Date.UTC(p.y, p.m - 1, p.day) - MSK_OFFSET_MINUTES * 60_000);
}

function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400_000);
}

export function heatmapDayRange(now = new Date(), days = HEATMAP_DAYS): { from: Date; keys: string[] } {
  const todayStart = startOfMskDayUtc(now);
  const from = addUtcDays(todayStart, -(days - 1));
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    keys.push(mskDayKey(addUtcDays(from, i)));
  }
  return { from, keys };
}

function sanitizePage(page: unknown): PresencePage | null {
  const v = String(page ?? "").trim();
  return PAGE_SET.has(v) ? (v as PresencePage) : null;
}

function sanitizeDetail(detail: unknown): string | null {
  const v = String(detail ?? "").trim().slice(0, 160);
  return v || null;
}

export async function touchLastSeen(prisma: PrismaClient, userId: string, now = new Date()): Promise<void> {
  const threshold = new Date(now.getTime() - SEEN_TOUCH_MS);
  await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }]
    },
    data: { lastSeenAt: now }
  });
}

export async function recordLogin(prisma: PrismaClient, userId: string, now = new Date()): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: now, lastSeenAt: now }
    }),
    prisma.userPresenceEvent.create({
      data: { userId, kind: "LOGIN", page: null, detail: null, createdAt: now }
    })
  ]);
}

export async function recordPresence(
  prisma: PrismaClient,
  params: { userId: string; kind: PresenceKind; page?: unknown; detail?: unknown },
  now = new Date()
): Promise<{ recorded: boolean }> {
  if (params.kind === "PING") {
    await touchLastSeen(prisma, params.userId, now);
    return { recorded: false };
  }

  const page = params.kind === "PAGE" ? sanitizePage(params.page) : sanitizePage(params.page);
  if (params.kind === "PAGE" && !page) return { recorded: false };

  const detail = sanitizeDetail(params.detail);
  const dedupeMs = params.kind === "ACTION" ? ACTION_DEDUPE_MS : PAGE_DEDUPE_MS;
  const since = new Date(now.getTime() - dedupeMs);

  const dup = await prisma.userPresenceEvent.findFirst({
    where: {
      userId: params.userId,
      kind: params.kind,
      page: page ?? null,
      detail: detail ?? null,
      createdAt: { gte: since }
    },
    select: { id: true }
  });
  if (dup) {
    await touchLastSeen(prisma, params.userId, now);
    return { recorded: false };
  }

  await prisma.$transaction([
    prisma.userPresenceEvent.create({
      data: {
        userId: params.userId,
        kind: params.kind,
        page,
        detail,
        createdAt: now
      }
    }),
    prisma.user.update({
      where: { id: params.userId },
      data: { lastSeenAt: now }
    })
  ]);
  return { recorded: true };
}

export async function prunePresenceEvents(prisma: PrismaClient, now = new Date()): Promise<number> {
  const cutoff = addUtcDays(now, -PRESENCE_RETENTION_DAYS);
  const res = await prisma.userPresenceEvent.deleteMany({
    where: { createdAt: { lt: cutoff } }
  });
  return res.count;
}

export type PresenceHeatmap = {
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  days: Array<{ date: string; count: number; logins: number; pages: number; edits: number }>;
  hours: number[][];
  pages: Array<{ page: string; count: number }>;
  recent: Array<{ createdAt: string; kind: string; page: string | null; detail: string | null }>;
};

export async function queryPresenceHeatmap(
  prisma: PrismaClient,
  params: { userId: string; email: string; now?: Date }
): Promise<PresenceHeatmap> {
  const now = params.now ?? new Date();
  const { from, keys } = heatmapDayRange(now);
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { lastLoginAt: true, lastSeenAt: true }
  });

  const [presence, audits] = await Promise.all([
    prisma.userPresenceEvent.findMany({
      where: { userId: params.userId, createdAt: { gte: from } },
      select: { createdAt: true, kind: true, page: true, detail: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.maintenanceEventAudit.findMany({
      where: { actor: params.email, createdAt: { gte: from } },
      select: { createdAt: true }
    })
  ]);

  const dayMap = new Map(keys.map((date) => [date, { date, count: 0, logins: 0, pages: 0, edits: 0 }]));
  const hours = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const pageCounts = new Map<string, number>();

  for (const row of presence) {
    const key = mskDayKey(row.createdAt);
    const bucket = dayMap.get(key);
    if (bucket) {
      bucket.count += 1;
      if (row.kind === "LOGIN") bucket.logins += 1;
      if (row.kind === "PAGE") bucket.pages += 1;
    }
    const p = mskParts(row.createdAt);
    hours[p.weekday]![p.hour]! += 1;
    if (row.page) pageCounts.set(row.page, (pageCounts.get(row.page) ?? 0) + 1);
  }

  for (const row of audits) {
    const key = mskDayKey(row.createdAt);
    const bucket = dayMap.get(key);
    if (bucket) {
      bucket.edits += 1;
      bucket.count += 1;
    }
    const p = mskParts(row.createdAt);
    hours[p.weekday]![p.hour]! += 1;
  }

  return {
    lastLoginAt: user?.lastLoginAt?.toISOString() ?? null,
    lastSeenAt: user?.lastSeenAt?.toISOString() ?? null,
    days: keys.map((k) => dayMap.get(k)!),
    hours,
    pages: [...pageCounts.entries()]
      .map(([page, count]) => ({ page, count }))
      .sort((a, b) => b.count - a.count),
    recent: presence.slice(0, 40).map((r) => ({
      createdAt: r.createdAt.toISOString(),
      kind: r.kind,
      page: r.page,
      detail: r.detail
    }))
  };
}
