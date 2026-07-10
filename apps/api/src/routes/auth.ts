import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import argon2 from "argon2";

async function requireAuthUser(app: any, req: FastifyRequest, reply: FastifyReply) {
  try {
    const decoded = await req.jwtVerify<{ sub: string }>();
    const user = await app.prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, displayName: true, isActive: true }
    });
    if (!user || !user.isActive) {
      app.clearAuthCookie(reply, req);
      reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
      return null;
    }
    return user;
  } catch {
    reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
    return null;
  }
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (req, reply) => {
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(1).max(200)
      })
      .parse(req.body);

    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.isActive) {
      return reply.code(401).send({ ok: false, error: "INVALID_CREDENTIALS" });
    }

    const ok = await argon2.verify(user.passwordHash, body.password);
    if (!ok) {
      return reply.code(401).send({ ok: false, error: "INVALID_CREDENTIALS" });
    }

    await app.setAuthCookie(reply, req, user.id);
    return { ok: true, mustChangePassword: user.mustChangePassword };
  });

  app.post("/logout", async (req, reply) => {
    app.clearAuthCookie(reply, req);
    return { ok: true };
  });

  app.get("/me", async (req, reply) => {
    try {
      const decoded = await req.jwtVerify<{ sub: string }>();
      const user = await app.prisma.user.findUnique({
        where: { id: decoded.sub },
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }
        }
      });
      if (!user || !user.isActive) {
        app.clearAuthCookie(reply, req);
        return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
      }
      type UserRoleJoin = { role: { code: string; permissions: Array<{ permission: { code: string } }> } };
      const roles = user.roles.map((ur: UserRoleJoin) => ur.role.code);
      const permissions = Array.from(
        new Set(
          user.roles.flatMap((ur: UserRoleJoin) =>
            ur.role.permissions.map((rp: { permission: { code: string } }) => rp.permission.code)
          )
        )
      );

      return {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          roles,
          permissions,
          mustChangePassword: user.mustChangePassword
        }
      };
    } catch {
      return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
    }
  });

  app.post("/change-password", async (req, reply) => {
    const body = z
      .object({
        oldPassword: z.string().min(1).max(200),
        newPassword: z.string().min(8).max(200)
      })
      .parse(req.body);

    let user: { id: string; passwordHash: string; isActive: boolean } | null = null;
    try {
      const decoded = await req.jwtVerify<{ sub: string }>();
      user = await app.prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { id: true, passwordHash: true, isActive: true }
      });
    } catch {
      app.clearAuthCookie(reply, req);
      return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
    }

    if (!user || !user.isActive) {
      app.clearAuthCookie(reply, req);
      return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
    }

    const ok = await argon2.verify(user.passwordHash, body.oldPassword);
    if (!ok) return reply.code(400).send({ ok: false, error: "OLD_PASSWORD_INVALID" });

    const passwordHash = await argon2.hash(body.newPassword);
    await app.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false }
    });

    return { ok: true };
  });

  // Лента активности текущего пользователя: события во всех контурах + операции с песочницами/очисткой
  app.get("/me/activity", async (req, reply) => {
    const user = await requireAuthUser(app, req, reply);
    if (!user) return;

    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        action: z
          .enum(["CREATE", "UPDATE", "RESERVE", "UNRESERVE", "SANDBOX_CREATE", "SANDBOX_DELETE", "CLEANUP"])
          .optional(),
        q: z.string().trim().max(200).optional()
      })
      .parse(req.query);

    const eventActions = new Set(["CREATE", "UPDATE", "RESERVE", "UNRESERVE"]);
    const userActions = new Set(["SANDBOX_CREATE", "SANDBOX_DELETE", "CLEANUP"]);
    const wantEvents = !query.action || eventActions.has(query.action);
    const wantUserLogs = !query.action || userActions.has(query.action);

    const eventWhere: any = { actor: user.email };
    if (query.action && eventActions.has(query.action)) eventWhere.action = query.action;
    if (query.q) {
      eventWhere.OR = [
        { reason: { contains: query.q, mode: "insensitive" } },
        { event: { title: { contains: query.q, mode: "insensitive" } } },
        { sandbox: { name: { contains: query.q, mode: "insensitive" } } }
      ];
    }

    const userLogWhere: any = { actor: user.email };
    if (query.action && userActions.has(query.action)) userLogWhere.action = query.action;
    if (query.q) {
      userLogWhere.OR = [
        { reason: { contains: query.q, mode: "insensitive" } },
        { title: { contains: query.q, mode: "insensitive" } },
        { sandboxName: { contains: query.q, mode: "insensitive" } }
      ];
    }

    const takeWindow = query.limit + query.offset;

    const [eventTotal, userLogTotal, eventItems, userLogItems, eventTotals, userLogTotals] = await Promise.all([
      wantEvents ? app.prisma.maintenanceEventAudit.count({ where: eventWhere }) : Promise.resolve(0),
      wantUserLogs ? app.prisma.userActivityLog.count({ where: userLogWhere }) : Promise.resolve(0),
      wantEvents
        ? app.prisma.maintenanceEventAudit.findMany({
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
        ? app.prisma.userActivityLog.findMany({
            where: userLogWhere,
            orderBy: { createdAt: "desc" },
            take: takeWindow
          })
        : Promise.resolve([]),
      wantEvents
        ? app.prisma.maintenanceEventAudit.groupBy({
            by: ["action"],
            where: { actor: user.email },
            _count: { _all: true }
          })
        : Promise.resolve([]),
      wantUserLogs
        ? app.prisma.userActivityLog.groupBy({
            by: ["action"],
            where: { actor: user.email },
            _count: { _all: true }
          })
        : Promise.resolve([])
    ]);

    const mappedEvents = (eventItems as any[]).map((a) => ({
      id: a.id,
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
    const page = merged.slice(query.offset, query.offset + query.limit);

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
      ok: true,
      total: eventTotal + userLogTotal,
      limit: query.limit,
      offset: query.offset,
      byAction,
      items: page.map((a) => ({
        ...a,
        createdAt: a.createdAt
      }))
    };
  });
};

