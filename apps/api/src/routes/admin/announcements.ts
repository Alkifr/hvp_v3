import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  ANNOUNCEMENT_KINDS,
  serializeAnnouncement
} from "../../lib/announcements.js";
import { assertPermission } from "../../lib/rbac.js";
import { UserMsg } from "../../lib/userErrors.js";
import { zDateTime, zUuid } from "../../lib/zod.js";

const zKind = z.enum(ANNOUNCEMENT_KINDS);

const zCreate = z
  .object({
    kind: zKind,
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4000),
    startsAt: zDateTime.nullable().optional(),
    endsAt: zDateTime.nullable().optional(),
    isActive: z.boolean().optional()
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    message: UserMsg.END_AFTER_START
  });

const zPatch = z
  .object({
    kind: zKind.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    startsAt: zDateTime.nullable().optional(),
    endsAt: zDateTime.nullable().optional(),
    isActive: z.boolean().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: UserMsg.VALIDATION })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    message: UserMsg.END_AFTER_START
  });

const includeAdmin = {
  createdBy: { select: { id: true, email: true, displayName: true } },
  _count: { select: { dismissals: true } }
} as const;

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

export const announcementAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/announcements", async (req) => {
    assertPermission(req as any, "admin:users");
    const items = await app.prisma.appAnnouncement.findMany({
      include: includeAdmin,
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }]
    });
    return { ok: true as const, items: items.map(serializeAnnouncement) };
  });

  app.post("/announcements", async (req) => {
    assertPermission(req as any, "admin:users");
    const body = zCreate.parse(req.body ?? {});
    const createdById = String((req as any).auth?.id ?? "") || null;

    const row = await app.prisma.appAnnouncement.create({
      data: {
        kind: body.kind,
        title: body.title,
        body: body.body,
        startsAt: body.startsAt ?? null,
        endsAt: body.endsAt ?? null,
        isActive: body.isActive ?? true,
        createdById
      },
      include: includeAdmin
    });
    return serializeAnnouncement(row);
  });

  app.patch("/announcements/:id", async (req) => {
    assertPermission(req as any, "admin:users");
    const id = zUuid.parse((req.params as any).id);
    const body = zPatch.parse(req.body ?? {});

    const existing = await app.prisma.appAnnouncement.findUnique({ where: { id } });
    if (!existing) {
      throw app.httpErrors.notFound(UserMsg.ANNOUNCEMENT_NOT_FOUND);
    }

    const nextStarts = body.startsAt !== undefined ? body.startsAt : existing.startsAt;
    const nextEnds = body.endsAt !== undefined ? body.endsAt : existing.endsAt;
    if (nextStarts && nextEnds && nextEnds <= nextStarts) {
      throw app.httpErrors.badRequest(UserMsg.END_AFTER_START);
    }

    const contentChanged =
      (body.kind !== undefined && body.kind !== existing.kind) ||
      (body.title !== undefined && body.title !== existing.title) ||
      (body.body !== undefined && body.body !== existing.body) ||
      (body.startsAt !== undefined && !sameInstant(body.startsAt, existing.startsAt)) ||
      (body.endsAt !== undefined && !sameInstant(body.endsAt, existing.endsAt));

    const row = await app.prisma.$transaction(async (tx) => {
      if (contentChanged) {
        await tx.appAnnouncementDismissal.deleteMany({ where: { announcementId: id } });
      }
      return tx.appAnnouncement.update({
        where: { id },
        data: {
          kind: body.kind,
          title: body.title,
          body: body.body,
          startsAt: body.startsAt === undefined ? undefined : body.startsAt,
          endsAt: body.endsAt === undefined ? undefined : body.endsAt,
          isActive: body.isActive
        },
        include: includeAdmin
      });
    });

    return serializeAnnouncement(row);
  });

  app.delete("/announcements/:id", async (req) => {
    assertPermission(req as any, "admin:users");
    const id = zUuid.parse((req.params as any).id);
    try {
      await app.prisma.appAnnouncement.delete({ where: { id } });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "P2025") {
        throw app.httpErrors.notFound(UserMsg.ANNOUNCEMENT_NOT_FOUND);
      }
      throw err;
    }
    return { ok: true as const };
  });
};
