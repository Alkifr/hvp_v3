import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import argon2 from "argon2";

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
};

