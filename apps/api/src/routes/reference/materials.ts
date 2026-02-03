import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const materialsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "warehouse:read");
    return await app.prisma.material.findMany({ orderBy: [{ isActive: "desc" }, { code: "asc" }] });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "warehouse:write");
    const body = z
      .object({
        code: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(300),
        uom: z.string().trim().min(1).max(16),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.material.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "warehouse:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(64).optional(),
        name: z.string().trim().min(1).max(300).optional(),
        uom: z.string().trim().min(1).max(16).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.material.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "warehouse:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.material.delete({ where: { id } });
    return { ok: true };
  });
};

