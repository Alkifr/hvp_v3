import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";
import { canWriteInContext, sandboxFilter, sandboxIdFor } from "../../plugins/sandbox.js";

const PLAN_STATUS = ["DRAFT", "IN_REVIEW", "READY", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const;
const NEED_CATEGORY = ["PERSONNEL", "MATERIAL", "TOOL", "DOCUMENTATION", "EQUIPMENT", "CONTRACTOR", "OTHER"] as const;
const NEED_STATUS = ["NEEDED", "REQUESTED", "IN_PROGRESS", "READY", "BLOCKED", "CANCELLED"] as const;
const STEP_STATUS = ["NOT_STARTED", "READY", "IN_PROGRESS", "BLOCKED", "DONE", "SKIPPED"] as const;

function assertCanRead(req: any) {
  assertPermission(req, "events:read");
}

function assertCanWrite(req: any) {
  if (req.sandbox) {
    if (!canWriteInContext(req)) {
      const err: any = new Error("SANDBOX_READ_ONLY");
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  assertPermission(req, "events:write");
}

const planInclude = {
  needs: { orderBy: [{ isBlocker: "desc" }, { requiredAt: "asc" }, { createdAt: "asc" }] },
  steps: {
    orderBy: [{ seq: "asc" }, { plannedStartAt: "asc" }, { createdAt: "asc" }],
    include: { predecessors: true, successors: true }
  },
  event: {
    include: {
      aircraft: { include: { operator: true, type: true } },
      eventType: true,
      hangar: true,
      layout: true
    }
  }
} satisfies Prisma.EventTechnicalPlanInclude;

async function assertEventInContext(app: any, req: any, eventId: string) {
  return await app.prisma.maintenanceEvent.findFirstOrThrow({
    where: { id: eventId, ...sandboxFilter(req) },
    include: {
      aircraft: { include: { operator: true, type: true } },
      eventType: true,
      hangar: true,
      layout: true
    }
  });
}

async function getPlanInContext(app: any, req: any, planId: string) {
  return await app.prisma.eventTechnicalPlan.findFirstOrThrow({
    where: { id: planId, ...sandboxFilter(req) },
    include: planInclude
  });
}

async function getNeedInContext(app: any, req: any, needId: string) {
  return await app.prisma.eventTechnicalNeed.findFirstOrThrow({
    where: { id: needId, ...sandboxFilter(req) },
    include: { plan: true }
  });
}

async function getStepInContext(app: any, req: any, stepId: string) {
  return await app.prisma.eventTechnicalStep.findFirstOrThrow({
    where: { id: stepId, ...sandboxFilter(req) },
    include: { plan: true }
  });
}

function assertPeriod(start?: Date | null, end?: Date | null, label = "period") {
  if (start && end && end <= start) throw new Error(`${label} end must be after start`);
}

const zPlanPatch = z.object({
  status: z.enum(PLAN_STATUS).optional(),
  leadEngineer: z.string().trim().max(160).nullable().optional(),
  readinessPct: z.number().int().min(0).max(100).optional(),
  notes: z.string().trim().max(2000).nullable().optional()
});

const zNeedInput = z.object({
  category: z.enum(NEED_CATEGORY),
  description: z.string().trim().min(1).max(500),
  quantity: z.string().trim().max(80).nullable().optional(),
  requiredAt: zDateTime.nullable().optional(),
  responsible: z.string().trim().max(160).nullable().optional(),
  status: z.enum(NEED_STATUS).optional(),
  isBlocker: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});

const zNeedPatch = zNeedInput.partial();

const zStepBase = z.object({
  seq: z.number().int().min(0).optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(1000).nullable().optional(),
  responsible: z.string().trim().max(160).nullable().optional(),
  plannedStartAt: zDateTime.nullable().optional(),
  plannedEndAt: zDateTime.nullable().optional(),
  actualStartAt: zDateTime.nullable().optional(),
  actualEndAt: zDateTime.nullable().optional(),
  status: z.enum(STEP_STATUS).optional(),
  progressPct: z.number().int().min(0).max(100).optional(),
  isBlocker: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});

function refineStepPeriods(v: { plannedStartAt?: Date | null; plannedEndAt?: Date | null; actualStartAt?: Date | null; actualEndAt?: Date | null }, ctx: z.RefinementCtx) {
    if (v.plannedStartAt && v.plannedEndAt && v.plannedEndAt <= v.plannedStartAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "plannedEndAt must be after plannedStartAt", path: ["plannedEndAt"] });
    }
    if (v.actualStartAt && v.actualEndAt && v.actualEndAt <= v.actualStartAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "actualEndAt must be after actualStartAt", path: ["actualEndAt"] });
    }
}

const zStepInput = zStepBase.superRefine(refineStepPeriods);

const zStepPatch = zStepBase.partial().superRefine(refineStepPeriods);

