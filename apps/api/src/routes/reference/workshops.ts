import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const workshopsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    return await app.prisma.workshop.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(200),
        defaultLineBase: z.enum(["LINE", "BASE"]).nullable().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.workshop.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(32).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        defaultLineBase: z.enum(["LINE", "BASE"]).nullable().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    const workshop = await app.prisma.workshop.update({ where: { id }, data: body });
    if (body.defaultLineBase) {
      await app.prisma.maintenanceEvent.updateMany({
        where: { workshopId: id, lineBase: null },
        data: { lineBase: body.defaultLineBase }
      });
    }
    return workshop;
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.workshop.delete({ where: { id } });
    return { ok: true };
  });
};
