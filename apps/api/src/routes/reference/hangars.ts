import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const hangarsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    return await app.prisma.hangar.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(200),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.hangar.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(32).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.hangar.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.hangar.delete({ where: { id } });
    return { ok: true };
  });
};

