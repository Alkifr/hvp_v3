import type { FastifyInstance } from "fastify";
import { EventAuditAction, EventStatus, Prisma } from "@prisma/client";

import { isEventOverdueNoFact, reconcileEventStatus } from "./eventStatus.js";
import { loadStatusAutomation } from "./eventStatusCatalog.js";
import { emitStatusChangeNotifications } from "./eventStatusNotifications.js";

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

function isoOrNull(v: Date | null | undefined): string | null {
  return v ? v.toISOString() : null;
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
  const automation = await loadStatusAutomation(app.prisma);
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
  const auditRows: Prisma.MaintenanceEventAuditCreateManyInput[] = [];

  for (const ev of events) {
    const reconciled = reconcileEventStatus({
      status: ev.status,
      startAt: ev.startAt,
      endAt: ev.endAt,
      actualStartAt: ev.actualStartAt,
      actualEndAt: ev.actualEndAt,
      now,
      autoInProgressStatuses: automation.autoInProgressStatuses
    });

    const statusChanged = reconciled.status !== ev.status;
    const actualStartChanged =
      (reconciled.actualStartAt?.valueOf() ?? null) !== (ev.actualStartAt?.valueOf() ?? null);
    const actualEndChanged =
      (reconciled.actualEndAt?.valueOf() ?? null) !== (ev.actualEndAt?.valueOf() ?? null);

    if (reconciled.statusChanged || reconciled.actualFilledFromOper || actualStartChanged || actualEndChanged) {
      await app.prisma.maintenanceEvent.update({
        where: { id: ev.id },
        data: {
          status: reconciled.status,
          actualStartAt: reconciled.actualStartAt,
          actualEndAt: reconciled.actualEndAt
        }
      });
      statusUpdated += 1;

      const changes: Record<string, { from: string | null; to: string | null }> = {};
      if (statusChanged) {
        changes.status = { from: ev.status, to: reconciled.status };
      }
      if (actualStartChanged) {
        changes.actualStartAt = {
          from: isoOrNull(ev.actualStartAt),
          to: isoOrNull(reconciled.actualStartAt)
        };
      }
      if (actualEndChanged) {
        changes.actualEndAt = {
          from: isoOrNull(ev.actualEndAt),
          to: isoOrNull(reconciled.actualEndAt)
        };
      }
      if (Object.keys(changes).length > 0) {
        auditRows.push({
          eventId: ev.id,
          sandboxId: ev.sandboxId,
          action: EventAuditAction.UPDATE,
          actor: "system",
          reason: "Автостатус",
          changes
        });
      }

      if (statusChanged) {
        notificationsCreated += await emitStatusChangeNotifications(app.prisma, {
          eventId: ev.id,
          sandboxId: ev.sandboxId,
          title: ev.title,
          fromStatus: ev.status,
          toStatus: reconciled.status,
          aircraft: ev.aircraft,
          virtualAircraft: ev.virtualAircraft
        });
      }
    }

    // Уведомления в колокольчик — только для рабочего контура (не для песочниц).
    if (ev.sandboxId != null) continue;

    const statusForOverdue = reconciled.status;
    if (
      isEventOverdueNoFact({
        status: statusForOverdue,
        endAt: ev.endAt,
        actualStartAt: reconciled.actualStartAt,
        actualEndAt: reconciled.actualEndAt,
        now,
        manualOnlyStatuses: automation.manualOnlyStatuses
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
            sandboxId: null,
            dedupeKey
          }
        ],
        skipDuplicates: true
      });
      if (created.count > 0) notificationsCreated += 1;
    }
  }

  if (auditRows.length > 0) {
    await app.prisma.maintenanceEventAudit.createMany({ data: auditRows });
  }

  return { statusUpdated, notificationsCreated };
}
