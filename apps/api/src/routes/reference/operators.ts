import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertModelPermission } from "../../lib/rbac.js";

export const operatorsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertModelPermission(req as any, "Operator", "view");
    return await app.prisma.operator.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertModelPermission(req as any, "Operator", "add");
    const body = z
      .object({
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(200),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.operator.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertModelPermission(req as any, "Operator", "change");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(32).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.operator.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertModelPermission(req as any, "Operator", "delete");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.operator.delete({ where: { id } });
    return { ok: true };
  });
};

