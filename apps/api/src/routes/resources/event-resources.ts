import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";
import { UserMsg } from "../../lib/userErrors.js";
import { canWriteInContext, sandboxFilter, sandboxIdFor } from "../../plugins/sandbox.js";
import {
  LABOR_METRIC_BLOCKS,
  PRIMARY_METRIC_DEPARTMENTS,
  PRIMARY_METRIC_DEPARTMENT_LABEL,
  skillCodeToDepartment,
  type LaborMetricBlockCode
} from "../../lib/primaryMetricDepartments.js";

function assertCanWrite(req: any) {
  if (!canWriteInContext(req)) {
    const err: any = new Error("SANDBOX_READ_ONLY");
    err.statusCode = 403;
    throw err;
  }
}

function toUtcDayStart(v: string | Date) {
  const d = v instanceof Date ? v : new Date(v);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

const zLaborBlock = z.enum(["LABOR_BUDGET", "WP_PLAN_MPS", "WP_ACTUAL"]);
const zDepartment = z.enum(["ME", "AV", "INT", "NDT", "SHOP", "CAB_REP"]);

export const eventResourcesRoutes: FastifyPluginAsync = async (app) => {
  // --- Трудоёмкость WP (ч/ч) → EventReportMetric ---
  app.get("/:eventId/labor-metrics", async (req) => {
    assertPermission(req as any, "resources:read");
    const eventId = zUuid.parse((req.params as any).eventId);

    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req as any) },
      select: { id: true }
    });
    if (!event) throw app.httpErrors.notFound(UserMsg.EVENT_NOT_FOUND);

    const [skills, metrics] = await Promise.all([
      app.prisma.skill.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
      app.prisma.eventReportMetric.findMany({
        where: {
          eventId,
          ...sandboxFilter(req as any),
          block: { in: LABOR_METRIC_BLOCKS.map((b) => b.block) }
        }
      })
    ]);

    const skillByDepartment = new Map<string, (typeof skills)[number]>();
    for (const skill of skills) {
      const department = skillCodeToDepartment(skill.code);
      if (!department) continue;
      const existing = skillByDepartment.get(department);
      if (!existing || skill.code === department) skillByDepartment.set(department, skill);
    }

    const valueByKey = new Map<string, number | null>();
    for (const metric of metrics) {
      valueByKey.set(`${metric.block}:${metric.department}`, metric.manHours == null ? null : Number(metric.manHours));
    }

    const blocks = LABOR_METRIC_BLOCKS.map((def) => {
      const departments = PRIMARY_METRIC_DEPARTMENTS.map((department) => {
        const skill = skillByDepartment.get(department) ?? null;
        return {
          department,
          label: PRIMARY_METRIC_DEPARTMENT_LABEL[department],
          skillId: skill?.id ?? null,
          skillCode: skill?.code ?? department,
          manHours: valueByKey.get(`${def.block}:${department}`) ?? null
        };
      });
      const total = departments.reduce<number | null>((sum, row) => {
        if (row.manHours == null) return sum;
        return (sum ?? 0) + row.manHours;
      }, null);
      return {
        block: def.block as LaborMetricBlockCode,
        label: def.label,
        hint: def.hint,
        departments,
        total
      };
    });

    return {
      ok: true as const,
      eventId,
      blocks,
      departments: PRIMARY_METRIC_DEPARTMENTS.map((department) => ({
        department,
        label: PRIMARY_METRIC_DEPARTMENT_LABEL[department],
        skillId: skillByDepartment.get(department)?.id ?? null
      }))
    };
  });

  app.put("/:eventId/labor-metrics", async (req) => {
    assertPermission(req as any, "resources:plan");
    assertCanWrite(req);
    const eventId = zUuid.parse((req.params as any).eventId);
    const body = z
      .object({
        values: z
          .array(
            z.object({
              block: zLaborBlock,
              department: zDepartment,
              manHours: z.number().finite().min(0).max(1_000_000).nullable()
            })
          )
          .max(64)
      })
      .parse(req.body);

    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req as any) },
      select: { id: true }
    });
    if (!event) throw app.httpErrors.notFound(UserMsg.EVENT_NOT_FOUND);

    const sandboxId = sandboxIdFor(req as any);

    await app.prisma.$transaction(async (tx) => {
      for (const row of body.values) {
        if (row.manHours == null) {
          await tx.eventReportMetric.deleteMany({
            where: {
              eventId,
              block: row.block,
              department: row.department,
              ...sandboxFilter(req as any)
            }
          });
          continue;
        }
        await tx.eventReportMetric.upsert({
          where: {
            eventId_block_department: {
              eventId,
              block: row.block,
              department: row.department
            }
          },
          create: {
            eventId,
            sandboxId,
            block: row.block,
            department: row.department,
            manHours: row.manHours,
            source: "MANUAL"
          },
          update: {
            manHours: row.manHours,
            sandboxId,
            source: "MANUAL"
          }
        });
      }
    });

    return { ok: true as const };
  });

  // --- План работ (по дню/смене/квалификации) — legacy API, UI скрыт ---
  app.get("/:eventId/plan", async (req) => {
    assertPermission(req as any, "resources:read");
    const eventId = zUuid.parse((req.params as any).eventId);
    return await app.prisma.eventWorkPlanLine.findMany({
      where: { eventId, ...sandboxFilter(req as any) },
      include: { skill: true, shift: true },
      orderBy: [{ date: "asc" }, { shift: { code: "asc" } }, { skill: { code: "asc" } }]
    });
  });

  app.post("/:eventId/plan", async (req) => {
    assertPermission(req as any, "resources:plan");
    assertCanWrite(req);
    const eventId = zUuid.parse((req.params as any).eventId);
    const body = z
      .object({
        date: zDateTime,
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
        sandboxId: sandboxIdFor(req as any),
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
    assertCanWrite(req);
    const id = zUuid.parse((req.params as any).id);
    const line = await app.prisma.eventWorkPlanLine.findFirst({
      where: { id, ...sandboxFilter(req as any) },
      select: { id: true }
    });
    if (!line) throw app.httpErrors.notFound(UserMsg.PLAN_LINE_NOT_FOUND);
    await app.prisma.eventWorkPlanLine.delete({ where: { id } });
    return { ok: true };
  });

  // --- Факт по сменам — legacy API, UI скрыт ---
  app.get("/:eventId/actual", async (req) => {
    assertPermission(req as any, "resources:read");
    const eventId = zUuid.parse((req.params as any).eventId);
    return await app.prisma.eventWorkActualLine.findMany({
      where: { eventId, ...sandboxFilter(req as any) },
      include: { skill: true, shift: true },
      orderBy: [{ date: "asc" }, { shift: { code: "asc" } }, { skill: { code: "asc" } }]
    });
  });

  app.post("/:eventId/actual", async (req) => {
    assertPermission(req as any, "resources:actual");
    assertCanWrite(req);
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
        sandboxId: sandboxIdFor(req as any),
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
    assertCanWrite(req);
    const id = zUuid.parse((req.params as any).id);
    const line = await app.prisma.eventWorkActualLine.findFirst({
      where: { id, ...sandboxFilter(req as any) },
      select: { id: true }
    });
    if (!line) throw app.httpErrors.notFound(UserMsg.ACTUAL_LINE_NOT_FOUND);
    await app.prisma.eventWorkActualLine.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/:eventId/summary", async (req) => {
    assertPermission(req as any, "resources:read");
    const eventId = zUuid.parse((req.params as any).eventId);

    const [plan, actual] = await Promise.all([
      app.prisma.eventWorkPlanLine.findMany({
        where: { eventId, ...sandboxFilter(req as any) },
        include: { skill: true, shift: true }
      }),
      app.prisma.eventWorkActualLine.findMany({
        where: { eventId, ...sandboxFilter(req as any) },
        include: { skill: true, shift: true }
      })
    ]);

    return { ok: true, plan, actual };
  });
};
