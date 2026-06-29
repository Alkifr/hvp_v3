import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { EventAuditAction, EventStatus } from "@prisma/client";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const zCleanupFilters = z
    .object({
      eventId: zUuid.optional(),
      eventTypeId: zUuid.optional(),
      aircraftTypeId: zUuid.optional(),
      aircraftId: zUuid.optional(),
      sandboxId: zUuid.nullable().optional(),
      from: zDateTime.optional(),
      to: zDateTime.optional(),
      confirmBulk: z.boolean().optional()
    })
    .refine((v) => Boolean(v.eventId || v.eventTypeId || v.aircraftTypeId || v.aircraftId || v.from || v.to || v.confirmBulk), {
      message: "Нужно указать хотя бы один фильтр очистки"
    })
    .refine((v) => Boolean(v.eventId || v.from || v.to || v.confirmBulk), {
      message: "Для массовой очистки без конкретного события укажите период или confirmBulk=true"
    })
    .refine((v) => !v.from || !v.to || v.to > v.from, {
      message: "Дата окончания периода должна быть позже даты начала"
    });

  const buildCleanupWhere = (filters: z.infer<typeof zCleanupFilters>) => ({
    sandboxId: filters.sandboxId ?? null,
    status: { not: EventStatus.DELETED },
    ...(filters.eventId ? { id: filters.eventId } : {}),
    ...(filters.eventTypeId ? { eventTypeId: filters.eventTypeId } : {}),
    ...(filters.aircraftId ? { aircraftId: filters.aircraftId } : {}),
    ...(filters.aircraftTypeId
      ? {
          OR: [
            { aircraft: { typeId: filters.aircraftTypeId } },
            { virtualAircraft: { path: ["aircraftTypeId"], equals: filters.aircraftTypeId } }
          ]
        }
      : {}),
    ...(filters.from || filters.to
      ? {
          ...(filters.to ? { startAt: { lt: filters.to } } : {}),
          ...(filters.from ? { endAt: { gt: filters.from } } : {})
        }
      : {})
  });

  const cleanupSelect = {
    id: true,
    title: true,
    status: true,
    startAt: true,
    endAt: true,
    aircraft: { select: { id: true, tailNumber: true, type: { select: { id: true, name: true, icaoType: true } } } },
    virtualAircraft: true,
    eventType: { select: { id: true, name: true, code: true } }
  };

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

  app.post("/cleanup/events/preview", async (req) => {
    assertPermission(req as any, "admin:cleanup");
    const filters = zCleanupFilters.parse(req.body ?? {});
    const where = buildCleanupWhere(filters);

    const [total, items] = await Promise.all([
      app.prisma.maintenanceEvent.count({ where }),
      app.prisma.maintenanceEvent.findMany({
        where,
        select: cleanupSelect,
        orderBy: [{ startAt: "asc" }, { title: "asc" }],
        take: 50
      })
    ]);

    return { ok: true, total, items };
  });

  app.post("/cleanup/events/apply", async (req) => {
    assertPermission(req as any, "admin:cleanup");
    const body = zCleanupFilters
      .extend({
        password: z.string().min(1).max(200),
        reason: z.string().trim().max(1000).optional()
      })
      .parse(req.body ?? {});

    const currentUserId = String((req as any).auth?.id ?? "");
    const currentUser = currentUserId
      ? await app.prisma.user.findUnique({ where: { id: currentUserId }, select: { id: true, email: true, passwordHash: true, isActive: true } })
      : null;
    if (!currentUser || !currentUser.isActive) {
      throw app.httpErrors.unauthorized("UNAUTHORIZED");
    }

    const passwordOk = await argon2.verify(currentUser.passwordHash, body.password);
    if (!passwordOk) {
      const err: any = new Error("Пароль указан неверно");
      err.statusCode = 400;
      throw err;
    }

    const { reason } = body;
    const filters = {
      eventId: body.eventId,
      eventTypeId: body.eventTypeId,
      aircraftTypeId: body.aircraftTypeId,
      aircraftId: body.aircraftId,
      sandboxId: body.sandboxId,
      from: body.from,
      to: body.to,
      confirmBulk: body.confirmBulk
    };
    const where = buildCleanupWhere(filters);
    const events = await app.prisma.maintenanceEvent.findMany({
      where,
      select: { id: true, status: true, title: true },
      orderBy: [{ startAt: "asc" }, { title: "asc" }]
    });

    if (events.length === 0) return { ok: true, updated: 0 };

    await app.prisma.$transaction(async (tx) => {
      await tx.maintenanceEvent.updateMany({
        where: { id: { in: events.map((e) => e.id) }, sandboxId: filters.sandboxId ?? null },
        data: { status: EventStatus.DELETED }
      });
      await tx.maintenanceEventAudit.createMany({
        data: events.map((event) => ({
          eventId: event.id,
          sandboxId: filters.sandboxId ?? null,
          action: EventAuditAction.UPDATE,
          actor: currentUser.email,
          reason: reason || (filters.sandboxId ? "Очистка песочницы" : "Очистка рабочего контура"),
          changes: {
            status: { from: event.status, to: EventStatus.DELETED },
            cleanup: { mode: "logical-delete", title: event.title, sandboxId: filters.sandboxId ?? null }
          }
        }))
      });
    });

    return { ok: true, updated: events.length };
  });
};

