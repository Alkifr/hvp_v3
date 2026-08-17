import type { FastifyPluginAsync } from "fastify";

import {
  announcementVisibleWhere,
  compareAnnouncementsForPopup,
  isAnnouncementVisible,
  serializeAnnouncement
} from "../lib/announcements.js";
import { UserMsg } from "../lib/userErrors.js";
import { zUuid } from "../lib/zod.js";

const includeAuthor = {
  createdBy: { select: { id: true, email: true, displayName: true } }
} as const;

export const announcementRoutes: FastifyPluginAsync = async (app) => {
  app.get("/active", async (req) => {
    const userId = (req as any).auth?.id as string | undefined;
    if (!userId) {
      throw app.httpErrors.unauthorized(UserMsg.UNAUTHORIZED);
    }

    const now = new Date();
    const items = await app.prisma.appAnnouncement.findMany({
      where: {
        AND: [announcementVisibleWhere(now), { dismissals: { none: { userId } } }]
      },
      include: includeAuthor,
      orderBy: { createdAt: "desc" },
      take: 20
    });

    const visible = items
      .filter((row) => isAnnouncementVisible(row, now))
      .sort(compareAnnouncementsForPopup)
      .map((row) => serializeAnnouncement(row));

    return { ok: true as const, items: visible };
  });

  app.post("/:id/dismiss", async (req) => {
    const userId = (req as any).auth?.id as string | undefined;
    if (!userId) {
      throw app.httpErrors.unauthorized(UserMsg.UNAUTHORIZED);
    }
    const id = zUuid.parse((req.params as any).id);

    const note = await app.prisma.appAnnouncement.findUnique({ where: { id }, select: { id: true } });
    if (!note) {
      throw app.httpErrors.notFound(UserMsg.ANNOUNCEMENT_NOT_FOUND);
    }

    await app.prisma.appAnnouncementDismissal.upsert({
      where: { announcementId_userId: { announcementId: id, userId } },
      create: { announcementId: id, userId },
      update: { dismissedAt: new Date() }
    });

    return { ok: true as const };
  });
};
