import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import argon2 from "argon2";

import { loadSandboxForRequest, sandboxFilter } from "../plugins/sandbox.js";

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
    // Требует авторизации
    if (!req.auth) return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });

    const body = z
      .object({
        oldPassword: z.string().min(1).max(200),
        newPassword: z.string().min(8).max(200)
      })
      .parse(req.body);

    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.id } });
    const ok = await argon2.verify(user.passwordHash, body.oldPassword);
    if (!ok) return reply.code(400).send({ ok: false, error: "OLD_PASSWORD_INVALID" });

    const passwordHash = await argon2.hash(body.newPassword);
    await app.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false }
    });

    return { ok: true };
  });

  // Лента активности текущего пользователя по событиям ТО
  app.get("/me/activity", async (req, reply) => {
    const user = await requireAuthUser(app, req, reply);
    if (!user) return;

    const ok = await loadSandboxForRequest(app, req, reply, user.id);
    if (!ok) return;

    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        action: z.enum(["CREATE", "UPDATE", "RESERVE", "UNRESERVE"]).optional(),
        q: z.string().trim().max(200).optional()
      })
      .parse(req.query);

    const ctx = sandboxFilter(req);
    const where: any = { actor: user.email, sandboxId: ctx.sandboxId };
    if (query.action) where.action = query.action;
    if (query.q) {
      where.OR = [
        { reason: { contains: query.q, mode: "insensitive" } },
        { event: { title: { contains: query.q, mode: "insensitive" } } }
      ];
    }

    const totalsWhere: any = { actor: user.email, sandboxId: ctx.sandboxId };

    const [total, items, totals] = await Promise.all([
      app.prisma.maintenanceEventAudit.count({ where }),
      app.prisma.maintenanceEventAudit.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startAt: true,
              endAt: true,
              aircraft: { select: { tailNumber: true } }
            }
          }
        }
      }),
      app.prisma.maintenanceEventAudit.groupBy({
        by: ["action"],
        where: totalsWhere,
        _count: { _all: true }
      })
    ]);

    const byAction: Record<string, number> = { CREATE: 0, UPDATE: 0, RESERVE: 0, UNRESERVE: 0 };
    for (const g of totals as Array<{ action: string; _count?: { _all?: number } }>) {
      byAction[g.action] = g._count?._all ?? 0;
    }

    return {
      ok: true,
      total,
      limit: query.limit,
      offset: query.offset,
      byAction,
      items: items.map((a: any) => ({
        id: a.id,
        action: a.action,
        reason: a.reason,
        changes: a.changes,
        createdAt: a.createdAt,
        eventId: a.eventId,
        event: a.event
          ? {
              id: a.event.id,
              title: a.event.title,
              startAt: a.event.startAt,
              endAt: a.event.endAt,
              tailNumber: a.event.aircraft?.tailNumber ?? null
            }
          : null
      }))
    };
  });
};

