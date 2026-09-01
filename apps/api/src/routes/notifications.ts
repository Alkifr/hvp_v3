import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { assertPermission, isSystemAdmin } from "../lib/rbac.js";
import { KIND_USER_ERROR } from "../lib/adminErrorNotify.js";
import { UserMsg } from "../lib/userErrors.js";
import { zUuid } from "../lib/zod.js";

/** Только рабочий контур (sandboxId = null). Песочницы в колокольчик не попадают. */
const PROD_SCOPE = { sandboxId: null as string | null };

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

    const adminOnly = isSystemAdmin((req as any).auth?.roles);
    const muted = ((req as any).auth?.mutedNotificationKinds as string[] | undefined) ?? [];
    const items = await app.prisma.appNotification.findMany({
      where: {
        AND: [
          PROD_SCOPE,
          { reads: { none: { userId } } },
          adminOnly ? {} : { kind: { not: KIND_USER_ERROR } },
          muted.length ? { kind: { notIn: muted } } : {}
        ]
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
    if (!note || note.sandboxId != null) {
      throw app.httpErrors.notFound(UserMsg.NOTIFICATION_NOT_FOUND);
    }
    if (note.kind === KIND_USER_ERROR && !isSystemAdmin((req as any).auth?.roles)) {
      throw app.httpErrors.notFound(UserMsg.NOTIFICATION_NOT_FOUND);
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

    const adminOnly = isSystemAdmin((req as any).auth?.roles);
    const muted = ((req as any).auth?.mutedNotificationKinds as string[] | undefined) ?? [];
    const unread = await app.prisma.appNotification.findMany({
      where: {
        AND: [
          PROD_SCOPE,
          { reads: { none: { userId } } },
          adminOnly ? {} : { kind: { not: KIND_USER_ERROR } },
          muted.length ? { kind: { notIn: muted } } : {}
        ]
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
