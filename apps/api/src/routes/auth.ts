import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import argon2 from "argon2";

import { queryActivityFeed } from "../lib/activityFeed.js";

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

    return await queryActivityFeed(app.prisma, {
      actor: user.email,
      limit: query.limit,
      offset: query.offset,
      action: query.action,
      q: query.q
    });
  });
};

