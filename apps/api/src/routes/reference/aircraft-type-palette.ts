import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

function normalizeHexColor(raw: string) {
  const v = String(raw ?? "").trim();
  const m = v.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  return `#${m[1]!.toLowerCase()}`;
}

export const aircraftTypePaletteRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    return await app.prisma.aircraftTypePalette.findMany({
      include: { operator: true, aircraftType: true },
      orderBy: [{ isActive: "desc" }, { operator: { name: "asc" } }, { aircraftType: { name: "asc" } }]
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        operatorId: zUuid,
        aircraftTypeId: zUuid,
        color: z.string().trim().min(1).max(16),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    const color = normalizeHexColor(body.color);
    if (!color) throw new Error("Некорректный цвет. Ожидается hex: #RRGGBB");

    return await app.prisma.aircraftTypePalette.create({
      data: {
        operatorId: body.operatorId,
        aircraftTypeId: body.aircraftTypeId,
        color,
        isActive: body.isActive ?? true
      },
      include: { operator: true, aircraftType: true }
    });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        operatorId: zUuid.optional(),
        aircraftTypeId: zUuid.optional(),
        color: z.string().trim().min(1).max(16).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    const color = body.color != null ? normalizeHexColor(body.color) : undefined;
    if (body.color != null && !color) throw new Error("Некорректный цвет. Ожидается hex: #RRGGBB");

    return await app.prisma.aircraftTypePalette.update({
      where: { id },
      data: {
        ...(body.operatorId ? { operatorId: body.operatorId } : {}),
        ...(body.aircraftTypeId ? { aircraftTypeId: body.aircraftTypeId } : {}),
        ...(color ? { color } : {}),
        ...(body.isActive != null ? { isActive: body.isActive } : {})
      },
      include: { operator: true, aircraftType: true }
    });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.aircraftTypePalette.delete({ where: { id } });
    return { ok: true };
  });
};

