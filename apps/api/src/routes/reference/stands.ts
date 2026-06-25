import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

const zBodyType = z.enum(["NARROW_BODY", "WIDE_BODY"]).optional().nullable();
const zAircraftTypeIds = z.array(zUuid).optional();

function standAcceptsAircraftType(stand: { allowedAircraftTypes?: Array<{ aircraftTypeId: string }> }, aircraftTypeId?: string): boolean {
  if (!aircraftTypeId) return true;
  const allowed = stand.allowedAircraftTypes ?? [];
  return allowed.length === 0 || allowed.some((link) => link.aircraftTypeId === aircraftTypeId);
}

const standInclude = {
  layout: {
    select: {
      id: true,
      code: true,
      name: true,
      hangar: { select: { id: true, code: true, name: true } }
    }
  },
  allowedAircraftTypes: {
    include: { aircraftType: { select: { id: true, icaoType: true, name: true } } },
    orderBy: { aircraftType: { name: "asc" as const } }
  }
};

export const standsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    const layoutId = zUuid.optional().parse((req.query as any)?.layoutId);
    const hangarId = zUuid.optional().parse((req.query as any)?.hangarId);
    const activeOnly = ["1", "true", "yes"].includes(String((req.query as any)?.activeOnly ?? "").toLowerCase());
    const aircraftTypeId = zUuid.optional().parse((req.query as any)?.aircraftTypeId);
    const rows = await app.prisma.hangarStand.findMany({
      where: {
        ...(layoutId ? { layoutId } : hangarId ? { layout: { hangarId } } : {}),
        ...(activeOnly ? { isActive: true } : {})
      },
      include: standInclude,
      orderBy: [{ isActive: "desc" }, { code: "asc" }]
    });
    return rows.map((row) => ({ ...row, isCompatible: standAcceptsAircraftType(row, aircraftTypeId) }));
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        layoutId: zUuid,
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(200),
        bodyType: zBodyType,
        aircraftTypeIds: zAircraftTypeIds.default([]),
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
        rotate: z.number().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    const { aircraftTypeIds, ...data } = body;
    return await app.prisma.$transaction(async (tx: any) => {
      const stand = await tx.hangarStand.create({ data });
      if (aircraftTypeIds.length > 0) {
        await tx.hangarStandAircraftType.createMany({
          data: aircraftTypeIds.map((aircraftTypeId) => ({ standId: stand.id, aircraftTypeId })),
          skipDuplicates: true
        });
      }
      return await tx.hangarStand.findUniqueOrThrow({ where: { id: stand.id }, include: standInclude });
    });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(32).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        bodyType: zBodyType,
        aircraftTypeIds: zAircraftTypeIds,
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().positive().optional(),
        h: z.number().positive().optional(),
        rotate: z.number().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    const { aircraftTypeIds, ...data } = body;
    return await app.prisma.$transaction(async (tx: any) => {
      await tx.hangarStand.update({ where: { id }, data });
      if (aircraftTypeIds) {
        await tx.hangarStandAircraftType.deleteMany({ where: { standId: id } });
        if (aircraftTypeIds.length > 0) {
          await tx.hangarStandAircraftType.createMany({
            data: aircraftTypeIds.map((aircraftTypeId) => ({ standId: id, aircraftTypeId })),
            skipDuplicates: true
          });
        }
      }
      return await tx.hangarStand.findUniqueOrThrow({ where: { id }, include: standInclude });
    });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const usage = await app.prisma.hangarStand.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            reservations: true,
            placements: true
          }
        }
      }
    });
    if (!usage) throw app.httpErrors.notFound("Место стоянки не найдено");
    if (usage._count.reservations > 0 || usage._count.placements > 0) {
      throw app.httpErrors.conflict(
        "Место стоянки уже используется в событиях. Удаление недоступно, чтобы не нарушить план и историю. Отключите место, сняв признак активности."
      );
    }
    await app.prisma.hangarStand.delete({ where: { id } });
    return { ok: true };
  });
};

