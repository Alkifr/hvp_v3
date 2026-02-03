import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const aircraftRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    return await app.prisma.aircraft.findMany({
      include: { operator: true, type: true },
      orderBy: [{ isActive: "desc" }, { tailNumber: "asc" }]
    });
  });

  // Массовая загрузка бортов из CSV (UI читает файл и отправляет список)
  app.post("/import", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        operatorId: zUuid,
        typeId: zUuid,
        isActive: z.boolean().optional(),
        tailNumbers: z.array(z.string()).min(1).max(5000)
      })
      .parse(req.body);

    const norm = (s: string) => s.trim().replace(/^"+|"+$/g, "").toUpperCase();
    const unique = new Set<string>();
    const invalid: string[] = [];
    for (const raw of body.tailNumbers) {
      const t = norm(raw);
      if (!t) continue;
      if (t.length < 2 || t.length > 32) {
        invalid.push(t);
        continue;
      }
      unique.add(t);
    }

    const toCreate = Array.from(unique).map((tailNumber) => ({
      tailNumber,
      operatorId: body.operatorId,
      typeId: body.typeId,
      isActive: body.isActive ?? true
    }));

    if (toCreate.length === 0) {
      return { ok: true, created: 0, duplicatesOrExisting: 0, invalid, total: body.tailNumbers.length };
    }

    // createMany с skipDuplicates опирается на unique(tailNumber)
    const res = await app.prisma.aircraft.createMany({
      data: toCreate,
      skipDuplicates: true
    });

    return {
      ok: true,
      created: res.count,
      duplicatesOrExisting: toCreate.length - res.count,
      invalid,
      total: body.tailNumbers.length
    };
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        tailNumber: z.string().trim().min(2).max(32),
        serialNumber: z.string().trim().min(1).max(64).optional(),
        operatorId: zUuid,
        typeId: zUuid,
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraft.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        tailNumber: z.string().trim().min(2).max(32).optional(),
        serialNumber: z.string().trim().min(1).max(64).nullable().optional(),
        operatorId: zUuid.optional(),
        typeId: zUuid.optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraft.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.aircraft.delete({ where: { id } });
    return { ok: true };
  });
};

