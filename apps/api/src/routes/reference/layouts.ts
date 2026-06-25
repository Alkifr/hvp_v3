import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

function capacitySummaryFromStands(stands: { allowedAircraftTypes?: unknown[] }[]): string {
  const any = stands.filter((s) => (s.allowedAircraftTypes?.length ?? 0) === 0).length;
  const specific = stands.length - any;
  const parts: string[] = [];
  if (specific) parts.push(`${specific} типиз.`);
  if (any) parts.push(`${any} люб.`);
  return parts.length ? parts.join(", ") : "нет мест";
}

function standAcceptsAircraftType(stand: { allowedAircraftTypes?: Array<{ aircraftTypeId: string }> }, aircraftTypeId?: string): boolean {
  if (!aircraftTypeId) return true;
  const allowed = stand.allowedAircraftTypes ?? [];
  return allowed.length === 0 || allowed.some((link) => link.aircraftTypeId === aircraftTypeId);
}

const zBodyType = z.enum(["NARROW_BODY", "WIDE_BODY"]).optional().nullable();
const zAircraftTypeIcaoTypes = z.array(z.string().trim().min(1).max(32)).optional().default([]);

const zLayoutImport = z.object({
  hangars: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(200),
        isActive: z.boolean().optional(),
        layouts: z
          .array(
            z.object({
              code: z.string().trim().min(1).max(32),
              name: z.string().trim().min(1).max(200),
              description: z.string().trim().min(1).max(500).optional().nullable(),
              widthMeters: z.number().positive().optional().nullable(),
              heightMeters: z.number().positive().optional().nullable(),
              obstacles: z.any().optional().nullable(),
              isActive: z.boolean().optional(),
              stands: z
                .array(
                  z.object({
                    code: z.string().trim().min(1).max(32),
                    name: z.string().trim().min(1).max(200),
                    bodyType: zBodyType,
                    aircraftTypeIcaoTypes: zAircraftTypeIcaoTypes,
                    x: z.number(),
                    y: z.number(),
                    w: z.number().positive(),
                    h: z.number().positive(),
                    rotate: z.number().optional(),
                    isActive: z.boolean().optional()
                  })
                )
                .default([])
            })
          )
          .default([])
      })
    )
    .min(1)
});

export const layoutsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    const hangarId = zUuid.optional().parse((req.query as any)?.hangarId);
    const activeOnly = ["1", "true", "yes"].includes(String((req.query as any)?.activeOnly ?? "").toLowerCase());
    const aircraftTypeId = zUuid.optional().parse((req.query as any)?.aircraftTypeId);
    const rows = await app.prisma.hangarLayout.findMany({
      where: {
        ...(hangarId ? { hangarId } : {}),
        ...(activeOnly ? { isActive: true } : {})
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { stands: { where: { isActive: true }, select: { allowedAircraftTypes: { select: { aircraftTypeId: true } } } } }
    });
    return rows.map((r) => {
      const { stands, ...rest } = r;
      return {
        ...rest,
        capacitySummary: capacitySummaryFromStands(stands),
        isCompatible: stands.some((stand) => standAcceptsAircraftType(stand, aircraftTypeId))
      };
    });
  });

  app.get("/:id", async (req) => {
    assertPermission(req as any, "ref:read");
    const id = zUuid.parse((req.params as any).id);
    const row = await app.prisma.hangarLayout.findUniqueOrThrow({
      where: { id },
      include: {
        stands: {
          where: { isActive: true },
          orderBy: { code: "asc" },
          include: {
            allowedAircraftTypes: {
              include: { aircraftType: { select: { id: true, icaoType: true, name: true } } },
              orderBy: { aircraftType: { name: "asc" } }
            }
          }
        },
        hangar: true
      }
    });
    return {
      ...row,
      capacitySummary: capacitySummaryFromStands(row.stands)
    };
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
        obstacles: z.any().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.hangarLayout.create({ data: body });
  });

  app.post("/import", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = zLayoutImport.parse(req.body);

    const result = await app.prisma.$transaction(async (tx: any) => {
      const summary = { hangars: 0, layouts: 0, stands: 0 };
      for (const h of body.hangars) {
        const hangar = await tx.hangar.upsert({
          where: { code: h.code },
          update: { name: h.name, isActive: h.isActive ?? true },
          create: { code: h.code, name: h.name, isActive: h.isActive ?? true }
        });
        summary.hangars += 1;

        for (const l of h.layouts) {
          const layout = await tx.hangarLayout.upsert({
            where: { hangarId_code: { hangarId: hangar.id, code: l.code } },
            update: {
              name: l.name,
              description: l.description ?? null,
              widthMeters: l.widthMeters ?? null,
              heightMeters: l.heightMeters ?? null,
              obstacles: l.obstacles ?? null,
              isActive: l.isActive ?? true
            },
            create: {
              hangarId: hangar.id,
              code: l.code,
              name: l.name,
              description: l.description ?? null,
              widthMeters: l.widthMeters ?? null,
              heightMeters: l.heightMeters ?? null,
              obstacles: l.obstacles ?? null,
              isActive: l.isActive ?? true
            }
          });
          summary.layouts += 1;

          const importedCodes = new Set(l.stands.map((s) => s.code));
          if (importedCodes.size > 0) {
            await tx.hangarStand.updateMany({
              where: { layoutId: layout.id, code: { notIn: Array.from(importedCodes) } },
              data: { isActive: false }
            });
          }

          for (const s of l.stands) {
            const stand = await tx.hangarStand.upsert({
              where: { layoutId_code: { layoutId: layout.id, code: s.code } },
              update: {
                name: s.name,
                bodyType: s.bodyType ?? null,
                x: s.x,
                y: s.y,
                w: s.w,
                h: s.h,
                rotate: s.rotate ?? 0,
                isActive: s.isActive ?? true
              },
              create: {
                layoutId: layout.id,
                code: s.code,
                name: s.name,
                bodyType: s.bodyType ?? null,
                x: s.x,
                y: s.y,
                w: s.w,
                h: s.h,
                rotate: s.rotate ?? 0,
                isActive: s.isActive ?? true
              }
            });
            await tx.hangarStandAircraftType.deleteMany({ where: { standId: stand.id } });
            if (s.aircraftTypeIcaoTypes.length > 0) {
              const aircraftTypes = await tx.aircraftType.findMany({
                where: { icaoType: { in: s.aircraftTypeIcaoTypes } },
                select: { id: true, icaoType: true }
              });
              const found = new Set(aircraftTypes.map((t: any) => t.icaoType));
              const missing = s.aircraftTypeIcaoTypes.filter((icaoType) => !found.has(icaoType));
              if (missing.length > 0) {
                throw new Error(`Не найдены типы ВС для места ${s.code}: ${missing.join(", ")}`);
              }
              await tx.hangarStandAircraftType.createMany({
                data: aircraftTypes.map((aircraftType: any) => ({ standId: stand.id, aircraftTypeId: aircraftType.id })),
                skipDuplicates: true
              });
            }
            summary.stands += 1;
          }
        }
      }
      return summary;
    });

    return { ok: true, ...result };
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
        obstacles: z.any().nullable().optional(),
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

