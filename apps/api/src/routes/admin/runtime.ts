import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { assertAnyPermission } from "../../lib/rbac.js";
import { getRuntimeConfig, RUNTIME_CONFIG_ID } from "../../lib/writeBlocked.js";

export const runtimeAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/runtime", async (req) => {
    assertAnyPermission(req as any, ["admin:users", "admin:roles", "admin:mail", "admin:cleanup"]);
    const runtime = await getRuntimeConfig(app.prisma);
    return { ok: true as const, writeBlocked: runtime.writeBlocked, updatedAt: runtime.updatedAt };
  });

  app.patch("/runtime", async (req) => {
    assertAnyPermission(req as any, ["admin:users", "admin:cleanup"]);
    const body = z.object({ writeBlocked: z.boolean() }).parse(req.body ?? {});
    const updated = await app.prisma.appRuntimeConfig.upsert({
      where: { id: RUNTIME_CONFIG_ID },
      create: { id: RUNTIME_CONFIG_ID, writeBlocked: body.writeBlocked, updatedById: (req as any).auth?.id ?? null },
      update: { writeBlocked: body.writeBlocked, updatedById: (req as any).auth?.id ?? null }
    });
    return { ok: true as const, writeBlocked: updated.writeBlocked, updatedAt: updated.updatedAt };
  });
};
