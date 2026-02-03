import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const skillsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "workforce:read");
    return await app.prisma.skill.findMany({ orderBy: [{ isActive: "desc" }, { code: "asc" }] });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "workforce:write");
    const body = z
      .object({
        code: z.string().trim().min(2).max(32),
        name: z.string().trim().min(1).max(200),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.skill.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "workforce:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(2).max(32).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.skill.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "workforce:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.skill.delete({ where: { id } });
    return { ok: true };
  });
};

