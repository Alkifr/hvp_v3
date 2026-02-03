import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, EventStatus } from "@prisma/client";

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

