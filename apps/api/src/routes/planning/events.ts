import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, EventStatus, PlanningLevel, Prisma } from "@prisma/client";

import { parseImportDateTime } from "../../lib/localDate.js";
import {
  DONE_SCHEDULE_LOCK_MESSAGE,
  isDoneScheduleLocked,
  patchTouchesDoneScheduleLock,
  reconcileEventStatus
} from "../../lib/eventStatus.js";
import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";
import { canWriteInContext, sandboxFilter, sandboxIdFor } from "../../plugins/sandbox.js";

const PLANNING_KIND_VALUES = ["PLANNED", "UNPLANNED"] as const;
type PlanningKind = (typeof PLANNING_KIND_VALUES)[number];

function assertCanWrite(req: any) {
  if (!canWriteInContext(req)) {
    const err: any = new Error("SANDBOX_READ_ONLY");
    err.statusCode = 403;
    throw err;
  }
}

function assertCanWriteEvent(req: any) {
  if (req.sandbox) {
    assertCanWrite(req);
    return;
  }
  assertPermission(req, "events:write");
}

const IMPORT_FIELD_LABELS: Record<string, string> = {
  Aircraft: "Aircraft (борт)",
  Event_name: "Event_name (тип события)",
  startAt: "startAt (начало)",
  endAt: "endAt (окончание)",
  Operator: "Operator (оператор)",
  AircraftType: "AircraftType (тип ВС)",
  Event_Title: "Event_Title (название)",
  Hangar: "Hangar (ангар)",
  HangarStand: "HangarStand (место)"
};

function formatEventImportSchemaError(error: z.ZodError): string {
  const missingFields = new Set<string>();
  const invalidFields = new Set<string>();
  const badRowIndexes = new Set<number>();

  for (const issue of error.issues) {
    if (issue.path[0] !== "rows" || typeof issue.path[1] !== "number") continue;
    badRowIndexes.add(issue.path[1]);
    const field = typeof issue.path[2] === "string" ? issue.path[2] : null;
    if (!field) continue;
    if (issue.code === "invalid_type" && (issue as any).received === "undefined") missingFields.add(field);
    else invalidFields.add(field);
  }

  const label = (field: string) => IMPORT_FIELD_LABELS[field] ?? field;
  const parts: string[] = ["Файл не подходит для импорта событий."];

  if (missingFields.size > 0) {
    parts.push(`Не найдены обязательные колонки: ${[...missingFields].map(label).join(", ")}.`);
  } else if (invalidFields.size > 0) {
    parts.push(`Некорректные значения в колонках: ${[...invalidFields].map(label).join(", ")}.`);
  }

  if (badRowIndexes.size > 0) {
    parts.push(`Проблемных строк: ${badRowIndexes.size}.`);
  }

  parts.push(
    "Ожидаемая шапка: Operator, Aircraft, AircraftType, Event_Title, Event_name, startAt, endAt (опционально budget*/actual*/tow*, Hangar, HangarStand)."
  );
  parts.push("Если это файл массового планирования — откройте раздел «Массовое планирование», а не «Импорт».");

  return parts.join(" ");
}

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  const h = req.headers ?? {};
  return String(h["x-actor"] ?? h["x-user"] ?? "browser").slice(0, 80);
}

/** Подпись борта для сообщений (реальный или виртуальный) */
function eventAircraftLabel(event: { aircraft?: { tailNumber: string } | null; virtualAircraft?: unknown } | null): string {
  if (!event) return "—";
  if (event.aircraft?.tailNumber) return event.aircraft.tailNumber;
  const v = event.virtualAircraft as { label?: string } | null | undefined;
  return (v?.label ?? "—") as string;
}

function diffEvent(before: any, after: any) {
  const fields = [
    "title",
    "level",
    "status",
    "planningKind",
    "aircraftId",
    "eventTypeId",
    "startAt",
    "endAt",
    "budgetStartAt",
    "budgetEndAt",
    "actualStartAt",
    "actualEndAt",
    "hangarId",
    "layoutId",
    "notes",
    "virtualAircraft"
  ] as const;

  const changes: Record<string, { from: any; to: any }> = {};
  for (const f of fields) {
    const b = before[f];
    const a = after[f];
    const bv = b instanceof Date ? b.toISOString() : b;
    const av = a instanceof Date ? a.toISOString() : a;
    if (bv !== av) changes[f] = { from: bv ?? null, to: av ?? null };
  }
  return changes;
}

function planningKindFromBudget(budgetStartAt: Date | null | undefined, budgetEndAt: Date | null | undefined): PlanningKind {
  return budgetStartAt && budgetEndAt ? "PLANNED" : "UNPLANNED";
}

function normalizeCreatePlanningPeriod(params: {
  planningKind?: PlanningKind;
  startAt: Date;
  endAt: Date;
  budgetStartAt?: Date | null;
  budgetEndAt?: Date | null;
}) {
  if (params.planningKind === "UNPLANNED") {
    return { planningKind: "UNPLANNED" as const, budgetStartAt: null, budgetEndAt: null };
  }

  if (params.planningKind === "PLANNED" && !params.budgetStartAt && !params.budgetEndAt) {
    return { planningKind: "PLANNED" as const, budgetStartAt: params.startAt, budgetEndAt: params.endAt };
  }

  const planningKind = params.planningKind ?? planningKindFromBudget(params.budgetStartAt, params.budgetEndAt);
  return {
    planningKind,
    budgetStartAt: params.budgetStartAt ?? null,
    budgetEndAt: params.budgetEndAt ?? null
  };
}

function normalizePatchPlanningPeriod(params: {
  existing: any;
  planningKind?: PlanningKind;
  startAt: Date;
  endAt: Date;
  budgetStartAt?: Date | null;
  budgetEndAt?: Date | null;
}) {
  if (params.planningKind === "UNPLANNED") {
    return { planningKind: "UNPLANNED" as const, budgetStartAt: null, budgetEndAt: null };
  }

  const nextBudgetStart = params.budgetStartAt === undefined ? (params.existing as any).budgetStartAt : params.budgetStartAt;
  const nextBudgetEnd = params.budgetEndAt === undefined ? (params.existing as any).budgetEndAt : params.budgetEndAt;

  if (params.planningKind === "PLANNED" && !nextBudgetStart && !nextBudgetEnd) {
    return { planningKind: "PLANNED" as const, budgetStartAt: params.startAt, budgetEndAt: params.endAt };
  }

  const budgetChanged = params.budgetStartAt !== undefined || params.budgetEndAt !== undefined;
  const planningKind =
    params.planningKind ?? (budgetChanged ? planningKindFromBudget(nextBudgetStart, nextBudgetEnd) : ((params.existing as any).planningKind ?? planningKindFromBudget(nextBudgetStart, nextBudgetEnd)));

  return {
    planningKind,
    budgetStartAt: nextBudgetStart ?? null,
    budgetEndAt: nextBudgetEnd ?? null
  };
}

const placementInclude = {
  hangar: true,
  layout: true,
  stand: true,
  reservation: { include: { stand: true } }
};

const eventInclude: Prisma.MaintenanceEventInclude = {
  aircraft: { include: { operator: true, type: true } },
  eventType: true,
  hangar: true,
  layout: true,
  workshop: true,
  reservations: { include: { stand: true }, orderBy: [{ startAt: "asc" }] },
  placements: { include: placementInclude, orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }] },
  towSegments: { orderBy: [{ startAt: "asc" }] }
};

function serializeEvent(event: any) {
  const reservations = event.reservations ?? [];
  const placements = event.placements ?? [];
  return {
    ...event,
    reservation: reservations[0] ?? null,
    placements
  };
}

function defaultPlacementFromEvent(event: any) {
  const reservation = event.reservations?.[0] ?? event.reservation ?? null;
  return {
    startAt: reservation?.startAt ?? event.startAt,
    endAt: reservation?.endAt ?? event.endAt,
    budgetStartAt: event.budgetStartAt ?? null,
    budgetEndAt: event.budgetEndAt ?? null,
    actualStartAt: event.actualStartAt ?? null,
    actualEndAt: event.actualEndAt ?? null,
    hangarId: event.hangarId ?? event.layout?.hangarId ?? null,
    layoutId: reservation?.layoutId ?? event.layoutId ?? null,
    standId: reservation?.standId ?? null,
    sortOrder: 0
  };
}

