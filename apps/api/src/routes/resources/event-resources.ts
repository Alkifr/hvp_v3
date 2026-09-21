import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";
import { UserMsg } from "../../lib/userErrors.js";
import { canWriteInContext, sandboxFilter, sandboxIdFor } from "../../plugins/sandbox.js";
import { durationDays, inclusiveCalendarDays } from "../../lib/primaryTable/formulaEngine.js";
import {
  LABOR_CARD_SERIES,
  LABOR_EDITABLE_BLOCKS,
  PRIMARY_METRIC_DEPARTMENTS,
  PRIMARY_METRIC_DEPARTMENT_LABEL,
  skillCodeToDepartment,
  type LaborEditableBlockCode
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

const zLaborBlock = z.enum(LABOR_EDITABLE_BLOCKS);
const zDepartment = z.enum(["ME", "AV", "INT", "NDT", "SHOP", "CAB_REP"]);

export const eventResourcesRoutes: FastifyPluginAsync = async (app) => {
  // --- Трудоёмкость WP (ч/ч) → EventReportMetric ---
  app.get("/:eventId/labor-metrics", async (req) => {
    assertPermission(req as any, "resources:read");
    const eventId = zUuid.parse((req.params as any).eventId);

    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req as any) },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        budgetStartAt: true,
        budgetEndAt: true,
        actualStartAt: true,
        actualEndAt: true
      }
    });
    if (!event) throw app.httpErrors.notFound(UserMsg.EVENT_NOT_FOUND);

    const [skills, metrics] = await Promise.all([
      app.prisma.skill.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
      app.prisma.eventReportMetric.findMany({
        where: {
          eventId,
          ...sandboxFilter(req as any),
          block: { in: [...LABOR_EDITABLE_BLOCKS] }
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

    const hoursOf = (block: LaborEditableBlockCode, department: (typeof PRIMARY_METRIC_DEPARTMENTS)[number]) =>
      valueByKey.get(`${block}:${department}`) ?? null;

    const series = LABOR_CARD_SERIES.map((def) => {
      const departments = PRIMARY_METRIC_DEPARTMENTS.map((department) => {
        const skill = skillByDepartment.get(department) ?? null;
        return {
          department,
          label: PRIMARY_METRIC_DEPARTMENT_LABEL[department],
          skillId: skill?.id ?? null,
          skillCode: skill?.code ?? department,
          manHours: hoursOf(def.hoursBlock, department),
          addHours: hoursOf(def.addBlock, department),
          nrcHours: hoursOf(def.nrcBlock, department)
        };
      });
      const sumCol = (pick: (row: (typeof departments)[number]) => number | null) =>
        departments.reduce<number | null>((sum, row) => {
          const value = pick(row);
          if (value == null) return sum;
          return (sum ?? 0) + value;
        }, null);
      return {
        key: def.key,
        label: def.label,
        hoursBlock: def.hoursBlock,
        addBlock: def.addBlock,
        nrcBlock: def.nrcBlock,
        departments,
        totalHours: sumCol((row) => row.manHours),
        totalAdd: sumCol((row) => row.addHours),
        totalNrc: sumCol((row) => row.nrcHours)
      };
    });

    return {
      ok: true as const,
      eventId,
      tatDays: {
        budget: inclusiveCalendarDays(event.budgetStartAt, event.budgetEndAt),
        mps: durationDays(event.startAt, event.endAt),
        actual: durationDays(event.actualStartAt, event.actualEndAt)
      },
      series,
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
    const byKey = new Map<string, (typeof body.values)[number]>();
    for (const row of body.values) byKey.set(`${row.block}:${row.department}`, row);
    const unique = Array.from(byKey.values());
    const filled = unique.filter((row) => row.manHours != null);

    await app.prisma.$transaction(
      async (tx) => {
        if (unique.length > 0) {
          await tx.eventReportMetric.deleteMany({
            where: {
              eventId,
              ...sandboxFilter(req as any),
              OR: unique.map((row) => ({ block: row.block, department: row.department }))
            }
          });
        }
        if (filled.length > 0) {
          await tx.eventReportMetric.createMany({
            data: filled.map((row) => ({
              eventId,
              sandboxId,
              block: row.block,
              department: row.department,
              manHours: row.manHours!,
              source: "MANUAL" as const
            }))
          });
        }
      },
      { timeout: 15_000, maxWait: 10_000 }
    );

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
