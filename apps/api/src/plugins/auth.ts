import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import fp from "fastify-plugin";

import type { FastifyReply, FastifyRequest } from "fastify";

import { errorBody } from "../lib/userErrors.js";
import { resolveJwtSecret } from "../lib/bootEnv.js";
import { getRuntimeConfig, isMutatingHttpMethod, isWriteBlockedExempt } from "../lib/writeBlocked.js";
import { parseMutedNotificationKinds } from "../lib/userPrefs.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; ver?: number };
    user: { sub: string; ver?: number };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: {
      id: string;
      email: string;
      displayName?: string | null;
      roles: string[];
      permissions: string[];
      mustChangePassword: boolean;
      mutedNotificationKinds: string[];
    };
  }
}

const AUTH_COOKIE = "hp_token";
const AUTH_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function getJwtSecret() {
  return resolveJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV ?? "development");
}

function cookieOptions(_req: FastifyRequest) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd && process.env.COOKIE_SECURE !== "0",
    path: "/",
    maxAge: AUTH_MAX_AGE_MS,
    domain: undefined as string | undefined
  };
}

async function loadUser(app: any, userId: string, tokenVer?: number) {
  const u = await app.prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: {
            include: { permissions: { include: { permission: true } } }
          }
        }
      }
    }
  });
  if (!u || !u.isActive) return null;
  if ((tokenVer ?? 0) !== (u.tokenVersion ?? 0)) return null;

  const roles = u.roles.map((ur: any) => ur.role.code);
  const permissions = Array.from(
    new Set<string>(
      u.roles.flatMap((ur: any) => ur.role.permissions.map((rp: any) => String(rp.permission.code)))
    )
  );

  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    roles,
    permissions,
    mustChangePassword: u.mustChangePassword,
    mutedNotificationKinds: parseMutedNotificationKinds(u.mutedNotificationKinds)
  };
}

export const authPlugin = fp(async (app) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: getJwtSecret(),
    sign: { expiresIn: "12h" },
    cookie: { cookieName: AUTH_COOKIE, signed: false }
  });

  // Вешаем пользователя на req.auth для /api/**
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api")) return;
    if (req.url.startsWith("/api/auth/")) return;

    try {
      const decoded = await req.jwtVerify<{ sub: string; ver?: number }>();
      const user = await loadUser(app, decoded.sub, decoded.ver);
      if (!user) {
        reply.clearCookie(AUTH_COOKIE, cookieOptions(req));
        return reply.code(401).send(errorBody("UNAUTHORIZED"));
      }
      if (user.mustChangePassword) {
        return reply.code(403).send(errorBody("MUST_CHANGE_PASSWORD"));
      }
      req.auth = user;
      if (isMutatingHttpMethod(req.method) && !isWriteBlockedExempt(req.url, user.permissions)) {
        const runtime = await getRuntimeConfig(app.prisma);
        if (runtime.writeBlocked) {
          return reply.code(403).send(errorBody("WRITE_BLOCKED"));
        }
      }
    } catch {
      return reply.code(401).send(errorBody("UNAUTHORIZED"));
    }
  });

  app.decorate("setAuthCookie", async (reply: FastifyReply, req: FastifyRequest, userId: string) => {
    const row = await app.prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
    const token = await reply.jwtSign({ sub: userId, ver: row?.tokenVersion ?? 0 });
    reply.setCookie(AUTH_COOKIE, token, cookieOptions(req));
  });

  app.decorate("clearAuthCookie", (reply: FastifyReply, req: FastifyRequest) => {
    reply.clearCookie(AUTH_COOKIE, cookieOptions(req));
  });
});

declare module "fastify" {
  interface FastifyInstance {
    setAuthCookie: (reply: FastifyReply, req: FastifyRequest, userId: string) => Promise<void>;
    clearAuthCookie: (reply: FastifyReply, req: FastifyRequest) => void;
  }
}

