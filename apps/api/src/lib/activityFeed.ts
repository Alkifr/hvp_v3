import { Prisma, type PrismaClient } from "@prisma/client";

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

type PersonnelGroup = { actorId: string | null; workshopId: string; createdAt: Date };

function personnelFilter(actor: string | null, q?: string) {
  const parts = [Prisma.sql`TRUE`];
  if (actor) parts.push(Prisma.sql`u.email = ${actor}`);
  const term = q?.trim();
  if (term) {
    const like = `%${term}%`;
    parts.push(Prisma.sql`(
      w.code ILIKE ${like} OR w.name ILIKE ${like}
      OR c."categoryCode" ILIKE ${like}
      OR COALESCE(u.email, '') ILIKE ${like} OR COALESCE(u."displayName", '') ILIKE ${like}
      OR COALESCE(t."icaoType", '') ILIKE ${like} OR COALESCE(t.name, '') ILIKE ${like}
      OR COALESCE(s.name, '') ILIKE ${like}
    )`);
  }
  return Prisma.join(parts, " AND ");
}

const personnelFrom = Prisma.sql`
  FROM public."PersonnelAvailabilityChange" c
  LEFT JOIN public."User" u ON u.id = c."actorId"
  JOIN public."Workshop" w ON w.id = c."workshopId"
  LEFT JOIN public."AircraftType" t ON t.id = c."aircraftTypeId"
  LEFT JOIN public."Shift" s ON s.id = c."shiftId"
`;

async function countPersonnelGroups(prisma: PrismaClient, actor: string | null, q?: string) {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int AS n FROM (
      SELECT 1
      ${personnelFrom}
      WHERE ${personnelFilter(actor, q)}
      GROUP BY c."actorId", c."workshopId", c."createdAt"
    ) g
  `);
  return Number(rows[0]?.n ?? 0);
}

async function loadPersonnelGroups(prisma: PrismaClient, actor: string | null, q: string | undefined, take: number) {
  const groups = await prisma.$queryRaw<PersonnelGroup[]>(Prisma.sql`
    SELECT c."actorId", c."workshopId", c."createdAt"
    ${personnelFrom}
    WHERE ${personnelFilter(actor, q)}
    GROUP BY c."actorId", c."workshopId", c."createdAt"
    ORDER BY c."createdAt" DESC
    LIMIT ${take}
  `);
  if (!groups.length) return [];
  const lines = await prisma.personnelAvailabilityChange.findMany({
    where: {
      OR: groups.map((group) => ({
        actorId: group.actorId,
        workshopId: group.workshopId,
        createdAt: group.createdAt
      }))
    },
    include: {
      actor: { select: { email: true, displayName: true } },
      workshop: { select: { code: true, name: true } }
    },
    orderBy: [{ date: "asc" }, { categoryCode: "asc" }]
  });
  const shiftIds = [...new Set(lines.map((line) => line.shiftId))];
  const typeIds = [...new Set(lines.map((line) => line.aircraftTypeId))];
  const [shifts, types] = await Promise.all([
    shiftIds.length ? prisma.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, name: true, code: true } }) : [],
    typeIds.length ? prisma.aircraftType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true, icaoType: true } }) : []
  ]);
  const shiftName = new Map(shifts.map((shift) => [shift.id, shift.name || shift.code]));
  const typeName = new Map(types.map((type) => [type.id, type.icaoType || type.name]));
  const byGroup = new Map<string, typeof lines>();
  for (const line of lines) {
    const key = `${line.actorId ?? ""}|${line.workshopId}|${line.createdAt.toISOString()}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), line]);
  }
  return groups.flatMap((group) => {
    const key = `${group.actorId ?? ""}|${group.workshopId}|${new Date(group.createdAt).toISOString()}`;
    const rows = byGroup.get(key) ?? [];
    if (!rows.length) return [];
    const first = rows[0]!;
    const changes: Record<string, unknown> = { kind: "personnelAvailability" };
    for (const row of rows) {
      const day = row.date.toISOString().slice(0, 10).split("-");
      const label = `${day[2]}.${day[1]}.${day[0]} · ${shiftName.get(row.shiftId) ?? "смена"} · ${typeName.get(row.aircraftTypeId) ?? "тип ВС"} · ${row.categoryCode}`;
      changes[label] = { from: row.headcountFrom, to: row.headcountTo };
    }
    const createdAt = new Date(group.createdAt);
    const workshopCode = first.workshop.code || first.workshop.name;
    return [{
      id: `personnel:${key}`,
      actor: first.actor?.email ?? "",
      action: "UPDATE",
      reason: null as string | null,
      changes,
      createdAt,
      eventId: null as string | null,
      event: {
        id: `personnel:${first.workshopId}`,
        title: `Доступный ресурс ${workshopCode}`,
        startAt: createdAt,
        endAt: createdAt,
        tailNumber: null as string | null
      },
      source: {
        kind: "prod" as const,
        sandboxId: null as string | null,
        sandboxName: null as string | null
      }
    }];
  });
}

export async function queryActivityFeed(prisma: PrismaClient, query: ActivityFeedQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const actor = query.actor?.trim() || null;

  const eventActions = new Set(["CREATE", "UPDATE", "RESERVE", "UNRESERVE"]);
  const userActions = new Set(["SANDBOX_CREATE", "SANDBOX_DELETE", "CLEANUP"]);
  const wantEvents = !query.action || eventActions.has(query.action);
  const wantUserLogs = !query.action || userActions.has(query.action);
  const wantPersonnel = !query.action || query.action === "UPDATE";

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

  const [eventTotal, userLogTotal, personnelTotal, personnelActionTotal, eventItems, userLogItems, personnelItems, eventTotals, userLogTotals] = await Promise.all([
    wantEvents ? prisma.maintenanceEventAudit.count({ where: eventWhere }) : Promise.resolve(0),
    wantUserLogs ? prisma.userActivityLog.count({ where: userLogWhere }) : Promise.resolve(0),
    wantPersonnel ? countPersonnelGroups(prisma, actor, query.q) : Promise.resolve(0),
    countPersonnelGroups(prisma, actor),
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
    wantPersonnel ? loadPersonnelGroups(prisma, actor, query.q, takeWindow) : Promise.resolve([]),
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

  const merged = [...mappedEvents, ...mappedUserLogs, ...personnelItems].sort(
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
    byAction[g.action] = (byAction[g.action] ?? 0) + (g._count?._all ?? 0);
  }
  byAction.UPDATE += personnelActionTotal;

  return {
    ok: true as const,
    total: eventTotal + userLogTotal + personnelTotal,
    limit,
    offset,
    byAction,
    items: page.map((a) => ({
      ...a,
      createdAt: a.createdAt
    }))
  };
}
