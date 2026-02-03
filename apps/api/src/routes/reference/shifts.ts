import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const shiftsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "workforce:read");
    return await app.prisma.shift.findMany({ orderBy: [{ isActive: "desc" }, { code: "asc" }] });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "workforce:write");
    const body = z
      .object({
        code: z.string().trim().min(1).max(16),
        name: z.string().trim().min(1).max(80),
        startMin: z.number().int().min(0).max(24 * 60),
        endMin: z.number().int().min(0).max(24 * 60),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.shift.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "workforce:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(16).optional(),
        name: z.string().trim().min(1).max(80).optional(),
        startMin: z.number().int().min(0).max(24 * 60).optional(),
        endMin: z.number().int().min(0).max(24 * 60).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.shift.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "workforce:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.shift.delete({ where: { id } });
    return { ok: true };
  });
};

