import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import fp from "fastify-plugin";

import type { FastifyReply, FastifyRequest } from "fastify";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
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
    };
  }
}

const AUTH_COOKIE = "hp_token";

function getJwtSecret() {
  return (process.env.JWT_SECRET ?? "").trim() || "dev_insecure_jwt_secret_change_me";
}

function cookieOptions(_req: FastifyRequest) {
  const isProd = process.env.NODE_ENV === "production";
  // В dev можно по http://localhost
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    // чтобы работало и на localhost:3000 и на localhost:3001
    domain: undefined as string | undefined
  };
}

async function loadUser(app: any, userId: string) {
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
    mustChangePassword: u.mustChangePassword
  };
}

export const authPlugin = fp(async (app) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: getJwtSecret(),
    cookie: { cookieName: AUTH_COOKIE, signed: false }
  });

  // Вешаем пользователя на req.user для /api/**
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api")) return;
    if (req.url.startsWith("/api/auth/")) return;

    try {
      const decoded = await req.jwtVerify<{ sub: string }>();
      const user = await loadUser(app, decoded.sub);
      if (!user) {
        reply.clearCookie(AUTH_COOKIE, cookieOptions(req));
        return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
      }
      req.auth = user;
    } catch {
      return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
    }
  });

  app.decorate("setAuthCookie", async (reply: FastifyReply, req: FastifyRequest, userId: string) => {
    const token = await reply.jwtSign({ sub: userId });
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

