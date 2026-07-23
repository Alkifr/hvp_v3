import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { assertPermission } from "../lib/rbac.js";
import { zUuid } from "../lib/zod.js";

/** Песочницы, к которым у пользователя есть личный или общий доступ. */
async function accessibleSandboxIds(app: FastifyInstance, userId: string): Promise<string[]> {
  const sandboxes = await app.prisma.sandbox.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
        { sharedWithAllRole: { not: null } }
      ]
    },
    select: { id: true }
  });
  return sandboxes.map((s) => s.id);
}

/**
 * Уведомления только из доступных контуров:
 * — основной план (sandboxId = null);
 * — песочницы, где пользователь владелец, участник или имеет общий доступ.
 */
function notificationScopeWhere(accessibleIds: string[]) {
  return {
    OR: [{ sandboxId: null }, { sandboxId: { in: accessibleIds } }]
  };
}

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "events:read");
    const userId = (req as any).auth?.id as string | undefined;
    if (!userId) {
      const err: any = new Error("UNAUTHORIZED");
      err.statusCode = 401;
      throw err;
    }

    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).optional().default(30)
      })
      .parse(req.query ?? {});

    const sandboxIds = await accessibleSandboxIds(app, userId);

    const items = await app.prisma.appNotification.findMany({
      where: {
        AND: [notificationScopeWhere(sandboxIds), { reads: { none: { userId } } }]
      },
      orderBy: [{ createdAt: "desc" }],
      take: query.limit,
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startAt: true,
            endAt: true,
            status: true,
            sandboxId: true,
            aircraft: { select: { tailNumber: true } }
          }
        }
      }
    });

    const mapped = items.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      eventId: n.eventId,
      sandboxId: n.sandboxId,
      createdAt: n.createdAt,
      readAt: null as string | null,
      event: n.event
        ? {
            id: n.event.id,
            title: n.event.title,
            startAt: n.event.startAt,
            endAt: n.event.endAt,
            status: n.event.status,
            sandboxId: n.event.sandboxId,
            aircraftTail: n.event.aircraft?.tailNumber ?? null
          }
        : null
    }));

    return { ok: true as const, unreadCount: mapped.length, items: mapped };
  });

  app.post("/:id/read", async (req) => {
    assertPermission(req as any, "events:read");
    const userId = (req as any).auth?.id as string | undefined;
    if (!userId) {
      const err: any = new Error("UNAUTHORIZED");
      err.statusCode = 401;
      throw err;
    }
    const id = zUuid.parse((req.params as any).id);

    const note = await app.prisma.appNotification.findUnique({ where: { id } });
    if (!note) throw app.httpErrors.notFound("Notification not found");

    if (note.sandboxId) {
      const sandboxIds = await accessibleSandboxIds(app, userId);
      if (!sandboxIds.includes(note.sandboxId)) {
        throw app.httpErrors.notFound("Notification not found");
      }
    }

    await app.prisma.appNotificationRead.upsert({
      where: { notificationId_userId: { notificationId: id, userId } },
      create: { notificationId: id, userId },
      update: { readAt: new Date() }
    });

    return { ok: true as const };
  });

  app.post("/read-all", async (req) => {
    assertPermission(req as any, "events:read");
    const userId = (req as any).auth?.id as string | undefined;
    if (!userId) {
      const err: any = new Error("UNAUTHORIZED");
      err.statusCode = 401;
      throw err;
    }

    const sandboxIds = await accessibleSandboxIds(app, userId);

    const unread = await app.prisma.appNotification.findMany({
      where: {
        AND: [notificationScopeWhere(sandboxIds), { reads: { none: { userId } } }]
      },
      select: { id: true },
      take: 500
    });

    if (unread.length) {
      await app.prisma.appNotificationRead.createMany({
        data: unread.map((n) => ({ notificationId: n.id, userId })),
        skipDuplicates: true
      });
    }

    return { ok: true as const, marked: unread.length };
  });
};
