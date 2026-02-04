import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, EventStatus, Prisma } from "@prisma/client";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  const h = req.headers ?? {};
  return String(h["x-actor"] ?? h["x-user"] ?? "browser").slice(0, 80);
}

export const reservationsRoutes: FastifyPluginAsync = async (app) => {
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
        layoutId: query.layoutId,
        startAt: { lt: to },
        endAt: { gt: from },
        event: { status: { not: EventStatus.CANCELLED } }
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
    assertPermission(req, "events:write");
    const eventId = zUuid.parse((req.params as any).eventId);
    const body = z
      .object({
        layoutId: zUuid,
        standId: zUuid,
        startAt: zDateTime.optional(),
        endAt: zDateTime.optional(),
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .parse(req.body);

    const event = await app.prisma.maintenanceEvent.findUniqueOrThrow({
      where: { id: eventId }
    });

    const existingReservation = await app.prisma.standReservation.findUnique({
      where: { eventId }
    });

    const startAt = body.startAt ?? event.startAt;
    const endAt = body.endAt ?? event.endAt;
    if (endAt <= startAt) {
      throw app.httpErrors.badRequest("endAt must be after startAt");
    }

    // Проверка конфликтов: любое пересечение по времени на том же месте
    const conflict = await app.prisma.standReservation.findFirst({
      where: {
        standId: body.standId,
        eventId: { not: eventId },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        event: { status: { not: EventStatus.CANCELLED } }
      },
      include: { event: { include: { aircraft: true, eventType: true } } }
    });

    if (conflict) {
      throw app.httpErrors.conflict(
        `Место уже занято: ${conflict.event.title} (${conflict.event.aircraft.tailNumber})`
      );
    }

    const layout = await app.prisma.hangarLayout.findUniqueOrThrow({
      where: { id: body.layoutId },
      select: { id: true, hangarId: true }
    });

    // Upsert по уникальному eventId
    const reservation = await app.prisma.standReservation.upsert({
      where: { eventId },
      update: {
        layoutId: body.layoutId,
        standId: body.standId,
        startAt,
        endAt
      },
      create: {
        eventId,
        layoutId: body.layoutId,
        standId: body.standId,
        startAt,
        endAt
      }
    });

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
    assertPermission(req, "events:write");
    const roles = ((req as any).auth?.roles ?? []) as string[];
    if (!roles.includes("ADMIN") && !roles.includes("PLANNER")) {
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

    const moved = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const event = await tx.maintenanceEvent.findUniqueOrThrow({
        where: { id: body.eventId },
        include: { reservation: true, aircraft: true }
      });

      const layout = await tx.hangarLayout.findUniqueOrThrow({
        where: { id: body.layoutId },
        select: { id: true, hangarId: true }
      });

      const startAt = event.startAt;
      const endAt = event.endAt;

      const conflicts = body.bumpedEventId
        ? await tx.standReservation.findMany({
            where: {
              standId: body.standId,
              eventId: body.bumpedEventId,
              startAt: { lt: endAt },
              endAt: { gt: startAt },
              event: { status: { not: EventStatus.CANCELLED } }
            },
            include: { event: { include: { aircraft: true } } }
          })
        : await tx.standReservation.findMany({
            where: {
              standId: body.standId,
              eventId: { not: body.eventId },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
              event: { status: { not: EventStatus.CANCELLED } }
            },
            include: { event: { include: { aircraft: true } } },
            orderBy: [{ startAt: "asc" }]
          });

      if (conflicts.length > 0 && !bump) {
        throw app.httpErrors.conflict(
          `Место уже занято: ${conflicts[0]!.event.title} (${conflicts[0]!.event.aircraft.tailNumber})`
        );
      }

      const bumpedEventIds: string[] = [];

      if (conflicts.length > 0 && bump) {
        // bump всех конфликтующих событий (пересекаются по времени с целевым placement)
        const toBump = conflicts.map((c) => c.eventId);
        bumpedEventIds.push(...toBump);

        // 1) снять резервы у всех конфликтующих
        await tx.standReservation.deleteMany({ where: { eventId: { in: toBump } } });
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

      const existingReservation = event.reservation
        ? {
            layoutId: event.reservation.layoutId,
            standId: event.reservation.standId,
            startAt: event.reservation.startAt,
            endAt: event.reservation.endAt
          }
        : null;

      // upsert резерва для перетаскиваемого события
      const reservation = await tx.standReservation.upsert({
        where: { eventId: body.eventId },
        update: { layoutId: body.layoutId, standId: body.standId, startAt, endAt },
        create: { eventId: body.eventId, layoutId: body.layoutId, standId: body.standId, startAt, endAt }
      });

      await tx.maintenanceEvent.update({
        where: { id: body.eventId },
        data: { layoutId: layout.id, hangarId: layout.hangarId }
      });

      await tx.maintenanceEventAudit.create({
        data: {
          eventId: body.eventId,
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
    assertPermission(req, "events:write");
    const roles = ((req as any).auth?.roles ?? []) as string[];
    if (!roles.includes("ADMIN") && !roles.includes("PLANNER")) {
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

    const moved = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const event = await tx.maintenanceEvent.findUniqueOrThrow({
        where: { id: body.eventId },
        include: { reservation: true, aircraft: true }
      });

      const layout = await tx.hangarLayout.findUniqueOrThrow({
        where: { id: body.layoutId },
        select: { id: true, hangarId: true }
      });

      // конфликты на целевой стоянке для нового времени
      const conflicts = body.bumpedEventId
        ? await tx.standReservation.findMany({
            where: {
              standId: body.standId,
              eventId: body.bumpedEventId,
              startAt: { lt: body.endAt },
              endAt: { gt: body.startAt },
              event: { status: { not: EventStatus.CANCELLED } }
            },
            include: { event: { include: { aircraft: true } } }
          })
        : await tx.standReservation.findMany({
            where: {
              standId: body.standId,
              eventId: { not: body.eventId },
              startAt: { lt: body.endAt },
              endAt: { gt: body.startAt },
              event: { status: { not: EventStatus.CANCELLED } }
            },
            include: { event: { include: { aircraft: true } } },
            orderBy: [{ startAt: "asc" }]
          });

      if (conflicts.length > 0 && !bump) {
        throw app.httpErrors.conflict(
          `Место уже занято: ${conflicts[0]!.event.title} (${conflicts[0]!.event.aircraft.tailNumber})`
        );
      }

      const bumpedEventIds: string[] = [];
      if (conflicts.length > 0 && bump) {
        // bump всех конфликтующих событий (пересекаются по времени с целевым placement)
        const toBump = conflicts.map((c) => c.eventId);
        bumpedEventIds.push(...toBump);

        await tx.standReservation.deleteMany({ where: { eventId: { in: toBump } } });
        await tx.maintenanceEvent.updateMany({
          where: { id: { in: toBump } },
          data: { hangarId: null, layoutId: null, status: EventStatus.DRAFT }
        });
        for (const bumpedEventId of toBump) {
          await tx.maintenanceEventAudit.create({
            data: {
              eventId: bumpedEventId,
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
        reservation: event.reservation
          ? {
              layoutId: event.reservation.layoutId,
              standId: event.reservation.standId,
              startAt: event.reservation.startAt.toISOString(),
              endAt: event.reservation.endAt.toISOString()
            }
          : null
      };

      // обновляем само событие (время + hangar/layout под цель)
      await tx.maintenanceEvent.update({
        where: { id: body.eventId },
        data: { startAt: body.startAt, endAt: body.endAt, layoutId: layout.id, hangarId: layout.hangarId }
      });

      // upsert резерва для события — следует времени события
      const reservation = await tx.standReservation.upsert({
        where: { eventId: body.eventId },
        update: { layoutId: body.layoutId, standId: body.standId, startAt: body.startAt, endAt: body.endAt },
        create: { eventId: body.eventId, layoutId: body.layoutId, standId: body.standId, startAt: body.startAt, endAt: body.endAt }
      });

      await tx.maintenanceEventAudit.create({
        data: {
          eventId: body.eventId,
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

  app.delete("/by-event/:eventId", async (req) => {
    assertPermission(req, "events:write");
    const eventId = zUuid.parse((req.params as any).eventId);
    const existing = await app.prisma.standReservation.findUnique({ where: { eventId } });
    if (!existing) {
      // идемпотентность: если резерва нет — считаем, что "уже снято"
      return { ok: true, deleted: 0 };
    }

    const del = await app.prisma.standReservation.deleteMany({ where: { eventId } });

    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId,
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

