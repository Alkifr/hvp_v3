import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import argon2 from "argon2";

import { queryActivityFeed } from "../lib/activityFeed.js";
import { errorBody } from "../lib/userErrors.js";
import { recordLogin } from "../lib/userPresence.js";

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX = 10;
const loginHits = new Map<string, { n: number; resetAt: number }>();

function loginClientKey(req: FastifyRequest): string {
  return String(req.ip || req.headers["x-forwarded-for"] || "unknown");
}

function assertLoginRateLimit(req: FastifyRequest) {
  const key = loginClientKey(req);
  const now = Date.now();
  const cur = loginHits.get(key);
  if (!cur || now >= cur.resetAt) {
    loginHits.set(key, { n: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  cur.n += 1;
  if (cur.n > LOGIN_MAX) {
    const err: any = new Error("TOO_MANY_REQUESTS");
    err.statusCode = 429;
    throw err;
  }
}

async function requireAuthUser(app: any, req: FastifyRequest, reply: FastifyReply) {
  try {
    const decoded = await req.jwtVerify<{ sub: string }>();
    const user = await app.prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, displayName: true, isActive: true }
    });
    if (!user || !user.isActive) {
      app.clearAuthCookie(reply, req);
      reply.code(401).send(errorBody("UNAUTHORIZED"));
      return null;
    }
    return user;
  } catch {
    reply.code(401).send(errorBody("UNAUTHORIZED"));
    return null;
  }
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (req, reply) => {
    assertLoginRateLimit(req);
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(1).max(200)
      })
      .parse(req.body);

    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.isActive) {
      return reply.code(401).send(errorBody("INVALID_CREDENTIALS"));
    }

    const ok = await argon2.verify(user.passwordHash, body.password);
    if (!ok) {
      return reply.code(401).send(errorBody("INVALID_CREDENTIALS"));
    }

    await app.setAuthCookie(reply, req, user.id);
    await recordLogin(app.prisma, user.id).catch((err) => {
      req.log.warn({ err }, "failed to record login presence");
    });
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
        return reply.code(401).send(errorBody("UNAUTHORIZED"));
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
      return reply.code(401).send(errorBody("UNAUTHORIZED"));
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
      return reply.code(401).send(errorBody("UNAUTHORIZED"));
    }

    if (!user || !user.isActive) {
      app.clearAuthCookie(reply, req);
      return reply.code(401).send(errorBody("UNAUTHORIZED"));
    }

    const ok = await argon2.verify(user.passwordHash, body.oldPassword);
    if (!ok) return reply.code(400).send(errorBody("OLD_PASSWORD_INVALID"));

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