export const technicalPlansRoutes: FastifyPluginAsync = async (app) => {
  app.get("/events", async (req) => {
    assertCanRead(req as any);
    const query = z
      .object({
        from: zDateTime.optional(),
        to: zDateTime.optional(),
        q: z.string().trim().max(200).optional()
      })
      .parse(req.query);

    const where: Prisma.MaintenanceEventWhereInput = {
      ...sandboxFilter(req as any),
      status: { not: "DELETED" }
    };
    if (query.from && query.to) {
      where.AND = [{ startAt: { lt: query.to } }, { endAt: { gt: query.from } }];
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: "insensitive" } },
        { aircraft: { tailNumber: { contains: query.q, mode: "insensitive" } } },
        { eventType: { name: { contains: query.q, mode: "insensitive" } } }
      ];
    }

    return await app.prisma.maintenanceEvent.findMany({
      where,
      include: {
        aircraft: { include: { operator: true, type: true } },
        eventType: true,
        hangar: true,
        layout: true,
        technicalPlan: { include: { needs: true, steps: true } }
      },
      orderBy: [{ startAt: "asc" }]
    });
  });

  app.get("/events/:eventId/plan", async (req) => {
    assertCanRead(req as any);
    const eventId = zUuid.parse((req.params as any).eventId);
    await assertEventInContext(app, req, eventId);
    return await app.prisma.eventTechnicalPlan.findUnique({
      where: { eventId },
      include: planInclude
    });
  });

  app.post("/events/:eventId/plan", async (req) => {
    assertCanWrite(req as any);
    const eventId = zUuid.parse((req.params as any).eventId);
    const body = zPlanPatch.parse(req.body ?? {});
    const event = await assertEventInContext(app, req, eventId);
    const sandboxId = sandboxIdFor(req as any);
    return await app.prisma.eventTechnicalPlan.upsert({
      where: { eventId },
      create: {
        eventId,
        sandboxId,
        status: body.status ?? "DRAFT",
        leadEngineer: body.leadEngineer ?? null,
        readinessPct: body.readinessPct ?? 0,
        notes: body.notes ?? null
      },
      update: {
        status: body.status,
        leadEngineer: body.leadEngineer,
        readinessPct: body.readinessPct,
        notes: body.notes,
        sandboxId: event.sandboxId ?? sandboxId
      },
      include: planInclude
    });
  });

  app.patch("/:planId", async (req) => {
    assertCanWrite(req as any);
    const planId = zUuid.parse((req.params as any).planId);
    const body = zPlanPatch.parse(req.body);
    await getPlanInContext(app, req, planId);
    return await app.prisma.eventTechnicalPlan.update({
      where: { id: planId },
      data: body,
      include: planInclude
    });
  });

  app.post("/:planId/needs", async (req) => {
    assertCanWrite(req as any);
    const planId = zUuid.parse((req.params as any).planId);
    const body = zNeedInput.parse(req.body);
    const plan = await getPlanInContext(app, req, planId);
    return await app.prisma.eventTechnicalNeed.create({
      data: { ...body, planId, sandboxId: plan.sandboxId ?? sandboxIdFor(req as any) }
    });
  });

  app.patch("/needs/:needId", async (req) => {
    assertCanWrite(req as any);
    const needId = zUuid.parse((req.params as any).needId);
    const body = zNeedPatch.parse(req.body);
    await getNeedInContext(app, req, needId);
    return await app.prisma.eventTechnicalNeed.update({ where: { id: needId }, data: body });
  });

  app.delete("/needs/:needId", async (req) => {
    assertCanWrite(req as any);
    const needId = zUuid.parse((req.params as any).needId);
    await getNeedInContext(app, req, needId);
    await app.prisma.eventTechnicalNeed.delete({ where: { id: needId } });
    return { ok: true };
  });

  app.post("/:planId/steps", async (req) => {
    assertCanWrite(req as any);
    const planId = zUuid.parse((req.params as any).planId);
    const body = zStepInput.parse(req.body);
    const plan = await getPlanInContext(app, req, planId);
    assertPeriod(body.plannedStartAt, body.plannedEndAt, "planned");
    assertPeriod(body.actualStartAt, body.actualEndAt, "actual");
    return await app.prisma.eventTechnicalStep.create({
      data: { ...body, planId, sandboxId: plan.sandboxId ?? sandboxIdFor(req as any) }
    });
  });

  app.patch("/steps/:stepId", async (req) => {
    assertCanWrite(req as any);
    const stepId = zUuid.parse((req.params as any).stepId);
    const body = zStepPatch.parse(req.body);
    const existing = await getStepInContext(app, req, stepId);
    assertPeriod(body.plannedStartAt ?? existing.plannedStartAt, body.plannedEndAt ?? existing.plannedEndAt, "planned");
    assertPeriod(body.actualStartAt ?? existing.actualStartAt, body.actualEndAt ?? existing.actualEndAt, "actual");
    return await app.prisma.eventTechnicalStep.update({ where: { id: stepId }, data: body });
  });

  app.delete("/steps/:stepId", async (req) => {
    assertCanWrite(req as any);
    const stepId = zUuid.parse((req.params as any).stepId);
    await getStepInContext(app, req, stepId);
    await app.prisma.eventTechnicalStep.delete({ where: { id: stepId } });
    return { ok: true };
  });

  app.put("/steps/:stepId/dependencies", async (req) => {
    assertCanWrite(req as any);
    const stepId = zUuid.parse((req.params as any).stepId);
    const body = z.object({ predecessorStepIds: z.array(zUuid).default([]) }).parse(req.body);
    const step = await getStepInContext(app, req, stepId);
    const predecessorIds = body.predecessorStepIds.filter((id) => id !== stepId);
    const predecessors = predecessorIds.length
      ? await app.prisma.eventTechnicalStep.findMany({ where: { id: { in: predecessorIds }, planId: step.planId, ...sandboxFilter(req as any) } })
      : [];
    if (predecessors.length !== predecessorIds.length) throw new Error("Some predecessor steps are not in the same plan");

    await app.prisma.$transaction([
      app.prisma.eventTechnicalStepDependency.deleteMany({ where: { successorStepId: stepId } }),
      ...predecessorIds.map((predecessorStepId) =>
        app.prisma.eventTechnicalStepDependency.create({
          data: { predecessorStepId, successorStepId: stepId }
        })
      )
    ]);
    return await app.prisma.eventTechnicalStep.findUniqueOrThrow({
      where: { id: stepId },
      include: { predecessors: true, successors: true }
    });
  });
};
