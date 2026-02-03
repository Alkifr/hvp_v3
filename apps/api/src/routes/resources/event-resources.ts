import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

function toUtcDayStart(v: string | Date) {
  const d = v instanceof Date ? v : new Date(v);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export const eventResourcesRoutes: FastifyPluginAsync = async (app) => {
  // --- План работ (по дню/смене/квалификации) ---
  app.get("/:eventId/plan", async (req) => {
    assertPermission(req as any, "resources:read");
    const eventId = zUuid.parse((req.params as any).eventId);
    return await app.prisma.eventWorkPlanLine.findMany({
      where: { eventId },
      include: { skill: true, shift: true },
      orderBy: [{ date: "asc" }, { shift: { code: "asc" } }, { skill: { code: "asc" } }]
    });
  });

  app.post("/:eventId/plan", async (req) => {
    assertPermission(req as any, "resources:plan");
    const eventId = zUuid.parse((req.params as any).eventId);
    const body = z
      .object({
        date: zDateTime, // присылаем ISO (будем хранить startOfDay UTC)
        shiftId: zUuid,
        skillId: zUuid,
        plannedHeadcount: z.number().int().min(0).max(200).optional(),
        notes: z.string().trim().min(1).max(2000).optional()
      })
      .parse(req.body);

    const date = toUtcDayStart(body.date);

    return await app.prisma.eventWorkPlanLine.create({
      data: {
        eventId,
        date,
        shiftId: body.shiftId,
        skillId: body.skillId,
        plannedHeadcount: body.plannedHeadcount ?? 0,
        plannedMinutes: 0,
        notes: body.notes
      }
    });
  });

  app.delete("/plan/:id", async (req) => {
    assertPermission(req as any, "resources:plan");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.eventWorkPlanLine.delete({ where: { id } });
    return { ok: true };
  });

  // --- Факт по сменам (без персоналий): сколько людей было по смене/квалификации ---
  app.get("/:eventId/actual", async (req) => {
    assertPermission(req as any, "resources:read");
    const eventId = zUuid.parse((req.params as any).eventId);
    return await app.prisma.eventWorkActualLine.findMany({
      where: { eventId },
      include: { skill: true, shift: true },
      orderBy: [{ date: "asc" }, { shift: { code: "asc" } }, { skill: { code: "asc" } }]
    });
  });

  app.post("/:eventId/actual", async (req) => {
    assertPermission(req as any, "resources:actual");
    const eventId = zUuid.parse((req.params as any).eventId);
    const body = z
      .object({
        skillId: zUuid,
        shiftId: zUuid,
        date: zDateTime,
        actualHeadcount: z.number().int().min(0).max(200),
        notes: z.string().trim().min(1).max(2000).optional()
      })
      .parse(req.body);

    const date = toUtcDayStart(body.date);

    return await app.prisma.eventWorkActualLine.create({
      data: {
        eventId,
        skillId: body.skillId,
        shiftId: body.shiftId,
        date,
        actualHeadcount: body.actualHeadcount,
        notes: body.notes
      }
    });
  });

  app.delete("/actual/:id", async (req) => {
    assertPermission(req as any, "resources:actual");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.eventWorkActualLine.delete({ where: { id } });
    return { ok: true };
  });

  // --- Сводка потребности/факта (MVP) ---
  app.get("/:eventId/summary", async (req) => {
    assertPermission(req as any, "resources:read");
    const eventId = zUuid.parse((req.params as any).eventId);

    const [plan, actual] = await Promise.all([
      app.prisma.eventWorkPlanLine.findMany({ where: { eventId }, include: { skill: true, shift: true } }),
      app.prisma.eventWorkActualLine.findMany({ where: { eventId }, include: { skill: true, shift: true } })
    ]);

    return { ok: true, plan, actual };
  });
};

