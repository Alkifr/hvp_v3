import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { assertPermission } from "../../lib/rbac.js";
import { zUuid } from "../../lib/zod.js";

export const reportAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/reports", async (req) => {
    assertPermission(req as any, "admin:users");
    const reports = await app.prisma.savedReport.findMany({
      where: {
        OR: [{ sharedWithAllRole: { not: null } }, { owner: { isActive: false } }]
      },
      include: {
        owner: { select: { id: true, email: true, displayName: true, isActive: true } },
        shares: { select: { userId: true } }
      },
      orderBy: { updatedAt: "desc" }
    });

    return {
      ok: true as const,
      items: reports.map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
        owner: r.owner,
        ownerActive: r.owner?.isActive ?? false,
        sharedWithAllRole: r.sharedWithAllRole ?? null,
        shareCount: r.shares.length,
        orphan: r.owner ? !r.owner.isActive : true
      }))
    };
  });

  app.patch("/reports/:id", async (req) => {
    assertPermission(req as any, "admin:users");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        sharedWithAllRole: z.enum(["EDITOR", "VIEWER"]).nullable()
      })
      .parse(req.body ?? {});

    const existing = await app.prisma.savedReport.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      const err: any = new Error("REPORT_NOT_FOUND");
      err.statusCode = 404;
      throw err;
    }

    const updated = await app.prisma.savedReport.update({
      where: { id },
      data: { sharedWithAllRole: body.sharedWithAllRole },
      include: {
        owner: { select: { id: true, email: true, displayName: true, isActive: true } },
        shares: { select: { userId: true } }
      }
    });

    return {
      ok: true as const,
      id: updated.id,
      sharedWithAllRole: updated.sharedWithAllRole,
      owner: updated.owner,
      orphan: updated.owner ? !updated.owner.isActive : true,
      shareCount: updated.shares.length
    };
  });
};
