import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { EDGE_TOW_NORM_CODE } from "../../lib/edgeTows.js";
import { ensureTowNorms } from "../../lib/towNorm.js";
import { assertAnyPermission, assertModelPermission, assertSystemAdmin } from "../../lib/rbac.js";

export const towNormsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertAnyPermission(req, ["events:read", "tows:read", "ref:read", "view_townorm"]);
    await ensureTowNorms(app.prisma);
    return await app.prisma.towNorm.findMany({ orderBy: [{ code: "asc" }] });
  });

  app.patch("/:code", async (req) => {
    assertSystemAdmin(req);
    assertModelPermission(req, "TowNorm", "change");
    const code = z.string().trim().min(1).max(64).parse((req.params as { code?: string }).code);
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        minutes: z.number().int().min(1).max(24 * 60).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    await ensureTowNorms(app.prisma);
    const existing = await app.prisma.towNorm.findUnique({ where: { code } });
    if (!existing) throw app.httpErrors.notFound("Норматив буксировки не найден");
    if (code !== EDGE_TOW_NORM_CODE) {
      throw app.httpErrors.badRequest("Можно менять только норматив краёв события");
    }

    return await app.prisma.towNorm.update({
      where: { code },
      data: {
        ...(body.name != null ? { name: body.name } : {}),
        ...(body.minutes != null ? { minutes: body.minutes } : {}),
        ...(body.isActive != null ? { isActive: body.isActive } : {})
      }
    });
  });
};
