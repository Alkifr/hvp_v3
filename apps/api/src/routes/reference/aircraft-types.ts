import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertModelPermission } from "../../lib/rbac.js";

const zBodyType = z.enum(["NARROW_BODY", "WIDE_BODY"]).optional().nullable();

export const aircraftTypesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertModelPermission(req as any, "AircraftType", "view");
    return await app.prisma.aircraftType.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertModelPermission(req as any, "AircraftType", "add");
    const body = z
      .object({
        icaoType: z.string().trim().min(2).max(25).optional(),
        name: z.string().trim().min(1).max(200),
        manufacturer: z.string().trim().min(1).max(200).optional(),
        bodyType: zBodyType,
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraftType.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertModelPermission(req as any, "AircraftType", "change");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        icaoType: z.string().trim().min(2).max(25).nullable().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        manufacturer: z.string().trim().min(1).max(200).nullable().optional(),
        bodyType: zBodyType,
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraftType.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertModelPermission(req as any, "AircraftType", "delete");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.aircraftType.delete({ where: { id } });
    return { ok: true };
  });
};

