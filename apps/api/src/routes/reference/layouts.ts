import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const layoutsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    const hangarId = zUuid.optional().parse((req.query as any)?.hangarId);
    return await app.prisma.hangarLayout.findMany({
      where: hangarId ? { hangarId } : undefined,
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
  });

  app.get("/:id", async (req) => {
    assertPermission(req as any, "ref:read");
    const id = zUuid.parse((req.params as any).id);
    return await app.prisma.hangarLayout.findUniqueOrThrow({
      where: { id },
      include: { stands: { where: { isActive: true }, orderBy: { code: "asc" } }, hangar: true }
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        hangarId: zUuid,
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(500).optional(),
        widthMeters: z.number().positive().optional(),
        heightMeters: z.number().positive().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.hangarLayout.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(32).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().min(1).max(500).nullable().optional(),
        widthMeters: z.number().positive().nullable().optional(),
        heightMeters: z.number().positive().nullable().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.hangarLayout.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.hangarLayout.delete({ where: { id } });
    return { ok: true };
  });
};

