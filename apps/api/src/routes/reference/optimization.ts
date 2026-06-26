import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

const zCategory = z.enum(["REWARD", "PENALTY", "LIMIT"]);
const zScope = z.enum(["NEW_EVENT", "EXISTING_EVENT", "PLACEMENT", "LAYOUT", "STAND", "TOW", "PRIORITY"]);
const zUnit = z.enum(["POINTS", "POINTS_PER_HOUR", "HOURS", "BOOLEAN", "MULTIPLIER"]);

const profileInclude = {
  rules: { orderBy: [{ isActive: "desc" as const }, { scope: "asc" as const }, { code: "asc" as const }] }
};

export const optimizationProfilesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    const activeOnly = ["1", "true", "yes"].includes(String((req.query as any)?.activeOnly ?? "").toLowerCase());
    return await app.prisma.optimizationProfile.findMany({
      where: activeOnly ? { isActive: true } : {},
      include: profileInclude,
      orderBy: [{ isDefault: "desc" }, { isActive: "desc" }, { name: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        code: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(1000).nullable().optional(),
        isDefault: z.boolean().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.$transaction(async (tx: any) => {
      if (body.isDefault) await tx.optimizationProfile.updateMany({ data: { isDefault: false } });
      return await tx.optimizationProfile.create({ data: body, include: profileInclude });
    });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(64).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        isDefault: z.boolean().optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.$transaction(async (tx: any) => {
      if (body.isDefault) await tx.optimizationProfile.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
      return await tx.optimizationProfile.update({ where: { id }, data: body, include: profileInclude });
    });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.optimizationProfile.delete({ where: { id } });
    return { ok: true };
  });
};

export const optimizationScoreRulesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    const profileId = zUuid.optional().parse((req.query as any)?.profileId);
    const activeOnly = ["1", "true", "yes"].includes(String((req.query as any)?.activeOnly ?? "").toLowerCase());
    return await app.prisma.optimizationScoreRule.findMany({
      where: {
        ...(profileId ? { profileId } : {}),
        ...(activeOnly ? { isActive: true } : {})
      },
      include: { profile: { select: { id: true, code: true, name: true, isDefault: true } } },
      orderBy: [{ isActive: "desc" }, { scope: "asc" }, { code: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        profileId: zUuid,
        code: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(200),
        category: zCategory,
        scope: zScope,
        value: z.number(),
        unit: zUnit,
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.optimizationScoreRule.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        profileId: zUuid.optional(),
        code: z.string().trim().min(1).max(64).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        category: zCategory.optional(),
        scope: zScope.optional(),
        value: z.number().optional(),
        unit: zUnit.optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.optimizationScoreRule.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.optimizationScoreRule.delete({ where: { id } });
    return { ok: true };
  });
};
