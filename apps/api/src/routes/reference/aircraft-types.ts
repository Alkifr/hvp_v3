import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const aircraftTypesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    return await app.prisma.aircraftType.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        icaoType: z.string().trim().min(2).max(8).optional(),
        name: z.string().trim().min(1).max(200),
        manufacturer: z.string().trim().min(1).max(200).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraftType.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        icaoType: z.string().trim().min(2).max(8).nullable().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        manufacturer: z.string().trim().min(1).max(200).nullable().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraftType.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.aircraftType.delete({ where: { id } });
    return { ok: true };
  });
};

