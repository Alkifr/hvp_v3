import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const standsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    const layoutId = zUuid.optional().parse((req.query as any)?.layoutId);
    return await app.prisma.hangarStand.findMany({
      where: layoutId ? { layoutId } : undefined,
      orderBy: [{ isActive: "desc" }, { code: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        layoutId: zUuid,
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(200),
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
        rotate: z.number().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.hangarStand.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(32).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().positive().optional(),
        h: z.number().positive().optional(),
        rotate: z.number().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.hangarStand.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.hangarStand.delete({ where: { id } });
    return { ok: true };
  });
};

