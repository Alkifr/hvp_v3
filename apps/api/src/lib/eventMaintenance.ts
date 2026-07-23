import type { FastifyInstance } from "fastify";
import { EventStatus } from "@prisma/client";

import { isEventOverdueNoFact, reconcileEventStatus } from "./eventStatus.js";

const KIND_OVERDUE = "EVENT_OVERDUE_NO_FACT";

function aircraftLabel(ev: {
  title: string;
  aircraft?: { tailNumber?: string | null } | null;
  virtualAircraft?: unknown;
}): string {
  const tail = ev.aircraft?.tailNumber;
  if (tail) return String(tail);
  const virt = ev.virtualAircraft as { label?: string } | null;
  if (virt?.label) return String(virt.label);
  return ev.title;
}

/**
 * Reconcile auto-statuses for active events and emit overdue-no-fact notifications.
 * Safe to run periodically (every ~1 min).
 */
export async function runEventStatusMaintenance(app: FastifyInstance): Promise<{
  statusUpdated: number;
  notificationsCreated: number;
}> {
  const now = new Date();
  const horizonFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const horizonTo = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const events = await app.prisma.maintenanceEvent.findMany({
    where: {
      status: { notIn: [EventStatus.DELETED, EventStatus.CANCELLED] },
      OR: [
        { startAt: { lte: horizonTo }, endAt: { gte: horizonFrom } },
        { actualStartAt: { lte: horizonTo }, actualEndAt: { gte: horizonFrom } }
      ]
    },
    select: {
      id: true,
      title: true,
      status: true,
      startAt: true,
      endAt: true,
      actualStartAt: true,
      actualEndAt: true,
      sandboxId: true,
      aircraft: { select: { tailNumber: true } },
      virtualAircraft: true
    },
    take: 5000
  });

  let statusUpdated = 0;
  let notificationsCreated = 0;

  for (const ev of events) {
    const reconciled = reconcileEventStatus({
      status: ev.status,
      startAt: ev.startAt,
      endAt: ev.endAt,
      actualStartAt: ev.actualStartAt,
      actualEndAt: ev.actualEndAt,
      now
    });

    if (
      reconciled.statusChanged ||
      reconciled.actualFilledFromOper ||
      (reconciled.actualStartAt?.valueOf() ?? null) !== (ev.actualStartAt?.valueOf() ?? null) ||
      (reconciled.actualEndAt?.valueOf() ?? null) !== (ev.actualEndAt?.valueOf() ?? null)
    ) {
      await app.prisma.maintenanceEvent.update({
        where: { id: ev.id },
        data: {
          status: reconciled.status,
          actualStartAt: reconciled.actualStartAt,
          actualEndAt: reconciled.actualEndAt
        }
      });
      statusUpdated += 1;
    }

    const statusForOverdue = reconciled.status;
    if (
      isEventOverdueNoFact({
        status: statusForOverdue,
        endAt: ev.endAt,
        actualStartAt: reconciled.actualStartAt,
        actualEndAt: reconciled.actualEndAt,
        now
      })
    ) {
      const label = aircraftLabel(ev);
      const dedupeKey = `overdue:${ev.id}`;
      // ON CONFLICT DO NOTHING — без ERROR в логах Postgres при повторном прогоне / гонке инстансов
      const created = await app.prisma.appNotification.createMany({
        data: [
          {
            kind: KIND_OVERDUE,
            title: "Событие без факта после опер. окончания",
            body: `${label}: «${ev.title}» — оперативный период закончился, факт не заполнен.`,
            eventId: ev.id,
            sandboxId: ev.sandboxId,
            dedupeKey
          }
        ],
        skipDuplicates: true
      });
      if (created.count > 0) notificationsCreated += 1;
    }
  }

  return { statusUpdated, notificationsCreated };
}