const zPlacementInput = z.object({
  id: zUuid.optional(),
  startAt: zDateTime,
  endAt: zDateTime,
  budgetStartAt: zDateTime.nullable().optional(),
  budgetEndAt: zDateTime.nullable().optional(),
  actualStartAt: zDateTime.nullable().optional(),
  actualEndAt: zDateTime.nullable().optional(),
  hangarId: zUuid.nullable().optional(),
  layoutId: zUuid.nullable().optional(),
  standId: zUuid.nullable().optional(),
  sortOrder: z.number().int().min(0).optional()
});

type PlacementInput = z.infer<typeof zPlacementInput>;

function assertPlacementPeriods(placements: PlacementInput[], eventStart: Date, eventEnd: Date) {
  const sorted = [...placements].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    if (p.endAt <= p.startAt) throw new Error("Placement endAt must be after startAt");
    if (Boolean(p.budgetStartAt) !== Boolean(p.budgetEndAt)) {
      throw new Error("Placement budget period must have both dates");
    }
    if (p.budgetStartAt && p.budgetEndAt && p.budgetEndAt <= p.budgetStartAt) {
      throw new Error("Placement budgetEndAt must be after budgetStartAt");
    }
    if (Boolean(p.actualStartAt) !== Boolean(p.actualEndAt)) {
      throw new Error("Placement actual period must have both dates");
    }
    if (p.actualStartAt && p.actualEndAt && p.actualEndAt <= p.actualStartAt) {
      throw new Error("Placement actualEndAt must be after actualStartAt");
    }
    if (p.startAt < eventStart || p.endAt > eventEnd) {
      throw new Error("Placement interval must be within event startAt/endAt");
    }
    const prev = sorted[i - 1];
    if (prev && prev.endAt > p.startAt) {
      throw new Error("Placement intervals must not overlap");
    }
  }
}

async function resolvePlacementLocation(tx: any, p: PlacementInput) {
  let layoutId = p.layoutId ?? null;
  let hangarId = p.hangarId ?? null;
  let standId = p.standId ?? null;

  if (standId) {
    const stand = await tx.hangarStand.findUnique({
      where: { id: standId },
      include: { layout: { select: { id: true, hangarId: true } } }
    });
    if (!stand) throw new Error("Stand not found");
    if (layoutId && stand.layoutId !== layoutId) throw new Error("Stand does not belong to selected layout");
    layoutId = stand.layoutId;
    hangarId = stand.layout.hangarId;
  } else if (layoutId) {
    const layout = await tx.hangarLayout.findUnique({
      where: { id: layoutId },
      select: { id: true, hangarId: true }
    });
    if (!layout) throw new Error("Layout not found");
    if (hangarId && layout.hangarId !== hangarId) throw new Error("Layout does not belong to selected hangar");
    hangarId = layout.hangarId;
  }

  return { hangarId, layoutId, standId };
}

async function assertPlacementConflicts(tx: any, params: {
  sandboxId: string | null;
  eventId: string;
  hangarId: string | null;
  layoutId: string | null;
  standId: string | null;
  startAt: Date;
  endAt: Date;
  allowOverlap?: boolean;
}) {
  if (params.allowOverlap) return;

  if (params.standId) {
    const conflict = await tx.standReservation.findFirst({
      where: {
        sandboxId: params.sandboxId,
        standId: params.standId,
        eventId: { not: params.eventId },
        startAt: { lt: params.endAt },
        endAt: { gt: params.startAt },
        event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
      },
      include: { event: { include: { aircraft: true } } }
    });
    if (conflict) {
      throw new Error(`Место уже занято: ${conflict.event.title} (${eventAircraftLabel(conflict.event)})`);
    }
  }

  if (params.hangarId && params.layoutId) {
    const layoutConflict = await tx.standReservation.findFirst({
      where: {
        sandboxId: params.sandboxId,
        eventId: { not: params.eventId },
        layoutId: { not: params.layoutId },
        startAt: { lt: params.endAt },
        endAt: { gt: params.startAt },
        layout: { hangarId: params.hangarId },
        event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
      },
      include: { layout: { select: { name: true } }, event: { include: { aircraft: true } } },
      orderBy: [{ startAt: "asc" }]
    });
    if (layoutConflict) {
      throw new Error(
        `В этот период в ангаре уже используется другая схема расстановки: ${layoutConflict.layout?.name ?? "другая схема"} (${layoutConflict.event.title}, ${eventAircraftLabel(layoutConflict.event)})`
      );
    }
  }
}

