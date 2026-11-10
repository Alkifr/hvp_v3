import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertAnyPermission, assertModelPermission } from "../../lib/rbac.js";

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) => value.toUpperCase().replace(/[\s-]+/g, "_"))
  .refine((value) => /^[A-Z0-9_]+$/.test(value), "Код: латиница, цифры и подчёркивание");

export const changeReasonsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertAnyPermission(req, ["view_changereason", "events:read", "gantt:read"]);
    return await app.prisma.changeReason.findMany({
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertModelPermission(req, "ChangeReason", "add");
    const body = z
      .object({
        code: codeSchema,
        name: z.string().trim().min(1).max(200),
        sortOrder: z.number().int().min(0).max(10000).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.changeReason.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertModelPermission(req, "ChangeReason", "change");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: codeSchema.optional(),
        name: z.string().trim().min(1).max(200).optional(),
        sortOrder: z.number().int().min(0).max(10000).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.changeReason.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertModelPermission(req, "ChangeReason", "delete");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.changeReason.delete({ where: { id } });
    return { ok: true };
  });
};
