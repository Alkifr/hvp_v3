import type { PrismaClient } from "@prisma/client";

export const ACTIVITY_ACTIONS = [
  "CREATE",
  "UPDATE",
  "RESERVE",
  "UNRESERVE",
  "SANDBOX_CREATE",
  "SANDBOX_DELETE",
  "CLEANUP"
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export type ActivityFeedQuery = {
  /** Email актёра. Если не задан — все пользователи. */
  actor?: string | null;
  limit?: number;
  offset?: number;
  action?: ActivityAction;
  q?: string;
};

export async function queryActivityFeed(prisma: PrismaClient, query: ActivityFeedQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const actor = query.actor?.trim() || null;

  const eventActions = new Set(["CREATE", "UPDATE", "RESERVE", "UNRESERVE"]);
  const userActions = new Set(["SANDBOX_CREATE", "SANDBOX_DELETE", "CLEANUP"]);
  const wantEvents = !query.action || eventActions.has(query.action);
  const wantUserLogs = !query.action || userActions.has(query.action);

  const eventWhere: any = {};
  if (actor) eventWhere.actor = actor;
  if (query.action && eventActions.has(query.action)) eventWhere.action = query.action;
  if (query.q) {
    eventWhere.OR = [
      { reason: { contains: query.q, mode: "insensitive" } },
      { actor: { contains: query.q, mode: "insensitive" } },
      { event: { title: { contains: query.q, mode: "insensitive" } } },
      { sandbox: { name: { contains: query.q, mode: "insensitive" } } }
    ];
  }

  const userLogWhere: any = {};
  if (actor) userLogWhere.actor = actor;
  if (query.action && userActions.has(query.action)) userLogWhere.action = query.action;
  if (query.q) {
    userLogWhere.OR = [
      { reason: { contains: query.q, mode: "insensitive" } },
      { actor: { contains: query.q, mode: "insensitive" } },
      { title: { contains: query.q, mode: "insensitive" } },
      { sandboxName: { contains: query.q, mode: "insensitive" } }
    ];
  }

  const takeWindow = limit + offset;
  const totalsWhereEvent = actor ? { actor } : {};
  const totalsWhereUser = actor ? { actor } : {};

  const [eventTotal, userLogTotal, eventItems, userLogItems, eventTotals, userLogTotals] = await Promise.all([
    wantEvents ? prisma.maintenanceEventAudit.count({ where: eventWhere }) : Promise.resolve(0),
    wantUserLogs ? prisma.userActivityLog.count({ where: userLogWhere }) : Promise.resolve(0),
    wantEvents
      ? prisma.maintenanceEventAudit.findMany({
          where: eventWhere,
          orderBy: { createdAt: "desc" },
          take: takeWindow,
          include: {
            event: {
              select: {
                id: true,
                title: true,
                startAt: true,
                endAt: true,
                aircraft: { select: { tailNumber: true } }
              }
            },
            sandbox: { select: { id: true, name: true } }
          }
        })
      : Promise.resolve([]),
    wantUserLogs
      ? prisma.userActivityLog.findMany({
          where: userLogWhere,
          orderBy: { createdAt: "desc" },
          take: takeWindow
        })
      : Promise.resolve([]),
    wantEvents
      ? prisma.maintenanceEventAudit.groupBy({
          by: ["action"],
          where: totalsWhereEvent,
          _count: { _all: true }
        })
      : Promise.resolve([]),
    wantUserLogs
      ? prisma.userActivityLog.groupBy({
          by: ["action"],
          where: totalsWhereUser,
          _count: { _all: true }
        })
      : Promise.resolve([])
  ]);

  const mappedEvents = (eventItems as any[]).map((a) => ({
    id: a.id,
    actor: a.actor as string,
    action: a.action as string,
    reason: a.reason as string | null,
    changes: a.changes,
    createdAt: a.createdAt as Date,
    eventId: a.eventId as string | null,
    event: a.event
      ? {
          id: a.event.id,
          title: a.event.title,
          startAt: a.event.startAt,
          endAt: a.event.endAt,
          tailNumber: a.event.aircraft?.tailNumber ?? null
        }
      : null,
    source: {
      kind: a.sandboxId ? ("sandbox" as const) : ("prod" as const),
      sandboxId: a.sandboxId ?? a.sandbox?.id ?? null,
      sandboxName: a.sandbox?.name ?? null
    }
  }));

  const mappedUserLogs = (userLogItems as any[]).map((a) => ({
    id: a.id,
    actor: a.actor as string,
    action: a.action as string,
    reason: a.reason as string | null,
    changes: a.changes,
    createdAt: a.createdAt as Date,
    eventId: null as string | null,
    event: a.title
      ? {
          id: a.id,
          title: a.title as string,
          startAt: a.createdAt as Date,
          endAt: a.createdAt as Date,
          tailNumber: null as string | null
        }
      : null,
    source: {
      kind: (a.sourceKind === "sandbox" || a.sandboxId ? "sandbox" : "prod") as "sandbox" | "prod",
      sandboxId: (a.sandboxId as string | null) ?? null,
      sandboxName: (a.sandboxName as string | null) ?? null
    }
  }));

  const merged = [...mappedEvents, ...mappedUserLogs].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id)
  );
  const page = merged.slice(offset, offset + limit);

  const byAction: Record<string, number> = {
    CREATE: 0,
    UPDATE: 0,
    RESERVE: 0,
    UNRESERVE: 0,
    SANDBOX_CREATE: 0,
    SANDBOX_DELETE: 0,
    CLEANUP: 0
  };
  for (const g of eventTotals as Array<{ action: string; _count?: { _all?: number } }>) {
    byAction[g.action] = g._count?._all ?? 0;
  }
  for (const g of userLogTotals as Array<{ action: string; _count?: { _all?: number } }>) {
    byAction[g.action] = g._count?._all ?? 0;
  }

  return {
    ok: true as const,
    total: eventTotal + userLogTotal,
    limit,
    offset,
    byAction,
    items: page.map((a) => ({
      ...a,
      createdAt: a.createdAt
    }))
  };
}
