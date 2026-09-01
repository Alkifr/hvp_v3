import type { FastifyPluginAsync } from "fastify";
import { UserActivityAction } from "@prisma/client";
import { z } from "zod";

import { assertPermission, assertSystemAdmin } from "../../lib/rbac.js";
import { logUserActivity } from "../../lib/userActivity.js";
import { zUuid } from "../../lib/zod.js";

function getActor(req: any): string {
  return String(req.auth?.email ?? "admin");
}

function serializeAdminSandbox(s: any) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    status: s.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
    ownerId: s.ownerId,
    owner: s.owner,
    ownerActive: s.owner?.isActive ?? true,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    sharedWithAllRole: s.sharedWithAllRole,
    eventCount: s._count?.events ?? 0,
    memberCount: s.members?.length ?? 0
  };
}

const includeAdmin = {
  owner: { select: { id: true, email: true, displayName: true, isActive: true } },
  members: { select: { userId: true } },
  _count: { select: { events: true } }
} as const;

export const sandboxAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/sandboxes", async (req) => {
    assertPermission(req as any, "admin:users");
    const query = z
      .object({
        status: z.enum(["ACTIVE", "ARCHIVED", "all"]).default("all"),
        q: z.string().trim().max(200).optional()
      })
      .parse(req.query);

    const sandboxes = await app.prisma.sandbox.findMany({
      where: {
        ...(query.status !== "all" ? { status: query.status } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { owner: { email: { contains: query.q, mode: "insensitive" } } },
                { owner: { displayName: { contains: query.q, mode: "insensitive" } } }
              ]
            }
          : {})
      },
      include: includeAdmin,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    });

    return { ok: true as const, items: sandboxes.map(serializeAdminSandbox) };
  });

  app.patch("/sandboxes/:id", async (req) => {
    assertPermission(req as any, "admin:users");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
        sharedWithAllRole: z.enum(["EDITOR", "VIEWER"]).nullable().optional()
      })
      .refine((v) => v.status !== undefined || v.sharedWithAllRole !== undefined, { message: "VALIDATION" })
      .parse(req.body ?? {});

    const existing = await app.prisma.sandbox.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      const err: any = new Error("SANDBOX_NOT_FOUND");
      err.statusCode = 404;
      throw err;
    }

    const updated = await app.prisma.sandbox.update({
      where: { id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.sharedWithAllRole !== undefined ? { sharedWithAllRole: body.sharedWithAllRole } : {})
      },
      include: includeAdmin
    });
    return serializeAdminSandbox(updated);
  });

  app.delete("/sandboxes/:id", async (req) => {
    assertSystemAdmin(req as any);
    const id = zUuid.parse((req.params as any).id);
    const sandbox = await app.prisma.sandbox.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { events: true } } }
    });
    if (!sandbox) {
      const err: any = new Error("SANDBOX_NOT_FOUND");
      err.statusCode = 404;
      throw err;
    }
    await logUserActivity(app.prisma, {
      userId: String((req as any).auth?.id ?? ""),
      actor: getActor(req),
      action: UserActivityAction.SANDBOX_DELETE,
      title: `Песочница «${sandbox.name}»`,
      reason: "Удаление песочницы из админки",
      sourceKind: "sandbox",
      sandboxId: sandbox.id,
      sandboxName: sandbox.name,
      changes: {
        sandbox: { id: sandbox.id, name: sandbox.name },
        eventCount: sandbox._count.events
      }
    });
    await app.prisma.sandbox.delete({ where: { id } });
    return { ok: true as const };
  });
};
