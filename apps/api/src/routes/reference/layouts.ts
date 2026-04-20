import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

function capacitySummaryFromStands(stands: { bodyType: string | null }[]): string {
  const narrow = stands.filter((s) => s.bodyType === "NARROW_BODY").length;
  const wide = stands.filter((s) => s.bodyType === "WIDE_BODY").length;
  const any = stands.filter((s) => s.bodyType == null).length;
  const parts: string[] = [];
  if (narrow) parts.push(`${narrow} узк.`);
  if (wide) parts.push(`${wide} шир.`);
  if (any) parts.push(`${any} люб.`);
  return parts.length ? parts.join(", ") : "нет мест";
}

export const layoutsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    const hangarId = zUuid.optional().parse((req.query as any)?.hangarId);
    const rows = await app.prisma.hangarLayout.findMany({
      where: hangarId ? { hangarId } : undefined,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { stands: { where: { isActive: true }, select: { bodyType: true } } }
    });
    return rows.map((r) => {
      const { stands, ...rest } = r;
      return { ...rest, capacitySummary: capacitySummaryFromStands(stands) };
    });
  });

  app.get("/:id", async (req) => {
    assertPermission(req as any, "ref:read");
    const id = zUuid.parse((req.params as any).id);
    const row = await app.prisma.hangarLayout.findUniqueOrThrow({
      where: { id },
      include: { stands: { where: { isActive: true }, orderBy: { code: "asc" } }, hangar: true }
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

