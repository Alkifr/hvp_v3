import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import argon2 from "argon2";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // permissions list
  app.get("/permissions", async (req) => {
    assertPermission(req as any, "admin:roles");
    return await app.prisma.permission.findMany({ orderBy: { code: "asc" } });
  });

  // roles
  app.get("/roles", async (req) => {
    assertPermission(req as any, "admin:roles");
    return await app.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: [{ isSystem: "desc" }, { code: "asc" }]
    });
  });

  app.post("/roles", async (req) => {
    assertPermission(req as any, "admin:roles");
    const body = z
      .object({
        code: z.string().trim().min(2).max(32),
        name: z.string().trim().min(1).max(200),
        permissionIds: z.array(zUuid).default([])
      })
      .parse(req.body);

    const role = await app.prisma.role.create({
      data: { code: body.code, name: body.name, isSystem: false }
    });

    await Promise.all(
      body.permissionIds.map((permissionId) =>
        app.prisma.rolePermission.create({ data: { roleId: role.id, permissionId } })
      )
    );

    return await app.prisma.role.findUniqueOrThrow({
      where: { id: role.id },
      include: { permissions: { include: { permission: true } } }
    });
  });

  app.patch("/roles/:id", async (req) => {
    assertPermission(req as any, "admin:roles");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        permissionIds: z.array(zUuid).optional()
      })
      .parse(req.body);

    const role = await app.prisma.role.update({ where: { id }, data: { name: body.name } });

    if (body.permissionIds) {
      await app.prisma.rolePermission.deleteMany({ where: { roleId: id } });
      await Promise.all(
        body.permissionIds.map((permissionId) =>
          app.prisma.rolePermission.create({ data: { roleId: id, permissionId } })
        )
      );
    }

    void role;
    return await app.prisma.role.findUniqueOrThrow({
      where: { id },
      include: { permissions: { include: { permission: true } } }
    });
  });

  // users
  app.get("/users", async (req) => {
    assertPermission(req as any, "admin:users");
    return await app.prisma.user.findMany({
      include: { roles: { include: { role: true } } },
      orderBy: [{ isActive: "desc" }, { email: "asc" }]
    });
  });

  app.post("/users", async (req) => {
    assertPermission(req as any, "admin:users");
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        displayName: z.string().trim().min(1).max(200).optional(),
        password: z.string().min(8).max(200),
        roleIds: z.array(zUuid).default([])
      })
      .parse(req.body);

    const passwordHash = await argon2.hash(body.password);
    const user = await app.prisma.user.create({
      data: {
        email: body.email,
        displayName: body.displayName,
        passwordHash,
        isActive: true,
        mustChangePassword: true
      }
    });

    await Promise.all(body.roleIds.map((roleId) => app.prisma.userRole.create({ data: { userId: user.id, roleId } })));

    return await app.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { roles: { include: { role: true } } }
    });
  });

  app.patch("/users/:id", async (req) => {
    assertPermission(req as any, "admin:users");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        displayName: z.string().trim().min(1).max(200).nullable().optional(),
        isActive: z.boolean().optional(),
        mustChangePassword: z.boolean().optional(),
        roleIds: z.array(zUuid).optional()
      })
      .parse(req.body);

    await app.prisma.user.update({
      where: { id },
      data: {
        displayName: body.displayName === undefined ? undefined : body.displayName,
        isActive: body.isActive,
        mustChangePassword: body.mustChangePassword
      }
    });

    if (body.roleIds) {
      await app.prisma.userRole.deleteMany({ where: { userId: id } });
      await Promise.all(body.roleIds.map((roleId) => app.prisma.userRole.create({ data: { userId: id, roleId } })));
    }

    return await app.prisma.user.findUniqueOrThrow({
      where: { id },
      include: { roles: { include: { role: true } } }
    });
  });

  app.post("/users/:id/reset-password", async (req) => {
    assertPermission(req as any, "admin:users");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        newPassword: z.string().min(8).max(200)
      })
      .parse(req.body);

    const passwordHash = await argon2.hash(body.newPassword);
    await app.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true }
    });
    return { ok: true };
  });
};

