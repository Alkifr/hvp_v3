import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import argon2 from "argon2";

import { queryActivityFeed } from "../lib/activityFeed.js";
import { errorBody } from "../lib/userErrors.js";
import { dbAccessPayload } from "../lib/pgAccess.js";
import { HOME_PAGES, NOTIFICATION_KINDS, parseHomePage, parseMutedNotificationKinds } from "../lib/userPrefs.js";
import { queryMyPresence, recordLogin } from "../lib/userPresence.js";
import { getRuntimeConfig } from "../lib/writeBlocked.js";

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

const ME_INCLUDE = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }
} as const;

type UserRoleJoin = { role: { code: string; permissions: Array<{ permission: { code: string } }> } };

function meUserPayload(user: {
  id: string;
  email: string;
  displayName: string | null;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
  homePage: string | null;
  mutedNotificationKinds: unknown;
  dbAccessEnabled: boolean;
  pgRoleName: string | null;
  pgPassword: string | null;
  roles: UserRoleJoin[];
}) {
  const roles = user.roles.map((ur) => ur.role.code);
  const permissions = Array.from(
    new Set(user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)))
  );
  return {
    ok: true as const,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles,
      permissions,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
      homePage: parseHomePage(user.homePage),
      mutedNotificationKinds: parseMutedNotificationKinds(user.mutedNotificationKinds),
      dbAccess: dbAccessPayload(user, process.env.DATABASE_CLOUD_URL)
    }
  };
}

async function requireAuthUser(app: any, req: FastifyRequest, reply: FastifyReply) {
  try {
    const decoded = await req.jwtVerify<{ sub: string; ver?: number }>();
    const user = await app.prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, displayName: true, isActive: true, tokenVersion: true }
    });
    if (!user || !user.isActive || (decoded.ver ?? 0) !== (user.tokenVersion ?? 0)) {
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
      const decoded = await req.jwtVerify<{ sub: string; ver?: number }>();
      const user = await app.prisma.user.findUnique({
        where: { id: decoded.sub },
        include: ME_INCLUDE
      });
      if (!user || !user.isActive || (decoded.ver ?? 0) !== (user.tokenVersion ?? 0)) {
        app.clearAuthCookie(reply, req);
        return reply.code(401).send(errorBody("UNAUTHORIZED"));
      }
      const runtime = await getRuntimeConfig(app.prisma);
      const payload = meUserPayload(user);
      return { ...payload, user: { ...payload.user, writeBlocked: runtime.writeBlocked } };
    } catch {
      return reply.code(401).send(errorBody("UNAUTHORIZED"));
    }
  });

  app.patch("/me", async (req, reply) => {
    const user = await requireAuthUser(app, req, reply);
    if (!user) return;

    const body = z
      .object({
        displayName: z.string().trim().min(1).max(200).optional(),
        homePage: z.union([z.enum(HOME_PAGES), z.null()]).optional(),
        mutedNotificationKinds: z.array(z.enum(NOTIFICATION_KINDS)).optional()
      })
      .parse(req.body);

    if (body.displayName === undefined && body.homePage === undefined && body.mutedNotificationKinds === undefined) {
      return reply.code(400).send(errorBody("VALIDATION"));
    }

    await app.prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: body.displayName,
        homePage: body.homePage === undefined ? undefined : body.homePage,
        mutedNotificationKinds: body.mutedNotificationKinds === undefined ? undefined : body.mutedNotificationKinds
      }
    });

    const next = await app.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: ME_INCLUDE
    });
    const runtime = await getRuntimeConfig(app.prisma);
    const payload = meUserPayload(next);
    return { ...payload, user: { ...payload.user, writeBlocked: runtime.writeBlocked } };
  });

  app.post("/change-password", async (req, reply) => {
    const body = z
      .object({
        oldPassword: z.string().min(1).max(200),
        newPassword: z.string().min(8).max(200)
      })
      .parse(req.body);

    let user: { id: string; passwordHash: string; isActive: boolean; tokenVersion: number } | null = null;
    try {
      const decoded = await req.jwtVerify<{ sub: string; ver?: number }>();
      user = await app.prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { id: true, passwordHash: true, isActive: true, tokenVersion: true }
      });
      if (user && (decoded.ver ?? 0) !== (user.tokenVersion ?? 0)) user = null;
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
    const updated = await app.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } }
    });
    await app.setAuthCookie(reply, req, updated.id);

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

  app.get("/me/presence", async (req, reply) => {
    const user = await requireAuthUser(app, req, reply);
    if (!user) return;

    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        kind: z.enum(["LOGIN", "PAGE"]).optional()
      })
      .parse(req.query);

    return await queryMyPresence(app.prisma, {
      userId: user.id,
      limit: query.limit,
      offset: query.offset,
      kind: query.kind
    });
  });
};

