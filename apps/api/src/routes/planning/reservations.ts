import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, EventStatus, Prisma } from "@prisma/client";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";
import { canWriteInContext, sandboxFilter, sandboxIdFor } from "../../plugins/sandbox.js";

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

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  const h = req.headers ?? {};
  return String(h["x-actor"] ?? h["x-user"] ?? "browser").slice(0, 80);
}

function eventAircraftTypeId(event: any): string | null {
  return event.aircraft?.typeId ?? event.virtualAircraft?.aircraftTypeId ?? null;
}

function allowedAircraftTypeIds(stand: any): string[] {
  return (stand.allowedAircraftTypes ?? []).map((link: any) => String(link.aircraftTypeId));
}

function standAccepts(stand: any, aircraftTypeId: string | null): boolean {
  const allowed = allowedAircraftTypeIds(stand);
  return allowed.length === 0 || !aircraftTypeId || allowed.includes(aircraftTypeId);
}

export const reservationsRoutes: FastifyPluginAsync = async (app) => {
  const replaceSingleReservation = async (
    tx: any,
    params: {
      eventId: string;
      sandboxId: string | null;
      hangarId: string;
      layoutId: string;
      standId: string;
      startAt: Date;
      endAt: Date;
      budgetStartAt?: Date | null;
      budgetEndAt?: Date | null;
      actualStartAt?: Date | null;
      actualEndAt?: Date | null;
    }
  ) => {
    await tx.standReservation.deleteMany({ where: { eventId: params.eventId } });
    await tx.eventPlacement.deleteMany({ where: { eventId: params.eventId } });
    const placement = await tx.eventPlacement.create({
      data: {
        eventId: params.eventId,
        sandboxId: params.sandboxId,
        startAt: params.startAt,
        endAt: params.endAt,
        budgetStartAt: params.budgetStartAt ?? null,
        budgetEndAt: params.budgetEndAt ?? null,
        actualStartAt: params.actualStartAt ?? null,
        actualEndAt: params.actualEndAt ?? null,
        hangarId: params.hangarId,
        layoutId: params.layoutId,
        standId: params.standId,
        sortOrder: 0
      }
    });
    return await tx.standReservation.create({
      data: {
        eventId: params.eventId,
        placementId: placement.id,
        sandboxId: params.sandboxId,
        layoutId: params.layoutId,
        standId: params.standId,
        startAt: params.startAt,
        endAt: params.endAt
      }
    });
  };

  const findLayoutConflict = async (
    client: any,
    params: { sandboxId: string | null; eventId: string; hangarId: string; layoutId: string; startAt: Date; endAt: Date }
  ) => {
    return await client.standReservation.findFirst({
      where: {
        sandboxId: params.sandboxId,
        eventId: { not: params.eventId },
        layoutId: { not: params.layoutId },
        startAt: { lt: params.endAt },
        endAt: { gt: params.startAt },
        layout: { hangarId: params.hangarId },
        event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
      },
      include: {
        layout: { select: { name: true } },
        event: { include: { aircraft: true } }
      },
      orderBy: [{ startAt: "asc" }]
    });
  };

  const layoutConflictMessage = (conflict: any) =>
    `В этот период в ангаре уже используется другая схема расстановки: ${conflict.layout?.name ?? "другая схема"} (${conflict.event.title}, ${
      conflict.event.aircraft?.tailNumber ?? (conflict.event as any).virtualAircraft?.label ?? "—"
    })`;

  // Резервы по варианту расстановки в диапазоне дат (для подсветки занятости)
  app.get("/", async (req) => {
    assertPermission(req, "events:read");
    const query = z
      .object({
        layoutId: zUuid,
        from: zDateTime.optional(),
        to: zDateTime.optional()
      })
      .parse(req.query ?? {});

    const from = query.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = query.to ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    return await app.prisma.standReservation.findMany({
      where: {
        ...sandboxFilter(req),
        layoutId: query.layoutId,
        startAt: { lt: to },
        endAt: { gt: from },
        event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
      },
      include: {
        stand: true,
        event: { include: { aircraft: true, eventType: true } }
      },
      orderBy: [{ startAt: "asc" }]
    });
  });

  // Создать/заменить резерв под событие (самое частое действие в UI)
  app.put("/by-event/:eventId", async (req) => {
    assertCanWriteEvent(req);
    const eventId = zUuid.parse((req.params as any).eventId);
    const body = z
      .object({
        layoutId: zUuid,
        standId: zUuid,
        startAt: zDateTime.optional(),
        endAt: zDateTime.optional(),
        allowOverlap: z.boolean().optional().default(false),
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .parse(req.body);

    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req) }
    });
    if (!event) throw app.httpErrors.notFound("Event not found");

    const existingReservation = await app.prisma.standReservation.findFirst({
      where: { eventId, ...sandboxFilter(req) },
      orderBy: [{ startAt: "asc" }]
    });

    const startAt = body.startAt ?? event.startAt;
    const endAt = body.endAt ?? event.endAt;
    if (endAt <= startAt) {
      throw app.httpErrors.badRequest("endAt must be after startAt");
    }

    if (!body.allowOverlap) {
      // Проверка конфликтов: любое пересечение по времени на том же месте
      const conflict = await app.prisma.standReservation.findFirst({
        where: {
          ...sandboxFilter(req),
          standId: body.standId,
          eventId: { not: eventId },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
          event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
        },
        include: { event: { include: { aircraft: true, eventType: true } } }
      });

      if (conflict) {
        throw app.httpErrors.conflict(
          `Место уже занято: ${conflict.event.title} (${conflict.event.aircraft?.tailNumber ?? (conflict.event as any).virtualAircraft?.label ?? "—"})`
        );
      }
    }

    const layout = await app.prisma.hangarLayout.findUniqueOrThrow({
      where: { id: body.layoutId },
      select: { id: true, hangarId: true, name: true }
    });
    const stand = await app.prisma.hangarStand.findFirst({
      where: { id: body.standId, layoutId: body.layoutId },
      select: { id: true }
    });
    if (!stand) throw app.httpErrors.badRequest("Stand does not belong to selected layout");

    if (!body.allowOverlap) {
      const layoutConflict = await findLayoutConflict(app.prisma, {
        sandboxId: sandboxIdFor(req),
        eventId,
        hangarId: layout.hangarId,
        layoutId: layout.id,
        startAt,
        endAt
      });
      if (layoutConflict) {
        throw app.httpErrors.conflict(layoutConflictMessage(layoutConflict));
      }
    }

    const sbId = sandboxIdFor(req);
    const reservation = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) =>
      replaceSingleReservation(tx, {
        eventId,
        sandboxId: sbId,
        hangarId: layout.hangarId,
        layoutId: body.layoutId,
        standId: body.standId,
        startAt,
        endAt,
        budgetStartAt: (event as any).budgetStartAt ?? null,
        budgetEndAt: (event as any).budgetEndAt ?? null,
        actualStartAt: (event as any).actualStartAt ?? null,
        actualEndAt: (event as any).actualEndAt ?? null
      })
    );

    // Подтянем layout/hangar в событие (для удобства фильтрации в Гантте)
    await app.prisma.maintenanceEvent.update({
      where: { id: eventId },
      data: { layoutId: layout.id, hangarId: layout.hangarId }
    });

    const changed =
      !existingReservation ||
      existingReservation.layoutId !== reservation.layoutId ||
      existingReservation.standId !== reservation.standId ||
      existingReservation.startAt.toISOString() !== reservation.startAt.toISOString() ||
      existingReservation.endAt.toISOString() !== reservation.endAt.toISOString();

    if (changed && !body.changeReason) {
      throw app.httpErrors.badRequest("changeReason is required when changing reservation");
    }

    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId,
        sandboxId: sbId,
        action: EventAuditAction.RESERVE,
        actor: getActor(req),
        reason: body.changeReason ?? (existingReservation ? null : "Первичное назначение места"),
        changes: {
          reservation: {
            from: existingReservation
              ? {
                  layoutId: existingReservation.layoutId,
                  standId: existingReservation.standId,
                  startAt: existingReservation.startAt.toISOString(),
                  endAt: existingReservation.endAt.toISOString()
                }
              : null,
            to: {
              layoutId: reservation.layoutId,
              standId: reservation.standId,
              startAt: reservation.startAt.toISOString(),
              endAt: reservation.endAt.toISOString()
            }
          }
        }
      }
    });

    return reservation;
  });

  // Drag&Drop перенос между стоянками с опциональным "выталкиванием" конфликтующих событий.
  // Доступно только ролям ADMIN/PLANNER + permission events:write.
  app.post("/dnd-move", async (req) => {
    assertCanWriteEvent(req);
    const roles = ((req as any).auth?.roles ?? []) as string[];
    if (!req.sandbox && !roles.includes("ADMIN") && !roles.includes("PLANNER")) {
      const err: any = new Error("FORBIDDEN");
      err.statusCode = 403;
      throw err;
    }

    const body = z
      .object({
        eventId: zUuid,
        layoutId: zUuid,
        standId: zUuid,
        bumpOnConflict: z.boolean().optional(),
        bumpedEventId: zUuid.optional(),
        changeReason: z.string().trim().min(1).max(1000)
      })
      .parse(req.body);

    const bump = Boolean(body.bumpOnConflict);
    const sbId = sandboxIdFor(req);

    const moved = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const event = await tx.maintenanceEvent.findFirst({
        where: { id: body.eventId, sandboxId: sbId },
        include: { reservations: { orderBy: [{ startAt: "asc" }] }, aircraft: true }
      });
      if (!event) throw app.httpErrors.notFound("Event not found");

      const layout = await tx.hangarLayout.findUniqueOrThrow({
        where: { id: body.layoutId },
        select: { id: true, hangarId: true, name: true }
      });
      const stand = await tx.hangarStand.findFirst({
        where: { id: body.standId, layoutId: body.layoutId },
        select: { id: true }
      });
      if (!stand) throw app.httpErrors.badRequest("Stand does not belong to selected layout");

      const startAt = event.startAt;
      const endAt = event.endAt;

      const layoutConflict = await findLayoutConflict(tx, {
        sandboxId: sbId,
        eventId: body.eventId,
        hangarId: layout.hangarId,
        layoutId: layout.id,
        startAt,
        endAt
      });
      if (layoutConflict) {
        throw app.httpErrors.conflict(layoutConflictMessage(layoutConflict));
      }

      const conflicts = body.bumpedEventId
        ? await tx.standReservation.findMany({
            where: {
              sandboxId: sbId,
              standId: body.standId,
              eventId: body.bumpedEventId,
              startAt: { lt: endAt },
              endAt: { gt: startAt },
              event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
            },
            include: { event: { include: { aircraft: true } } }
          })
        : await tx.standReservation.findMany({
            where: {
              sandboxId: sbId,
              standId: body.standId,
              eventId: { not: body.eventId },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
              event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
            },
            include: { event: { include: { aircraft: true } } },
            orderBy: [{ startAt: "asc" }]
          });

      if (conflicts.length > 0 && !bump) {
        throw app.httpErrors.conflict(
          `Место уже занято: ${conflicts[0]!.event.title} (${conflicts[0]!.event.aircraft?.tailNumber ?? (conflicts[0]!.event as any).virtualAircraft?.label ?? "—"})`
        );
      }

      const bumpedEventIds: string[] = [];

      if (conflicts.length > 0 && bump) {
        // bump всех конфликтующих событий (пересекаются по времени с целевым placement)
        const toBump = conflicts.map((c) => c.eventId);
        bumpedEventIds.push(...toBump);

        // 1) снять резервы у всех конфликтующих
        await tx.standReservation.deleteMany({ where: { eventId: { in: toBump } } });
        await tx.eventPlacement.deleteMany({ where: { eventId: { in: toBump } } });
        // 2) убрать ангар/вариант и перевести в DRAFT (без ангара/места)
        await tx.maintenanceEvent.updateMany({
          where: { id: { in: toBump } },
          data: { hangarId: null, layoutId: null, status: EventStatus.DRAFT }
        });
        // 3) аудит по каждому "вытолкнутому"
        for (const bumpedEventId of toBump) {
          await tx.maintenanceEventAudit.create({
            data: {
              eventId: bumpedEventId,
              sandboxId: sbId,
              action: EventAuditAction.UPDATE,
              actor: getActor(req),
              reason: body.changeReason,
              changes: {
                dnd: {
                  bumpedByEventId: body.eventId,
                  reservationTo: null,
                  statusTo: EventStatus.DRAFT,
                  hangarIdTo: null,
                  layoutIdTo: null
                }
              }
            }
          });
        }
      }

      const existingReservation = event.reservations[0]
        ? {
            layoutId: event.reservations[0].layoutId,
            standId: event.reservations[0].standId,
            startAt: event.reservations[0].startAt,
            endAt: event.reservations[0].endAt
          }
        : null;

      const reservation = await replaceSingleReservation(tx, {
        eventId: body.eventId,
        sandboxId: sbId,
        hangarId: layout.hangarId,
        layoutId: body.layoutId,
        standId: body.standId,
        startAt,
        endAt,
        budgetStartAt: (event as any).budgetStartAt ?? null,
        budgetEndAt: (event as any).budgetEndAt ?? null,
        actualStartAt: (event as any).actualStartAt ?? null,
        actualEndAt: (event as any).actualEndAt ?? null
      });

      await tx.maintenanceEvent.update({
        where: { id: body.eventId },
        data: { layoutId: layout.id, hangarId: layout.hangarId }
      });

      await tx.maintenanceEventAudit.create({
        data: {
          eventId: body.eventId,
          sandboxId: sbId,
          action: EventAuditAction.RESERVE,
          actor: getActor(req),
          reason: body.changeReason,
          changes: {
            dnd: { bumpOnConflict: bump, bumpedEventIds },
            reservation: {
              from: existingReservation
                ? {
                    layoutId: existingReservation.layoutId,
                    standId: existingReservation.standId,
                    startAt: existingReservation.startAt.toISOString(),
                    endAt: existingReservation.endAt.toISOString()
                  }
                : null,
              to: {
                layoutId: reservation.layoutId,
                standId: reservation.standId,
                startAt: reservation.startAt.toISOString(),
                endAt: reservation.endAt.toISOString()
              }
            }
          }
        }
      });

      return { ok: true, reservation, bumpedEventIds };
    });

    return moved;
  });

  // Drag&Drop размещение на стоянке с изменением времени (перемещение по оси времени / resize).
  // Доступно только ролям ADMIN/PLANNER + permission events:write.
  app.post("/dnd-place", async (req) => {
    assertCanWriteEvent(req);
    const roles = ((req as any).auth?.roles ?? []) as string[];
    if (!req.sandbox && !roles.includes("ADMIN") && !roles.includes("PLANNER")) {
      const err: any = new Error("FORBIDDEN");
      err.statusCode = 403;
      throw err;
    }

    const body = z
      .object({
        eventId: zUuid,
        layoutId: zUuid,
        standId: zUuid,
        startAt: zDateTime,
        endAt: zDateTime,
        bumpOnConflict: z.boolean().optional(),
        bumpedEventId: zUuid.optional(),
        changeReason: z.string().trim().min(1).max(1000)
      })
      .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt" })
      .parse(req.body);

    const bump = Boolean(body.bumpOnConflict);
    const sbId = sandboxIdFor(req);

    const moved = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const event = await tx.maintenanceEvent.findFirst({
        where: { id: body.eventId, sandboxId: sbId },
        include: { reservations: { orderBy: [{ startAt: "asc" }] }, aircraft: true }
      });
      if (!event) throw app.httpErrors.notFound("Event not found");

      const layout = await tx.hangarLayout.findUniqueOrThrow({
        where: { id: body.layoutId },
        select: { id: true, hangarId: true, name: true }
      });
      const stand = await tx.hangarStand.findFirst({
        where: { id: body.standId, layoutId: body.layoutId },
        select: { id: true }
      });
      if (!stand) throw app.httpErrors.badRequest("Stand does not belong to selected layout");

      const layoutConflict = await findLayoutConflict(tx, {
        sandboxId: sbId,
        eventId: body.eventId,
        hangarId: layout.hangarId,
        layoutId: layout.id,
        startAt: body.startAt,
        endAt: body.endAt
      });
      if (layoutConflict) {
        throw app.httpErrors.conflict(layoutConflictMessage(layoutConflict));
      }

      // конфликты на целевой стоянке для нового времени
      const conflicts = body.bumpedEventId
        ? await tx.standReservation.findMany({
            where: {
              sandboxId: sbId,
              standId: body.standId,
              eventId: body.bumpedEventId,
              startAt: { lt: body.endAt },
              endAt: { gt: body.startAt },
              event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
            },
            include: { event: { include: { aircraft: true } } }
          })
        : await tx.standReservation.findMany({
            where: {
              sandboxId: sbId,
              standId: body.standId,
              eventId: { not: body.eventId },
              startAt: { lt: body.endAt },
              endAt: { gt: body.startAt },
              event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
            },
            include: { event: { include: { aircraft: true } } },
            orderBy: [{ startAt: "asc" }]
          });

      if (conflicts.length > 0 && !bump) {
        throw app.httpErrors.conflict(
          `Место уже занято: ${conflicts[0]!.event.title} (${conflicts[0]!.event.aircraft?.tailNumber ?? (conflicts[0]!.event as any).virtualAircraft?.label ?? "—"})`
        );
      }

      const bumpedEventIds: string[] = [];
      if (conflicts.length > 0 && bump) {
        // bump всех конфликтующих событий (пересекаются по времени с целевым placement)
        const toBump = conflicts.map((c) => c.eventId);
        bumpedEventIds.push(...toBump);

        await tx.standReservation.deleteMany({ where: { eventId: { in: toBump } } });
        await tx.eventPlacement.deleteMany({ where: { eventId: { in: toBump } } });
        await tx.maintenanceEvent.updateMany({
          where: { id: { in: toBump } },
          data: { hangarId: null, layoutId: null, status: EventStatus.DRAFT }
        });
        for (const bumpedEventId of toBump) {
          await tx.maintenanceEventAudit.create({
            data: {
              eventId: bumpedEventId,
              sandboxId: sbId,
              action: EventAuditAction.UPDATE,
              actor: getActor(req),
              reason: body.changeReason,
              changes: {
                dnd: {
                  bumpedByEventId: body.eventId,
                  reservationTo: null,
                  statusTo: EventStatus.DRAFT,
                  hangarIdTo: null,
                  layoutIdTo: null
                }
              }
            }
          });
        }
      }

      const prev = {
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        hangarId: event.hangarId ?? null,
        layoutId: event.layoutId ?? null,
        reservation: event.reservations[0]
          ? {
              layoutId: event.reservations[0].layoutId,
              standId: event.reservations[0].standId,
              startAt: event.reservations[0].startAt.toISOString(),
              endAt: event.reservations[0].endAt.toISOString()
            }
          : null
      };

      // обновляем само событие (время + hangar/layout под цель)
      await tx.maintenanceEvent.update({
        where: { id: body.eventId },
        data: { startAt: body.startAt, endAt: body.endAt, layoutId: layout.id, hangarId: layout.hangarId }
      });

      const reservation = await replaceSingleReservation(tx, {
        eventId: body.eventId,
        sandboxId: sbId,
        hangarId: layout.hangarId,
        layoutId: body.layoutId,
        standId: body.standId,
        startAt: body.startAt,
        endAt: body.endAt,
        budgetStartAt: (event as any).budgetStartAt ?? null,
        budgetEndAt: (event as any).budgetEndAt ?? null,
        actualStartAt: (event as any).actualStartAt ?? null,
        actualEndAt: (event as any).actualEndAt ?? null
      });

      await tx.maintenanceEventAudit.create({
        data: {
          eventId: body.eventId,
          sandboxId: sbId,
          action: EventAuditAction.UPDATE,
          actor: getActor(req),
          reason: body.changeReason,
          changes: {
            dnd: { bumpOnConflict: bump, bumpedEventIds },
            from: prev,
            to: {
              startAt: body.startAt.toISOString(),
              endAt: body.endAt.toISOString(),
              hangarId: layout.hangarId,
              layoutId: layout.id,
              reservation: {
                layoutId: reservation.layoutId,
                standId: reservation.standId,
                startAt: reservation.startAt.toISOString(),
                endAt: reservation.endAt.toISOString()
              }
            }
          }
        }
      });

      return { ok: true, reservation, bumpedEventIds };
    });

    return moved;
  });

  // Drag&Drop на строку ангара: система сама выбирает активную/подходящую схему и место.
  app.post("/dnd-place-hangar", async (req) => {
    assertCanWriteEvent(req);
    const roles = ((req as any).auth?.roles ?? []) as string[];
    if (!req.sandbox && !roles.includes("ADMIN") && !roles.includes("PLANNER")) {
      const err: any = new Error("FORBIDDEN");
      err.statusCode = 403;
      throw err;
    }

    const body = z
      .object({
        eventId: zUuid,
        hangarId: zUuid,
        startAt: zDateTime,
        endAt: zDateTime,
        changeReason: z.string().trim().min(1).max(1000)
      })
      .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt" })
      .parse(req.body);

    const sbId = sandboxIdFor(req);

    const moved = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const event = await tx.maintenanceEvent.findFirst({
        where: { id: body.eventId, sandboxId: sbId },
        include: { reservations: { orderBy: [{ startAt: "asc" }] }, aircraft: true }
      });
      if (!event) throw app.httpErrors.notFound("Event not found");

      const [layouts, overlapping] = await Promise.all([
        tx.hangarLayout.findMany({
          where: { hangarId: body.hangarId, isActive: true },
          include: {
            hangar: true,
            stands: {
              where: { isActive: true },
              include: { allowedAircraftTypes: { select: { aircraftTypeId: true } } },
              orderBy: [{ code: "asc" }]
            }
          },
          orderBy: [{ code: "asc" }, { name: "asc" }]
        }),
        tx.standReservation.findMany({
          where: {
            sandboxId: sbId,
            eventId: { not: body.eventId },
            layout: { hangarId: body.hangarId },
            startAt: { lt: body.endAt },
            endAt: { gt: body.startAt },
            event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
          },
          include: { layout: { select: { id: true, name: true } }, event: { include: { aircraft: true } } },
          orderBy: [{ startAt: "asc" }]
        })
      ]);

      if (layouts.length === 0) throw app.httpErrors.conflict("В ангаре нет активных схем расстановки");

      const activeLayoutIds = Array.from(new Set(overlapping.map((r: any) => r.layoutId)));
      const allowedLayoutIds = new Set(activeLayoutIds.length > 0 ? activeLayoutIds : layouts.map((layout: any) => layout.id));
      const aircraftTypeId = eventAircraftTypeId(event);
      const currentReservation = event.reservations[0] ?? null;
      const currentStand = currentReservation
        ? layouts.flatMap((layout: any) => layout.stands ?? []).find((stand: any) => stand.id === currentReservation.standId)
        : null;
      const currentStandCode = currentStand?.code ?? null;

      const candidates = layouts
        .filter((layout: any) => allowedLayoutIds.has(layout.id))
        .flatMap((layout: any) =>
          (layout.stands ?? []).flatMap((stand: any) => {
            if (!standAccepts(stand, aircraftTypeId)) return [];
            const standBusy = overlapping.some((reservation: any) => reservation.standId === stand.id);
            if (standBusy) return [];
            const sameStandCode = Boolean(currentStandCode && stand.code === currentStandCode);
            const activeLayout = activeLayoutIds.includes(layout.id);
            const score = (activeLayout ? 1000 : 0) + (sameStandCode ? 100 : 0) + (allowedAircraftTypeIds(stand).length > 0 ? 10 : 0);
            return [{ layout, stand, score }];
          })
        )
        .sort((a: any, b: any) => b.score - a.score || a.layout.name.localeCompare(b.layout.name, "ru") || a.stand.code.localeCompare(b.stand.code, "ru"));

      const candidate = candidates[0];
      if (!candidate) {
        const activeNames = activeLayoutIds.length
          ? overlapping.map((reservation: any) => reservation.layout?.name).filter(Boolean).join(", ")
          : "";
        throw app.httpErrors.conflict(
          activeNames
            ? `Нет свободного подходящего места в активной схеме периода: ${activeNames}`
            : "Нет свободного подходящего места в активных схемах ангара"
        );
      }

      const prev = {
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        hangarId: event.hangarId ?? null,
        layoutId: event.layoutId ?? null,
        reservation: event.reservations[0]
          ? {
              layoutId: event.reservations[0].layoutId,
              standId: event.reservations[0].standId,
              startAt: event.reservations[0].startAt.toISOString(),
              endAt: event.reservations[0].endAt.toISOString()
            }
          : null
      };

      await tx.maintenanceEvent.update({
        where: { id: body.eventId },
        data: { startAt: body.startAt, endAt: body.endAt, layoutId: candidate.layout.id, hangarId: body.hangarId }
      });

      const reservation = await replaceSingleReservation(tx, {
        eventId: body.eventId,
        sandboxId: sbId,
        hangarId: body.hangarId,
        layoutId: candidate.layout.id,
        standId: candidate.stand.id,
        startAt: body.startAt,
        endAt: body.endAt,
        budgetStartAt: (event as any).budgetStartAt ?? null,
        budgetEndAt: (event as any).budgetEndAt ?? null,
        actualStartAt: (event as any).actualStartAt ?? null,
        actualEndAt: (event as any).actualEndAt ?? null
      });

      await tx.maintenanceEventAudit.create({
        data: {
          eventId: body.eventId,
          sandboxId: sbId,
          action: EventAuditAction.UPDATE,
          actor: getActor(req),
          reason: body.changeReason,
          changes: {
            dnd: { mode: "hangar-auto-placement" },
            from: prev,
            to: {
              startAt: body.startAt.toISOString(),
              endAt: body.endAt.toISOString(),
              hangarId: body.hangarId,
              layoutId: candidate.layout.id,
              standId: candidate.stand.id,
              reservation: {
                layoutId: reservation.layoutId,
                standId: reservation.standId,
                startAt: reservation.startAt.toISOString(),
                endAt: reservation.endAt.toISOString()
              }
            }
          }
        }
      });

      return {
        ok: true,
        reservation,
        bumpedEventIds: [],
        placement: {
          hangarId: body.hangarId,
          layoutId: candidate.layout.id,
          layoutName: candidate.layout.name,
          standId: candidate.stand.id,
          standCode: candidate.stand.code
        }
      };
    });

    return moved;
  });

  // Массовый DnD: те же правила, что /dnd-place-hangar, для списка событий.
  app.post("/dnd-place-hangar/batch", async (req) => {
    assertCanWriteEvent(req);
    const roles = ((req as any).auth?.roles ?? []) as string[];
    if (!req.sandbox && !roles.includes("ADMIN") && !roles.includes("PLANNER")) {
      const err: any = new Error("FORBIDDEN");
      err.statusCode = 403;
      throw err;
    }

    const body = z
      .object({
        eventIds: z.array(zUuid).min(1).max(200),
        hangarId: zUuid,
        startAt: zDateTime,
        endAt: zDateTime,
        /** Смещение длительности сохраняется per-event; startAt/endAt — якорь лидера. */
        changeReason: z.string().trim().min(1).max(1000)
      })
      .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt" })
      .parse(req.body);

    const sbId = sandboxIdFor(req);
    const uniqueIds = Array.from(new Set(body.eventIds));
    const leaderDurationMs = body.endAt.valueOf() - body.startAt.valueOf();

    const result = await app.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const events = await tx.maintenanceEvent.findMany({
          where: { id: { in: uniqueIds }, sandboxId: sbId },
          include: { reservations: { orderBy: [{ startAt: "asc" }] }, aircraft: true }
        });
        if (events.length === 0) throw app.httpErrors.notFound("Events not found");

        const byId = new Map(events.map((e) => [e.id, e]));
        const ordered = uniqueIds.map((id) => byId.get(id)).filter(Boolean) as typeof events;
        const leader = ordered[0]!;
        const leaderOrigStart = leader.startAt.valueOf();

        const placements: Array<{
          eventId: string;
          hangarId: string;
          layoutId: string;
          layoutName: string;
          standId: string;
          standCode: string;
          startAt: string;
          endAt: string;
        }> = [];
        const errors: Array<{ eventId: string; message: string }> = [];
        const overlaps = (aStart: Date | string, aEnd: Date | string, bStart: Date | string, bEnd: Date | string) =>
          new Date(aStart).valueOf() < new Date(bEnd).valueOf() && new Date(aEnd).valueOf() > new Date(bStart).valueOf();

        for (const event of ordered) {
          const delta = event.startAt.valueOf() - leaderOrigStart;
          const startAt = new Date(body.startAt.valueOf() + delta);
          const duration = event.endAt.valueOf() - event.startAt.valueOf();
          const endAt = new Date(startAt.valueOf() + (duration > 0 ? duration : leaderDurationMs));
          const eventLabel =
            `${event.title ?? "событие"} (${(event as any).aircraft?.tailNumber ?? (event as any).virtualAircraft?.label ?? event.id})`;

          try {
            const [layouts, overlapping] = await Promise.all([
              tx.hangarLayout.findMany({
                where: { hangarId: body.hangarId, isActive: true },
                include: {
                  hangar: true,
                  stands: {
                    where: { isActive: true },
                    include: { allowedAircraftTypes: { select: { aircraftTypeId: true } } },
                    orderBy: [{ code: "asc" }]
                  }
                },
                orderBy: [{ code: "asc" }, { name: "asc" }]
              }),
              tx.standReservation.findMany({
                where: {
                  sandboxId: sbId,
                  eventId: { notIn: uniqueIds },
                  layout: { hangarId: body.hangarId },
                  startAt: { lt: endAt },
                  endAt: { gt: startAt },
                  event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
                },
                include: { layout: { select: { id: true, name: true } }, event: { include: { aircraft: true } } },
                orderBy: [{ startAt: "asc" }]
              })
            ]);

            if (layouts.length === 0) throw new Error("В ангаре нет активных схем расстановки");

            // Уже размещённые в этом batch события не видны в overlapping (исключены notIn uniqueIds) —
            // учитываем их отдельно: занятость мест и блокировку схемы по пересечению времени.
            const batchOverlapping = placements.filter((p) => overlaps(p.startAt, p.endAt, startAt, endAt));
            const activeLayoutIds = Array.from(
              new Set([
                ...overlapping.map((r: any) => r.layoutId as string),
                ...batchOverlapping.map((p) => p.layoutId)
              ])
            );
            const allowedLayoutIds = new Set(activeLayoutIds.length > 0 ? activeLayoutIds : layouts.map((layout: any) => layout.id));
            const aircraftTypeId = eventAircraftTypeId(event);
            const currentReservation = event.reservations[0] ?? null;
            const currentStand = currentReservation
              ? layouts.flatMap((layout: any) => layout.stands ?? []).find((stand: any) => stand.id === currentReservation.standId)
              : null;
            const currentStandCode = currentStand?.code ?? null;

            const candidates = layouts
              .filter((layout: any) => allowedLayoutIds.has(layout.id))
              .flatMap((layout: any) =>
                (layout.stands ?? []).flatMap((stand: any) => {
                  if (!standAccepts(stand, aircraftTypeId)) return [];
                  const standBusyExternal = overlapping.some((reservation: any) => reservation.standId === stand.id);
                  if (standBusyExternal) return [];
                  const standBusyInBatch = batchOverlapping.some((p) => p.standId === stand.id);
                  if (standBusyInBatch) return [];
                  const sameStandCode = Boolean(currentStandCode && stand.code === currentStandCode);
                  const activeLayout = activeLayoutIds.includes(layout.id);
                  const score =
                    (activeLayout ? 1000 : 0) + (sameStandCode ? 100 : 0) + (allowedAircraftTypeIds(stand).length > 0 ? 10 : 0);
                  return [{ layout, stand, score }];
                })
              )
              .sort(
                (a: any, b: any) =>
                  b.score - a.score || a.layout.name.localeCompare(b.layout.name, "ru") || a.stand.code.localeCompare(b.stand.code, "ru")
              );

            const candidate = candidates[0];
            if (!candidate) {
              const activeNames = activeLayoutIds.length
                ? layouts.filter((l: any) => activeLayoutIds.includes(l.id)).map((l: any) => l.name).filter(Boolean).join(", ")
                : "";
              throw new Error(
                activeNames
                  ? `${eventLabel}: нет свободного подходящего места в активной схеме периода (${activeNames})`
                  : `${eventLabel}: нет свободного подходящего места в активных схемах ангара`
              );
            }

            const prev = {
              startAt: event.startAt.toISOString(),
              endAt: event.endAt.toISOString(),
              hangarId: event.hangarId ?? null,
              layoutId: event.layoutId ?? null
            };

            await tx.maintenanceEvent.update({
              where: { id: event.id },
              data: { startAt, endAt, layoutId: candidate.layout.id, hangarId: body.hangarId }
            });

            const reservation = await replaceSingleReservation(tx, {
              eventId: event.id,
              sandboxId: sbId,
              hangarId: body.hangarId,
              layoutId: candidate.layout.id,
              standId: candidate.stand.id,
              startAt,
              endAt,
              budgetStartAt: (event as any).budgetStartAt ?? null,
              budgetEndAt: (event as any).budgetEndAt ?? null,
              actualStartAt: (event as any).actualStartAt ?? null,
              actualEndAt: (event as any).actualEndAt ?? null
            });

            await tx.maintenanceEventAudit.create({
              data: {
                eventId: event.id,
                sandboxId: sbId,
                action: EventAuditAction.UPDATE,
                actor: getActor(req),
                reason: body.changeReason,
                changes: {
                  dnd: { mode: "hangar-auto-placement-batch", batchSize: ordered.length },
                  from: prev,
                  to: {
                    startAt: startAt.toISOString(),
                    endAt: endAt.toISOString(),
                    hangarId: body.hangarId,
                    layoutId: candidate.layout.id,
                    standId: candidate.stand.id,
                    reservation: {
                      layoutId: reservation.layoutId,
                      standId: reservation.standId,
                      startAt: reservation.startAt.toISOString(),
                      endAt: reservation.endAt.toISOString()
                    }
                  }
                }
              }
            });

            placements.push({
              eventId: event.id,
              hangarId: body.hangarId,
              layoutId: candidate.layout.id,
              layoutName: candidate.layout.name,
              standId: candidate.stand.id,
              standCode: candidate.stand.code,
              startAt: startAt.toISOString(),
              endAt: endAt.toISOString()
            });
          } catch (err: any) {
            const msg = String(err?.message ?? err);
            errors.push({
              eventId: event.id,
              message: msg.includes(eventLabel) ? msg : `${eventLabel}: ${msg}`
            });
          }
        }

        if (placements.length === 0) {
          throw app.httpErrors.conflict(errors.map((e) => e.message).join("; ") || "Не удалось перенести события");
        }

        return {
          ok: true,
          moved: placements.length,
          placements,
          errors
        };
      },
      { timeout: 120_000, maxWait: 15_000 }
    );

    return result;
  });

  app.delete("/by-event/:eventId", async (req) => {
    assertCanWriteEvent(req);
    const eventId = zUuid.parse((req.params as any).eventId);
    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req) },
      select: { id: true }
    });
    if (!event) throw app.httpErrors.notFound("Event not found");
    const existing = await app.prisma.standReservation.findFirst({ where: { eventId, ...sandboxFilter(req) }, orderBy: [{ startAt: "asc" }] });
    if (!existing) {
      // идемпотентность: если резерва нет — считаем, что "уже снято"
      return { ok: true, deleted: 0 };
    }

    const del = await app.prisma.standReservation.deleteMany({ where: { eventId } });
    await app.prisma.eventPlacement.deleteMany({ where: { eventId } });
    await app.prisma.maintenanceEvent.update({ where: { id: eventId }, data: { hangarId: null, layoutId: null } });

    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId,
        sandboxId: sandboxIdFor(req),
        action: EventAuditAction.UNRESERVE,
        actor: getActor(req),
        reason: "Снятие резерва",
        changes: {
          reservation: {
            from: {
              layoutId: existing.layoutId,
              standId: existing.standId,
              startAt: existing.startAt.toISOString(),
              endAt: existing.endAt.toISOString()
            },
            to: null
          }
        }
      }
    });
    return { ok: true, deleted: del.count };
  });
};