async function replaceEventPlacements(tx: any, params: {
  eventId: string;
  sandboxId: string | null;
  eventStart: Date;
  eventEnd: Date;
  placements: PlacementInput[];
  allowOverlap?: boolean;
}) {
  const placements = params.placements.length
    ? [...params.placements].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.startAt.getTime() - b.startAt.getTime())
    : [{
        startAt: params.eventStart,
        endAt: params.eventEnd,
        budgetStartAt: null,
        budgetEndAt: null,
        actualStartAt: null,
        actualEndAt: null,
        hangarId: null,
        layoutId: null,
        standId: null,
        sortOrder: 0
      }];

  assertPlacementPeriods(placements, params.eventStart, params.eventEnd);

  await tx.standReservation.deleteMany({ where: { eventId: params.eventId } });
  await tx.eventPlacement.deleteMany({ where: { eventId: params.eventId } });

  let firstLocation: { hangarId: string | null; layoutId: string | null } = { hangarId: null, layoutId: null };
  for (const [idx, p] of placements.entries()) {
    const location = await resolvePlacementLocation(tx, p);
    if (idx === 0) firstLocation = { hangarId: location.hangarId, layoutId: location.layoutId };
    await assertPlacementConflicts(tx, {
      sandboxId: params.sandboxId,
      eventId: params.eventId,
      hangarId: location.hangarId,
      layoutId: location.layoutId,
      standId: location.standId,
      startAt: p.startAt,
      endAt: p.endAt,
      allowOverlap: params.allowOverlap
    });

    const placement = await tx.eventPlacement.create({
      data: {
        eventId: params.eventId,
        sandboxId: params.sandboxId,
        startAt: p.startAt,
        endAt: p.endAt,
        budgetStartAt: p.budgetStartAt ?? null,
        budgetEndAt: p.budgetEndAt ?? null,
        actualStartAt: p.actualStartAt ?? null,
        actualEndAt: p.actualEndAt ?? null,
        hangarId: location.hangarId,
        layoutId: location.layoutId,
        standId: location.standId,
        sortOrder: idx
      }
    });

    if (location.layoutId && location.standId) {
      await tx.standReservation.create({
        data: {
          eventId: params.eventId,
          placementId: placement.id,
          sandboxId: params.sandboxId,
          layoutId: location.layoutId,
          standId: location.standId,
          startAt: p.startAt,
          endAt: p.endAt
        }
      });
    }
  }

  await tx.maintenanceEvent.update({
    where: { id: params.eventId },
    data: { hangarId: firstLocation.hangarId, layoutId: firstLocation.layoutId }
  });
}

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  // Важно для производительности: UI будет запрашивать события по диапазону дат
  app.get("/", async (req) => {
    assertPermission(req, "events:read");
    const query = z
      .object({
        from: zDateTime.optional(),
        to: zDateTime.optional(),
        hangarId: zUuid.optional(),
        layoutId: zUuid.optional(),
        aircraftId: zUuid.optional(),
        aircraftTypeId: zUuid.optional(),
        level: z.nativeEnum(PlanningLevel).optional()
      })
      .parse(req.query ?? {});

    const from = query.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ?? new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

    const rows = await app.prisma.maintenanceEvent.findMany({
      where: {
        ...sandboxFilter(req),
        status: { not: EventStatus.DELETED },
        ...(query.level ? { level: query.level } : {}),
        ...(query.hangarId ? { OR: [{ hangarId: query.hangarId }, { placements: { some: { hangarId: query.hangarId } } }] } : {}),
        ...(query.layoutId ? { OR: [{ layoutId: query.layoutId }, { placements: { some: { layoutId: query.layoutId } } }] } : {}),
        ...(query.aircraftId ? { aircraftId: query.aircraftId } : {}),
        ...(query.aircraftTypeId ? { aircraft: { typeId: query.aircraftTypeId } } : {}),
        // пересечение диапазонов [startAt, endAt): оперативный план, факт и этапы размещения.
        OR: [
          { startAt: { lt: to }, endAt: { gt: from } },
          { actualStartAt: { lt: to }, actualEndAt: { gt: from } },
          { placements: { some: { startAt: { lt: to }, endAt: { gt: from } } } },
          { placements: { some: { actualStartAt: { lt: to }, actualEndAt: { gt: from } } } }
        ]
      },
      include: eventInclude,
      orderBy: [{ startAt: "asc" }]
    });
    return rows.map(serializeEvent);
  });

  // Карточка по id (без диапазона дат) — для deep-link / уведомлений
  app.get("/:id", async (req) => {
    assertPermission(req, "events:read");
    const id = zUuid.parse((req.params as any).id);
    const row = await app.prisma.maintenanceEvent.findFirst({
      where: { id, ...sandboxFilter(req), status: { not: EventStatus.DELETED } },
      include: eventInclude
    });
    if (!row) throw app.httpErrors.notFound("Event not found");
    return serializeEvent(row);
  });

  // --- Буксировки (интервалы) ---
  app.get("/:id/tows", async (req) => {
    assertPermission(req, "events:read");
    const eventId = zUuid.parse((req.params as any).id);
    return await app.prisma.eventTow.findMany({
      where: { eventId, ...sandboxFilter(req) },
      orderBy: [{ startAt: "asc" }]
    });
  });

  app.post("/:id/tows", async (req) => {
    assertCanWriteEvent(req);
    const eventId = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        startAt: zDateTime,
        endAt: zDateTime,
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt" })
      .parse(req.body);

    const ev = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req) }
    });
    if (!ev) throw app.httpErrors.notFound("Event not found");
    if (isDoneScheduleLocked(ev.status)) {
      throw app.httpErrors.badRequest(DONE_SCHEDULE_LOCK_MESSAGE);
    }
    if (body.startAt < ev.startAt || body.endAt > ev.endAt) {
      throw app.httpErrors.badRequest("Tow interval must be within event startAt/endAt");
    }

    const sbId = sandboxIdFor(req);
    const created = await app.prisma.eventTow.create({
      data: { eventId, startAt: body.startAt, endAt: body.endAt, sandboxId: sbId }
    });

    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId,
        sandboxId: sbId,
        action: EventAuditAction.UPDATE,
        actor: getActor(req),
        reason: body.changeReason ?? "Буксировка",
        changes: {
          tow: { add: { id: created.id, startAt: created.startAt.toISOString(), endAt: created.endAt.toISOString() } }
        }
      }
    });

    return created;
  });

  app.delete("/:id/tows/:towId", async (req) => {
    assertCanWriteEvent(req);
    const eventId = zUuid.parse((req.params as any).id);
    const towId = zUuid.parse((req.params as any).towId);
    const query = z
      .object({
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .parse((req.query ?? {}) as any);

    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req) },
      select: { id: true, status: true }
    });
    if (!event) throw app.httpErrors.notFound("Event not found");
    if (isDoneScheduleLocked(event.status)) {
      throw app.httpErrors.badRequest(DONE_SCHEDULE_LOCK_MESSAGE);
    }

    const existing = await app.prisma.eventTow.findFirst({
      where: { id: towId, eventId, ...sandboxFilter(req) }
    });
    if (!existing) return { ok: true, deleted: 0 };

    await app.prisma.eventTow.delete({ where: { id: towId } });
    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId,
        sandboxId: sandboxIdFor(req),
        action: EventAuditAction.UPDATE,
        actor: getActor(req),
        reason: query.changeReason ?? "Буксировка",
        changes: { tow: { delete: { id: towId } } }
      }
    });
    return { ok: true, deleted: 1 };
  });

  app.get("/:id/placements", async (req) => {
    assertPermission(req, "events:read");
    const eventId = zUuid.parse((req.params as any).id);
    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req) },
      select: { id: true }
    });
    if (!event) throw app.httpErrors.notFound("Event not found");
    return await app.prisma.eventPlacement.findMany({
      where: { eventId, ...sandboxFilter(req) },
      include: placementInclude,
      orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }]
    });
  });

  app.put("/:id/placements", async (req) => {
    assertCanWriteEvent(req);
    const eventId = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        placements: z.array(zPlacementInput).min(1).max(50),
        changeReason: z.string().trim().min(1).max(1000),
        allowOverlap: z.boolean().optional().default(false)
      })
      .parse(req.body);

    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req) },
      include: { placements: true }
    });
    if (!event) throw app.httpErrors.notFound("Event not found");
    if (isDoneScheduleLocked(event.status)) {
      throw app.httpErrors.badRequest(DONE_SCHEDULE_LOCK_MESSAGE);
    }

    const sbId = sandboxIdFor(req);
    const before = event.placements.map((p) => ({
      startAt: p.startAt.toISOString(),
      endAt: p.endAt.toISOString(),
      budgetStartAt: p.budgetStartAt?.toISOString() ?? null,
      budgetEndAt: p.budgetEndAt?.toISOString() ?? null,
      actualStartAt: p.actualStartAt?.toISOString() ?? null,
      actualEndAt: p.actualEndAt?.toISOString() ?? null,
      hangarId: p.hangarId ?? null,
      layoutId: p.layoutId ?? null,
      standId: p.standId ?? null
    }));

    await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await replaceEventPlacements(tx, {
        eventId,
        sandboxId: sbId,
        eventStart: event.startAt,
        eventEnd: event.endAt,
        placements: body.placements,
        allowOverlap: body.allowOverlap
      });
      await tx.maintenanceEventAudit.create({
        data: {
          eventId,
          sandboxId: sbId,
          action: EventAuditAction.UPDATE,
          actor: getActor(req),
          reason: body.changeReason,
          changes: {
            placements: {
              from: before,
              to: body.placements.map((p) => ({
                startAt: p.startAt.toISOString(),
                endAt: p.endAt.toISOString(),
                budgetStartAt: p.budgetStartAt?.toISOString() ?? null,
                budgetEndAt: p.budgetEndAt?.toISOString() ?? null,
                actualStartAt: p.actualStartAt?.toISOString() ?? null,
                actualEndAt: p.actualEndAt?.toISOString() ?? null,
                hangarId: p.hangarId ?? null,
                layoutId: p.layoutId ?? null,
                standId: p.standId ?? null
              }))
            }
          }
        }
      });
    });

    const reloaded = await app.prisma.maintenanceEvent.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
    return serializeEvent(reloaded);
  });

  // Импорт событий из Excel/CSV (UI парсит файл и отправляет строки в JSON).
  // Поддерживает dryRun=true для "предпросмотра" без создания.
  app.post("/import", async (req) => {
    assertCanWriteEvent(req);

    const zOptionalDateCell = z.union([z.string(), z.date(), z.number(), z.null()]).optional();
    const parsed = z
      .object({
        dryRun: z.boolean().optional(),
        rows: z
          .array(
            z.object({
              Operator: z.string().optional(),
              Aircraft: z.string(),
              AircraftType: z.string().optional(),
              Event_Title: z.string().optional(),
              Event_name: z.string(),
              startAt: z.union([z.string(), z.date(), z.number()]),
              endAt: z.union([z.string(), z.date(), z.number()]),
              budgetStartAt: zOptionalDateCell,
              budgetEndAt: zOptionalDateCell,
              actualStartAt: zOptionalDateCell,
              actualEndAt: zOptionalDateCell,
              towStartAt: zOptionalDateCell,
              towEndAt: zOptionalDateCell,
              Hangar: z.string().optional(),
              HangarStand: z.string().optional()
            })
          )
          .min(1)
          .max(5000)
      })
      .safeParse(req.body);

    if (!parsed.success) {
      const err: any = new Error(formatEventImportSchemaError(parsed.error));
      err.statusCode = 400;
      throw err;
    }

    const body = parsed.data;

    const norm = (s: unknown) =>
      String(s ?? "")
        .normalize("NFKC")
        .replace(/^\uFEFF/, "")
        .replace(/\u00A0/g, " ")
        .replace(/[‐‑‒–—―−]/g, "-")
        .trim()
        .replace(/^"+|"+$/g, "");

    const key = (s: unknown) => norm(s).toLocaleLowerCase("ru-RU");
    const upper = (s: unknown) => norm(s).toLocaleUpperCase("ru-RU");
    const lower = key;

    // Naive даты/Excel serial → wall clock MSK; ISO с Z/offset — абсолютные.
    const parseDate = (v: string | number | Date) => parseImportDateTime(v);
    const parseOptionalDate = (v: string | number | Date | null | undefined, label: string) => {
      if (v == null) return null;
      if (typeof v === "string" && norm(v) === "") return null;
      const d = parseDate(v);
      if (!Number.isFinite(d.valueOf())) throw new Error(`Некорректная дата ${label}: ${String(v)}`);
      return d;
    };
    const validateOptionalPeriod = (start: Date | null, end: Date | null, label: string) => {
      if ((start && !end) || (!start && end)) throw new Error(`Заполните обе даты периода "${label}"`);
      if (start && end && end <= start) throw new Error(`Окончание периода "${label}" должно быть позже начала`);
    };

    const rows = body.rows;
    const dryRun = Boolean(body.dryRun);

    // --- Prefetch справочников/связей для быстрого импорта ---
    const tailSet = new Set<string>();
    const eventKeySet = new Set<string>();
    const hangarKeySet = new Set<string>();
    const hangarStandPairs: Array<{ hangarKey: string; standCode: string }> = [];

    for (const r of rows) {
      tailSet.add(upper(r.Aircraft));
      eventKeySet.add(key(r.Event_name));
      const hk = lower(r.Hangar);
      if (hk) hangarKeySet.add(hk);
      const sc = upper(r.HangarStand);
      if (hk && sc) hangarStandPairs.push({ hangarKey: hk, standCode: sc });
    }

    const [aircraftAll, eventTypesAll, hangarsAll] = await Promise.all([
      app.prisma.aircraft.findMany({ include: { operator: true, type: true } }),
      app.prisma.eventType.findMany(),
      app.prisma.hangar.findMany()
    ]);

    const aircraftByTail = new Map<string, (typeof aircraftAll)[number]>();
    for (const a of aircraftAll) aircraftByTail.set(upper(a.tailNumber), a);

    const eventTypeByKey = new Map<string, (typeof eventTypesAll)[number]>();
    for (const et of eventTypesAll) {
      eventTypeByKey.set(key(et.name), et);
      if (et.code) eventTypeByKey.set(key(et.code), et);
    }

    const hangarByKey = new Map<string, (typeof hangarsAll)[number]>();
    for (const h of hangarsAll) {
      if (!h.isActive) continue;
      hangarByKey.set(key(h.name), h);
      if (h.code) hangarByKey.set(key(h.code), h);
    }

    // Стенды: только активные места в активных вариантах расстановки (как в mass/reservations).
    // Неактивные подтягиваем отдельно — для понятной ошибки, если код есть только там.
    const hangarIds = Array.from(new Set(Array.from(hangarKeySet).map((k) => hangarByKey.get(k)?.id).filter(Boolean))) as string[];
    const standSelect = {
      id: true,
      code: true,
      layoutId: true,
      isActive: true,
      layout: { select: { hangarId: true, code: true, name: true, isActive: true } }
    } as const;
    const [standActiveAll, standInactiveAll] =
      hangarIds.length > 0
        ? await Promise.all([
            app.prisma.hangarStand.findMany({
              where: {
                isActive: true,
                layout: { hangarId: { in: hangarIds }, isActive: true }
              },
              select: standSelect,
              orderBy: [{ layout: { code: "asc" } }, { code: "asc" }]
            }),
            app.prisma.hangarStand.findMany({
              where: {
                OR: [
                  { isActive: false, layout: { hangarId: { in: hangarIds } } },
                  { layout: { hangarId: { in: hangarIds }, isActive: false } }
                ]
              },
              select: standSelect,
              orderBy: [{ layout: { code: "asc" } }, { code: "asc" }]
            })
          ])
        : [[], []];
    const standsByHangarAndCode = new Map<string, Array<(typeof standActiveAll)[number]>>();
    for (const s of standActiveAll) {
      const standKey = `${s.layout.hangarId}|${upper(s.code)}`;
      const arr = standsByHangarAndCode.get(standKey) ?? [];
      arr.push(s);
      standsByHangarAndCode.set(standKey, arr);
    }
    const inactiveStandsByHangarAndCode = new Map<string, Array<(typeof standInactiveAll)[number]>>();
    for (const s of standInactiveAll) {
      const standKey = `${s.layout.hangarId}|${upper(s.code)}`;
      const arr = inactiveStandsByHangarAndCode.get(standKey) ?? [];
      arr.push(s);
      inactiveStandsByHangarAndCode.set(standKey, arr);
    }

    // Диапазон дат файла + резервы по ангарам (нужны и для занятости мест, и для блокировок схем)
    let minStart = new Date("2100-01-01T00:00:00.000Z");
    let maxEnd = new Date("1970-01-01T00:00:00.000Z");
    for (const r of rows) {
      const sAt = parseDate(r.startAt);
      const eAt = parseDate(r.endAt);
      if (Number.isFinite(sAt.valueOf()) && sAt < minStart) minStart = sAt;
      if (Number.isFinite(eAt.valueOf()) && eAt > maxEnd) maxEnd = eAt;
    }

    const existingReservations =
      hangarIds.length > 0 && Number.isFinite(minStart.valueOf()) && Number.isFinite(maxEnd.valueOf()) && maxEnd > minStart
        ? await app.prisma.standReservation.findMany({
            where: {
              ...sandboxFilter(req),
              startAt: { lt: maxEnd },
              endAt: { gt: minStart },
              layout: { hangarId: { in: hangarIds } },
              event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
            },
            include: {
              event: { include: { aircraft: true } },
              layout: { select: { hangarId: true, name: true, code: true, isActive: true } }
            }
          })
        : [];

    const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

    const reservationsByStand = new Map<string, typeof existingReservations>();
    const layoutLocksByHangar = new Map<string, Array<{ layoutId: string; layoutName: string; start: Date; end: Date; label: string }>>();
    for (const r of existingReservations) {
      const arr = reservationsByStand.get(r.standId) ?? [];
      arr.push(r);
      reservationsByStand.set(r.standId, arr);
      const hangarId = r.layout.hangarId;
      const locks = layoutLocksByHangar.get(hangarId) ?? [];
      locks.push({
        layoutId: r.layoutId,
        layoutName: r.layout.name || r.layout.code || r.layoutId,
        start: r.startAt,
        end: r.endAt,
        label: `${r.event.title} (${eventAircraftLabel(r.event)})`
      });
      layoutLocksByHangar.set(hangarId, locks);
    }

    const existingStandConflict = (standId: string, startAt: Date, endAt: Date) => {
      const rs = reservationsByStand.get(standId) ?? [];
      return rs.find((x: any) => overlaps(startAt, endAt, x.startAt, x.endAt));
    };
    const existingLayoutConflict = (hangarId: string, layoutId: string, startAt: Date, endAt: Date) => {
      const locks = layoutLocksByHangar.get(hangarId) ?? [];
      return locks.find((lock) => lock.layoutId !== layoutId && overlaps(startAt, endAt, lock.start, lock.end));
    };

    type PlannedStand = { standId: string; hangarId: string; layoutId: string; startAt: Date; endAt: Date; label: string };
    const plannedReservations: PlannedStand[] = [];

    const plannedStandConflict = (standId: string, startAt: Date, endAt: Date) =>
      plannedReservations.find((x) => x.standId === standId && overlaps(startAt, endAt, x.startAt, x.endAt));
    const plannedLayoutConflict = (hangarId: string, layoutId: string, startAt: Date, endAt: Date) =>
      plannedReservations.find(
        (x) => x.hangarId === hangarId && x.layoutId !== layoutId && overlaps(startAt, endAt, x.startAt, x.endAt)
      );

    const resolveImportStand = (
      hangar: { id: string; name: string },
      standCode: string,
      startAt: Date,
      endAt: Date,
      warnings: string[]
    ): { standId: string; layoutId: string; layoutLabel: string } => {
      const standKey = `${hangar.id}|${standCode}`;
      const stands = standsByHangarAndCode.get(standKey) ?? [];
      if (stands.length === 0) {
        const inactive = inactiveStandsByHangarAndCode.get(standKey) ?? [];
        if (inactive.length > 0) {
          const variants = inactive
            .map((s) => `${s.layout.name}${s.layout.isActive === false ? " (неактивная схема)" : ""}${s.isActive === false ? " (неактивное место)" : ""}`)
            .join(", ");
          throw new Error(
            `Место ${standCode} в ангаре ${hangar.name} найдено только в неактивных вариантах расстановки: ${variants}`
          );
        }
        throw new Error(`Не найдено активное место ${standCode} в ангаре ${hangar.name}`);
      }

      // Конфликт схем с уже существующим планом — блокирует; внутри файла — только предупреждение.
      const layoutCompatible = stands.filter((s) => !existingLayoutConflict(hangar.id, s.layoutId, startAt, endAt));

      if (layoutCompatible.length === 0) {
        const foreign =
          (layoutLocksByHangar.get(hangar.id) ?? []).find((lock) => overlaps(startAt, endAt, lock.start, lock.end)) ??
          null;
        if (foreign) {
          throw new Error(
            `В этот период в ангаре «${hangar.name}» уже используется схема «${foreign.layoutName}» (${foreign.label}). Место ${standCode} из другой активной схемы недоступно.`
          );
        }
        throw new Error(
          `Не удалось подобрать активную схему для места ${standCode} в ангаре «${hangar.name}» без конфликта схем.`
        );
      }

      // Предпочитаем схему, уже занятую в этом периоде (план или файл), затем место без нахлёста.
      const sameLayoutPreferred = layoutCompatible.filter((s) => {
        const locks = layoutLocksByHangar.get(hangar.id) ?? [];
        if (locks.some((lock) => lock.layoutId === s.layoutId && overlaps(startAt, endAt, lock.start, lock.end))) {
          return true;
        }
        return plannedReservations.some(
          (x) => x.hangarId === hangar.id && x.layoutId === s.layoutId && overlaps(startAt, endAt, x.startAt, x.endAt)
        );
      });
      const pool = sameLayoutPreferred.length > 0 ? sameLayoutPreferred : layoutCompatible;

      const freeOfExisting = pool.filter((s) => !existingStandConflict(s.id, startAt, endAt));
      if (freeOfExisting.length === 0) {
        const busy = existingStandConflict(pool[0]!.id, startAt, endAt);
        throw new Error(
          `Конфликт резерва места ${standCode}: уже занято событием ${busy?.event.title ?? "в плане"} (${busy ? eventAircraftLabel(busy.event) : "—"})`
        );
      }

      const free =
        freeOfExisting.find((s) => !plannedStandConflict(s.id, startAt, endAt) && !plannedLayoutConflict(hangar.id, s.layoutId, startAt, endAt)) ??
        freeOfExisting.find((s) => !plannedStandConflict(s.id, startAt, endAt)) ??
        freeOfExisting[0]!;

      const selfStand = plannedStandConflict(free.id, startAt, endAt);
      if (selfStand) {
        warnings.push(
          `Нахлёст внутри файла по месту ${standCode}: пересекается с «${selfStand.label}». Событие будет импортировано с нахлёстом.`
        );
      }
      const selfLayout = plannedLayoutConflict(hangar.id, free.layoutId, startAt, endAt);
      if (selfLayout) {
        warnings.push(
          `Внутри файла пересечение схем в ангаре «${hangar.name}»: период пересекается со строкой «${selfLayout.label}» (другая схема). Событие будет импортировано.`
        );
      }

      const layoutLabel = free.layout.name || free.layout.code || free.layoutId;
      if (stands.length > 1) {
        warnings.push(
          `Место ${standCode} есть в ${stands.length} активных схемах ангара «${hangar.name}»; выбрана «${layoutLabel}».`
        );
      }
      return { standId: free.id, layoutId: free.layoutId, layoutLabel };
    };

    const previewRows: Array<{
      rowIndex: number;
      ok: boolean;
      title?: string;
      startAt?: string;
      endAt?: string;
      budgetStartAt?: string | null;
      budgetEndAt?: string | null;
      actualStartAt?: string | null;
      actualEndAt?: string | null;
      towStartAt?: string | null;
      towEndAt?: string | null;
      aircraftTail?: string;
      eventTypeKey?: string;
      hangar?: string | null;
      stand?: string | null;
      layout?: string | null;
      standId?: string | null;
      layoutId?: string | null;
      hangarId?: string | null;
      warnings?: string[];
      error?: string;
    }> = [];

    let wouldCreateEvents = 0;
    let wouldCreateReservations = 0;
    let wouldCreateTows = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const rowIndex = i + 2; // предположим 1-я строка — заголовок
      const warnings: string[] = [];
      try {
        const aircraftTail = upper(r.Aircraft);
        const eventKey = key(r.Event_name);
        const title = norm(r.Event_Title) || norm(r.Event_name) || "Событие";
        const hangarStr = norm(r.Hangar);
        const standCode = upper(r.HangarStand);

        const startAt = parseDate(r.startAt);
        const endAt = parseDate(r.endAt);
        if (!Number.isFinite(startAt.valueOf()) || !Number.isFinite(endAt.valueOf())) {
          throw new Error(`Некорректные даты startAt/endAt: ${String(r.startAt)} / ${String(r.endAt)}`);
        }
        if (endAt <= startAt) throw new Error("endAt должен быть позже startAt");
        const budgetStartAt = parseOptionalDate(r.budgetStartAt, "budgetStartAt");
        const budgetEndAt = parseOptionalDate(r.budgetEndAt, "budgetEndAt");
        validateOptionalPeriod(budgetStartAt, budgetEndAt, "Бюджетный");
        const actualStartAt = parseOptionalDate(r.actualStartAt, "actualStartAt");
        const actualEndAt = parseOptionalDate(r.actualEndAt, "actualEndAt");
        validateOptionalPeriod(actualStartAt, actualEndAt, "Фактический");
        const towStartAt = parseOptionalDate(r.towStartAt, "towStartAt");
        const towEndAt = parseOptionalDate(r.towEndAt, "towEndAt");
        validateOptionalPeriod(towStartAt, towEndAt, "Буксировка");
        if (towStartAt && towEndAt && (towStartAt < startAt || towEndAt > endAt)) {
          throw new Error("Период буксировки должен быть внутри startAt/endAt");
        }

        const aircraft = aircraftByTail.get(aircraftTail);
        if (!aircraft) throw new Error(`Не найден борт: ${aircraftTail}`);

        const eventType = eventTypeByKey.get(eventKey);
        if (!eventType) throw new Error(`Не найден тип события (Event_name): ${norm(r.Event_name)}`);

        // предупреждения по колонкам Operator/AircraftType (если есть)
        const opStr = norm((r as any).Operator);
        if (opStr && aircraft.operator?.name && key(opStr) !== key(aircraft.operator.name) && key(opStr) !== key(aircraft.operator.code ?? "")) {
          warnings.push(`Operator не совпадает с бортом: в файле "${opStr}", в справочнике "${aircraft.operator.name}"`);
        }
        const typeStr = norm((r as any).AircraftType);
        if (typeStr && aircraft.type?.name) {
          const t = key(typeStr);
          const tName = key(aircraft.type.name);
          const tIcao = key((aircraft.type as any).icaoType ?? "");
          if (t !== tName && t !== tIcao) warnings.push(`AircraftType не совпадает с бортом: в файле "${typeStr}", в справочнике "${aircraft.type.name}"`);
        }

        const hangar = hangarStr ? hangarByKey.get(key(hangarStr)) ?? null : null;
        if (hangarStr && !hangar) {
          const inactiveHangar = hangarsAll.find((h) => key(h.name) === key(hangarStr) || key(h.code ?? "") === key(hangarStr));
          if (inactiveHangar && !inactiveHangar.isActive) {
            throw new Error(`Ангар «${hangarStr}» неактивен`);
          }
          throw new Error(`Не найден ангар: ${hangarStr}`);
        }

        let resolvedStand: { standId: string; layoutId: string; layoutLabel: string } | null = null;
        if (standCode) {
          if (!hangar) throw new Error("Указано HangarStand, но не указан/не найден Hangar (нужен для поиска места)");
          resolvedStand = resolveImportStand(hangar, standCode, startAt, endAt, warnings);
        }

        previewRows.push({
          rowIndex,
          ok: true,
          title,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          budgetStartAt: budgetStartAt?.toISOString() ?? null,
          budgetEndAt: budgetEndAt?.toISOString() ?? null,
          actualStartAt: actualStartAt?.toISOString() ?? null,
          actualEndAt: actualEndAt?.toISOString() ?? null,
          towStartAt: towStartAt?.toISOString() ?? null,
          towEndAt: towEndAt?.toISOString() ?? null,
          aircraftTail,
          eventTypeKey: norm(r.Event_name),
          hangar: hangar?.name ?? null,
          hangarId: hangar?.id ?? null,
          stand: standCode || null,
          layout: resolvedStand?.layoutLabel ?? null,
          standId: resolvedStand?.standId ?? null,
          layoutId: resolvedStand?.layoutId ?? null,
          warnings
        });

        wouldCreateEvents += 1;
        if (towStartAt && towEndAt) wouldCreateTows += 1;
        if (resolvedStand && hangar) {
          wouldCreateReservations += 1;
          plannedReservations.push({
            standId: resolvedStand.standId,
            hangarId: hangar.id,
            layoutId: resolvedStand.layoutId,
            startAt,
            endAt,
            label: `${aircraftTail} • ${title}`
          });
        }
      } catch (err: any) {
        previewRows.push({
          rowIndex,
          ok: false,
          aircraftTail: upper((r as any).Aircraft),
          eventTypeKey: norm((r as any).Event_name),
          warnings,
          error: String(err?.message ?? err)
        });
      }
    }

    const summary = {
      dryRun,
      totalRows: rows.length,
      okRows: previewRows.filter((r) => r.ok).length,
      errorRows: previewRows.filter((r) => !r.ok).length,
      wouldCreateEvents,
      wouldCreateReservations,
      wouldCreateTows
    };

    if (dryRun) {
      return { ok: true as const, summary, rows: previewRows };
    }

    // Реальный импорт: создаём только ok-строки
    const result = {
      ok: true as const,
      createdEvents: 0,
      createdReservations: 0,
      createdTows: 0,
      errors: [] as Array<{ rowIndex: number; message: string }>
    };
    const importedEventIds = new Set<string>();

    for (let i = 0; i < previewRows.length; i++) {
      if (!previewRows[i]!.ok) continue;
      const r = rows[i]!;
      const rowIndex = previewRows[i]!.rowIndex;
      try {
        const aircraftTail = upper(r.Aircraft);
        const eventKey = key(r.Event_name);
        const title = norm(r.Event_Title) || norm(r.Event_name) || "Событие";
        const hangarStr = norm(r.Hangar);
        const standCode = upper(r.HangarStand);
        const startAt = parseDate(r.startAt);
        const endAt = parseDate(r.endAt);
        const budgetStartAt = parseOptionalDate(r.budgetStartAt, "budgetStartAt");
        const budgetEndAt = parseOptionalDate(r.budgetEndAt, "budgetEndAt");
        const actualStartAt = parseOptionalDate(r.actualStartAt, "actualStartAt");
        const actualEndAt = parseOptionalDate(r.actualEndAt, "actualEndAt");
        const towStartAt = parseOptionalDate(r.towStartAt, "towStartAt");
        const towEndAt = parseOptionalDate(r.towEndAt, "towEndAt");

        const aircraft = aircraftByTail.get(aircraftTail)!;
        const eventType = eventTypeByKey.get(eventKey)!;
        const hangar = hangarStr ? hangarByKey.get(key(hangarStr)) ?? null : null;

        const sbId = sandboxIdFor(req);
        let createdEventId = "";
        await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const created = await tx.maintenanceEvent.create({
            data: {
              level: PlanningLevel.OPERATIONAL,
              status: EventStatus.PLANNED,
              planningKind: planningKindFromBudget(budgetStartAt, budgetEndAt),
              title,
              aircraftId: aircraft.id,
              eventTypeId: eventType.id,
              startAt,
              endAt,
              budgetStartAt,
              budgetEndAt,
              actualStartAt,
              actualEndAt,
              hangarId: hangar?.id ?? null,
              sandboxId: sbId
            }
          });
          createdEventId = created.id;

          await tx.maintenanceEventAudit.create({
            data: {
              eventId: created.id,
              sandboxId: sbId,
              action: EventAuditAction.CREATE,
              actor: getActor(req),
              reason: "Импорт из Excel",
              changes: {
                imported: {
                  Operator: norm((r as any).Operator),
                  Aircraft: aircraftTail,
                  AircraftType: norm((r as any).AircraftType),
                  Event_Title: norm((r as any).Event_Title),
                  Event_name: norm((r as any).Event_name),
                  startAt: startAt.toISOString(),
                  endAt: endAt.toISOString(),
                  budgetStartAt: budgetStartAt?.toISOString() ?? null,
                  budgetEndAt: budgetEndAt?.toISOString() ?? null,
                  actualStartAt: actualStartAt?.toISOString() ?? null,
                  actualEndAt: actualEndAt?.toISOString() ?? null,
                  towStartAt: towStartAt?.toISOString() ?? null,
                  towEndAt: towEndAt?.toISOString() ?? null,
                  Hangar: hangarStr,
                  HangarStand: standCode
                }
              }
            }
          });

          if (!standCode) {
            await tx.eventPlacement.create({
              data: {
                eventId: created.id,
                sandboxId: sbId,
                startAt,
                endAt,
                budgetStartAt,
                budgetEndAt,
                actualStartAt,
                actualEndAt,
                hangarId: hangar?.id ?? null,
                layoutId: null,
                standId: null,
                sortOrder: 0
              }
            });
          }

          if (standCode) {
            const preview = previewRows[i]!;
            const standId = preview.standId;
            const layoutId = preview.layoutId;
            const hangarId = preview.hangarId ?? hangar?.id ?? null;
            if (!standId || !layoutId || !hangarId) {
              throw new Error("Не удалось определить активное место/схему из предпросмотра");
            }

            // Повторно проверим конфликт на случай параллельных изменений
            const conflicts = await tx.standReservation.findMany({
              where: {
                sandboxId: sbId,
                standId,
                startAt: { lt: endAt },
                endAt: { gt: startAt },
                event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
              },
              include: { event: { include: { aircraft: true } } }
            });
            const conflict = conflicts.find((r) => !importedEventIds.has(r.eventId));
            if (conflict) {
              throw new Error(
                `Конфликт резерва места ${standCode}: уже занято событием ${conflict.event.title} (${eventAircraftLabel(conflict.event)})`
              );
            }

            const layoutConflict = await tx.standReservation.findFirst({
              where: {
                sandboxId: sbId,
                eventId: { notIn: Array.from(importedEventIds) },
                layoutId: { not: layoutId },
                startAt: { lt: endAt },
                endAt: { gt: startAt },
                layout: { hangarId },
                event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
              },
              include: { layout: { select: { name: true } }, event: { include: { aircraft: true } } }
            });
            if (layoutConflict) {
              throw new Error(
                `В этот период в ангаре уже используется другая схема расстановки: ${layoutConflict.layout?.name ?? "другая схема"} (${layoutConflict.event.title}, ${eventAircraftLabel(layoutConflict.event)})`
              );
            }

            const placement = await tx.eventPlacement.create({
              data: {
                eventId: created.id,
                sandboxId: sbId,
                startAt,
                endAt,
                budgetStartAt,
                budgetEndAt,
                actualStartAt,
                actualEndAt,
                hangarId,
                layoutId,
                standId,
                sortOrder: 0
              }
            });

            await tx.standReservation.create({
              data: {
                eventId: created.id,
                placementId: placement.id,
                layoutId,
                standId,
                startAt,
                endAt,
                sandboxId: sbId
              }
            });

            await tx.maintenanceEvent.update({
              where: { id: created.id },
              data: { layoutId, hangarId }
            });

            result.createdReservations += 1;
          }
          if (towStartAt && towEndAt) {
            await tx.eventTow.create({
              data: { eventId: created.id, sandboxId: sbId, startAt: towStartAt, endAt: towEndAt }
            });
            result.createdTows += 1;
          }

          result.createdEvents += 1;
        });
        if (createdEventId) importedEventIds.add(createdEventId);
      } catch (err: any) {
        result.errors.push({ rowIndex, message: String(err?.message ?? err) });
      }
    }

    return result;
  });

  const zVirtualAircraft = z.object({
    operatorId: zUuid,
    aircraftTypeId: zUuid,
    label: z.string().trim().min(1).max(100)
  });

  app.post("/", async (req) => {
    assertCanWriteEvent(req);
    const body = z
      .object({
        level: z.nativeEnum(PlanningLevel),
        status: z.nativeEnum(EventStatus).optional(),
        planningKind: z.enum(PLANNING_KIND_VALUES).optional(),
        title: z.string().trim().min(1).max(300),
        aircraftId: zUuid.optional(),
        virtualAircraft: zVirtualAircraft.optional(),
        eventTypeId: zUuid,
        startAt: zDateTime,
        endAt: zDateTime,
        budgetStartAt: zDateTime.nullable().optional(),
        budgetEndAt: zDateTime.nullable().optional(),
        actualStartAt: zDateTime.nullable().optional(),
        actualEndAt: zDateTime.nullable().optional(),
        hangarId: zUuid.optional(),
        layoutId: zUuid.optional(),
        workshopId: zUuid.nullable().optional(),
        placements: z.array(zPlacementInput).optional(),
        notes: z.string().trim().min(1).max(5000).nullable().optional(),
        allowOverlap: z.boolean().optional().default(false),
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt" })
      .refine((v) => Boolean(v.budgetStartAt) === Boolean(v.budgetEndAt), { message: "budget period must have both dates" })
      .refine((v) => !v.budgetStartAt || !v.budgetEndAt || v.budgetEndAt > v.budgetStartAt, {
        message: "budgetEndAt must be after budgetStartAt"
      })
      .refine((v) => Boolean(v.actualStartAt) === Boolean(v.actualEndAt), { message: "actual period must have both dates" })
      .refine((v) => !v.actualStartAt || !v.actualEndAt || v.actualEndAt > v.actualStartAt, {
        message: "actualEndAt must be after actualStartAt"
      })
      .refine((v) => v.aircraftId != null || v.virtualAircraft != null, { message: "aircraftId or virtualAircraft required" })
      .parse(req.body);

    const { changeReason, placements, allowOverlap, ...data } = body;
    const sbId = sandboxIdFor(req);
    const planning = normalizeCreatePlanningPeriod({
      planningKind: data.planningKind,
      startAt: data.startAt,
      endAt: data.endAt,
      budgetStartAt: data.budgetStartAt,
      budgetEndAt: data.budgetEndAt
    });
    const statusReconciled = reconcileEventStatus({
      status: data.status ?? EventStatus.PLANNED,
      startAt: data.startAt,
      endAt: data.endAt,
      actualStartAt: data.actualStartAt ?? null,
      actualEndAt: data.actualEndAt ?? null,
      forceDone: data.status === EventStatus.DONE
    });
    const created = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const event = await tx.maintenanceEvent.create({
        data: {
          ...data,
          status: statusReconciled.status,
          actualStartAt: statusReconciled.actualStartAt,
          actualEndAt: statusReconciled.actualEndAt,
          planningKind: planning.planningKind,
          budgetStartAt: planning.budgetStartAt,
          budgetEndAt: planning.budgetEndAt,
          sandboxId: sbId,
          aircraftId: data.aircraftId ?? (data.virtualAircraft ? null : undefined),
          virtualAircraft: data.virtualAircraft ? (data.virtualAircraft as object) : undefined
        } as any
      });

      await replaceEventPlacements(tx, {
        eventId: event.id,
        sandboxId: sbId,
        eventStart: event.startAt,
        eventEnd: event.endAt,
        placements: placements?.length
          ? placements
          : [
              {
                startAt: event.startAt,
                endAt: event.endAt,
                budgetStartAt: planning.budgetStartAt,
                budgetEndAt: planning.budgetEndAt,
                actualStartAt: statusReconciled.actualStartAt,
                actualEndAt: statusReconciled.actualEndAt,
                hangarId: data.hangarId ?? null,
                layoutId: data.layoutId ?? null,
                standId: null,
                sortOrder: 0
              }
            ],
        allowOverlap
      });

      await tx.maintenanceEventAudit.create({
        data: {
          eventId: event.id,
          sandboxId: sbId,
          action: EventAuditAction.CREATE,
          actor: getActor(req),
          reason: changeReason ?? "Создание события",
          changes: {
            created: {
              title: event.title,
              level: event.level,
              status: event.status,
              planningKind: (event as any).planningKind,
              aircraftId: event.aircraftId,
              eventTypeId: event.eventTypeId,
              startAt: event.startAt.toISOString(),
              endAt: event.endAt.toISOString(),
              budgetStartAt: (event as any).budgetStartAt?.toISOString() ?? null,
              budgetEndAt: (event as any).budgetEndAt?.toISOString() ?? null,
              actualStartAt: (event as any).actualStartAt?.toISOString() ?? null,
              actualEndAt: (event as any).actualEndAt?.toISOString() ?? null,
              hangarId: event.hangarId ?? null,
              layoutId: event.layoutId ?? null,
              workshopId: (event as any).workshopId ?? null,
              placements: (placements ?? []).map((p) => ({
                startAt: p.startAt.toISOString(),
                endAt: p.endAt.toISOString(),
                budgetStartAt: p.budgetStartAt?.toISOString() ?? null,
                budgetEndAt: p.budgetEndAt?.toISOString() ?? null,
                actualStartAt: p.actualStartAt?.toISOString() ?? null,
                actualEndAt: p.actualEndAt?.toISOString() ?? null,
                hangarId: p.hangarId ?? null,
                layoutId: p.layoutId ?? null,
                standId: p.standId ?? null
              }))
            }
          }
        }
      });

      return await tx.maintenanceEvent.findUniqueOrThrow({ where: { id: event.id }, include: eventInclude });
    });

    return serializeEvent(created);
  });

  app.patch("/:id", async (req) => {
    assertCanWriteEvent(req);
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        level: z.nativeEnum(PlanningLevel).optional(),
        status: z.nativeEnum(EventStatus).optional(),
        planningKind: z.enum(PLANNING_KIND_VALUES).optional(),
        title: z.string().trim().min(1).max(300).optional(),
        aircraftId: zUuid.optional(),
        eventTypeId: zUuid.optional(),
        startAt: zDateTime.optional(),
        endAt: zDateTime.optional(),
        budgetStartAt: zDateTime.nullable().optional(),
        budgetEndAt: zDateTime.nullable().optional(),
        actualStartAt: zDateTime.nullable().optional(),
        actualEndAt: zDateTime.nullable().optional(),
        hangarId: zUuid.nullable().optional(),
        layoutId: zUuid.nullable().optional(),
        workshopId: zUuid.nullable().optional(),
        placements: z.array(zPlacementInput).optional(),
        notes: z.string().trim().min(1).max(5000).nullable().optional(),
        allowOverlap: z.boolean().optional().default(false),
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .parse(req.body);

    const existing = await app.prisma.maintenanceEvent.findFirst({
      where: { id, ...sandboxFilter(req) },
      include: {
        reservations: { include: { stand: true }, orderBy: [{ startAt: "asc" }] },
        placements: { include: placementInclude, orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }] },
        layout: true
      }
    });
    if (!existing) throw app.httpErrors.notFound("Event not found");

    let { changeReason, placements, allowOverlap, ...patch } = body;
    const scheduleLocked = isDoneScheduleLocked(existing.status, body.status);
    if (
      patchTouchesDoneScheduleLock(
        {
          status: existing.status,
          planningKind: existing.planningKind,
          eventTypeId: existing.eventTypeId,
          startAt: existing.startAt,
          endAt: existing.endAt,
          budgetStartAt: existing.budgetStartAt ?? null,
          budgetEndAt: existing.budgetEndAt ?? null,
          actualStartAt: (existing as any).actualStartAt ?? null,
          actualEndAt: (existing as any).actualEndAt ?? null,
          hangarId: existing.hangarId ?? null,
          layoutId: existing.layoutId ?? null
        },
        {
          planningKind: body.planningKind,
          eventTypeId: body.eventTypeId,
          startAt: body.startAt,
          endAt: body.endAt,
          budgetStartAt: body.budgetStartAt,
          budgetEndAt: body.budgetEndAt,
          actualStartAt: body.actualStartAt,
          actualEndAt: body.actualEndAt,
          hangarId: body.hangarId,
          layoutId: body.layoutId
        },
        body.status
      )
    ) {
      throw app.httpErrors.badRequest(DONE_SCHEDULE_LOCK_MESSAGE);
    }
    if (scheduleLocked) {
      // UI always resends the full form; keep schedule immutable while DONE.
      placements = undefined;
      const {
        planningKind: _planningKind,
        eventTypeId: _eventTypeId,
        startAt: _startAt,
        endAt: _endAt,
        budgetStartAt: _budgetStartAt,
        budgetEndAt: _budgetEndAt,
        actualStartAt: _actualStartAt,
        actualEndAt: _actualEndAt,
        hangarId: _hangarId,
        layoutId: _layoutId,
        ...safePatch
      } = patch;
      patch = safePatch;
    }

    const nextStatus = body.status ?? existing.status;
    const nextStart = scheduleLocked ? existing.startAt : (body.startAt ?? existing.startAt);
    const nextEnd = scheduleLocked ? existing.endAt : (body.endAt ?? existing.endAt);
    if (nextEnd <= nextStart) {
      throw app.httpErrors.badRequest("endAt must be after startAt");
    }
    const planning = scheduleLocked
      ? {
          planningKind: existing.planningKind,
          budgetStartAt: existing.budgetStartAt ?? null,
          budgetEndAt: existing.budgetEndAt ?? null
        }
      : normalizePatchPlanningPeriod({
          existing,
          planningKind: body.planningKind,
          startAt: nextStart,
          endAt: nextEnd,
          budgetStartAt: body.budgetStartAt,
          budgetEndAt: body.budgetEndAt
        });
    const nextBudgetStart = planning.budgetStartAt;
    const nextBudgetEnd = planning.budgetEndAt;
    if ((nextBudgetStart && !nextBudgetEnd) || (!nextBudgetStart && nextBudgetEnd)) {
      throw app.httpErrors.badRequest("budget period must have both dates");
    }
    if (nextBudgetStart && nextBudgetEnd && nextBudgetEnd <= nextBudgetStart) {
      throw app.httpErrors.badRequest("budgetEndAt must be after budgetStartAt");
    }
    let patchData = {
      ...patch,
      ...(scheduleLocked
        ? {}
        : {
            planningKind: planning.planningKind,
            budgetStartAt: planning.budgetStartAt,
            budgetEndAt: planning.budgetEndAt
          })
    } as Record<string, unknown>;

    const nextActualStart = scheduleLocked
      ? ((existing as any).actualStartAt ?? null)
      : body.actualStartAt === undefined
        ? (existing as any).actualStartAt
        : body.actualStartAt;
    const nextActualEnd = scheduleLocked
      ? ((existing as any).actualEndAt ?? null)
      : body.actualEndAt === undefined
        ? (existing as any).actualEndAt
        : body.actualEndAt;
    if ((nextActualStart && !nextActualEnd) || (!nextActualStart && nextActualEnd)) {
      throw app.httpErrors.badRequest("actual period must have both dates");
    }
    if (nextActualStart && nextActualEnd && nextActualEnd <= nextActualStart) {
      throw app.httpErrors.badRequest("actualEndAt must be after actualStartAt");
    }

    const statusReconciled = reconcileEventStatus({
      status: nextStatus,
      startAt: nextStart,
      endAt: nextEnd,
      actualStartAt: nextActualStart,
      actualEndAt: nextActualEnd,
      forceDone: body.status === EventStatus.DONE
    });

    // При закрытии события (DONE/CONFIRMED) с виртуальным бортом — создаём Aircraft и привязываем
    const virtualAircraft = existing.virtualAircraft as { operatorId: string; aircraftTypeId: string; label: string } | null;
    if (
      virtualAircraft &&
      (statusReconciled.status === EventStatus.DONE || statusReconciled.status === EventStatus.CONFIRMED) &&
      !existing.aircraftId
    ) {
      const aircraft = await app.prisma.aircraft.create({
        data: {
          tailNumber: virtualAircraft.label,
          operatorId: virtualAircraft.operatorId,
          typeId: virtualAircraft.aircraftTypeId
        }
      });
      patchData = { ...patchData, aircraftId: aircraft.id, virtualAircraft: Prisma.JsonNull };
    }

    patchData = {
      ...patchData,
      status: statusReconciled.status,
      actualStartAt: statusReconciled.actualStartAt,
      actualEndAt: statusReconciled.actualEndAt
    };

    const placementChanged = placements !== undefined;
    const singlePlacementSyncNeeded =
      !placementChanged &&
      (body.startAt !== undefined ||
        body.endAt !== undefined ||
        body.hangarId !== undefined ||
        body.layoutId !== undefined) &&
      ((existing.placements ?? []).length <= 1);

    const updated = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const event = await tx.maintenanceEvent.update({
        where: { id },
        data: patchData
      });

      if (placementChanged) {
        await replaceEventPlacements(tx, {
          eventId: id,
          sandboxId: sandboxIdFor(req),
          eventStart: nextStart,
          eventEnd: nextEnd,
          placements: placements ?? [],
          allowOverlap
        });
      } else if (singlePlacementSyncNeeded) {
        await replaceEventPlacements(tx, {
          eventId: id,
          sandboxId: sandboxIdFor(req),
          eventStart: nextStart,
          eventEnd: nextEnd,
          placements: [
            {
              ...defaultPlacementFromEvent(existing),
              startAt: nextStart,
              endAt: nextEnd,
              budgetStartAt: nextBudgetStart ?? null,
              budgetEndAt: nextBudgetEnd ?? null,
              actualStartAt: statusReconciled.actualStartAt,
              actualEndAt: statusReconciled.actualEndAt,
              hangarId: body.hangarId === undefined ? defaultPlacementFromEvent(existing).hangarId : body.hangarId,
              layoutId: body.layoutId === undefined ? defaultPlacementFromEvent(existing).layoutId : body.layoutId,
              standId: body.layoutId === null ? null : defaultPlacementFromEvent(existing).standId,
              sortOrder: 0
            }
          ],
          allowOverlap
        });
      }

      return event;
    });

    const changes = diffEvent(existing, updated);
    if (placementChanged) {
      (changes as any).placements = {
        from: (existing.placements ?? []).map((p: any) => ({
          startAt: p.startAt.toISOString(),
          endAt: p.endAt.toISOString(),
          budgetStartAt: p.budgetStartAt?.toISOString() ?? null,
          budgetEndAt: p.budgetEndAt?.toISOString() ?? null,
          actualStartAt: p.actualStartAt?.toISOString() ?? null,
          actualEndAt: p.actualEndAt?.toISOString() ?? null,
          hangarId: p.hangarId ?? null,
          layoutId: p.layoutId ?? null,
          standId: p.standId ?? null
        })),
        to: (placements ?? []).map((p) => ({
          startAt: p.startAt.toISOString(),
          endAt: p.endAt.toISOString(),
          budgetStartAt: p.budgetStartAt?.toISOString() ?? null,
          budgetEndAt: p.budgetEndAt?.toISOString() ?? null,
          actualStartAt: p.actualStartAt?.toISOString() ?? null,
          actualEndAt: p.actualEndAt?.toISOString() ?? null,
          hangarId: p.hangarId ?? null,
          layoutId: p.layoutId ?? null,
          standId: p.standId ?? null
        }))
      };
    }
    const changedKeys = Object.keys(changes);
    if (changedKeys.length > 0 && !changeReason) {
      throw app.httpErrors.badRequest("changeReason is required when updating an event");
    }

    if (changedKeys.length > 0) {
      await app.prisma.maintenanceEventAudit.create({
        data: {
          eventId: id,
          sandboxId: sandboxIdFor(req),
          action: EventAuditAction.UPDATE,
          actor: getActor(req),
          reason: changeReason ?? null,
          changes
        }
      });
    }

    const reloaded = await app.prisma.maintenanceEvent.findUniqueOrThrow({ where: { id }, include: eventInclude });
    return serializeEvent(reloaded);
  });

  app.get("/:id/history", async (req) => {
    const id = zUuid.parse((req.params as any).id);
    return await app.prisma.maintenanceEventAudit.findMany({
      where: { eventId: id, ...sandboxFilter(req) },
      orderBy: { createdAt: "desc" }
    });
  });

  app.delete("/:id", async (req) => {
    assertCanWriteEvent(req);
    const id = zUuid.parse((req.params as any).id);
    const existing = await app.prisma.maintenanceEvent.findFirst({
      where: { id, ...sandboxFilter(req) },
      select: { id: true }
    });
    if (!existing) throw app.httpErrors.notFound("Event not found");
    await app.prisma.maintenanceEvent.delete({ where: { id } });
    return { ok: true };
  });
};

