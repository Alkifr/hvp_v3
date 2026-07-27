import type { FastifyInstance } from "fastify";
import { EventStatus, Prisma } from "@prisma/client";

const KIND_IN_PROGRESS = "EVENT_STATUS_IN_PROGRESS";
const KIND_DONE = "EVENT_STATUS_DONE";

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
 * Create bell notifications for auto status transitions (prod only).
 * Uses dedupe keys so repeated reconcile is safe.
 */
export async function emitStatusChangeNotifications(
  prisma: FastifyInstance["prisma"],
  params: {
    eventId: string;
    sandboxId: string | null | undefined;
    title: string;
    fromStatus: EventStatus;
    toStatus: EventStatus;
    aircraft?: { tailNumber?: string | null } | null;
    virtualAircraft?: unknown;
  }
): Promise<number> {
  if (params.sandboxId != null) return 0;
  if (params.fromStatus === params.toStatus) return 0;

  const label = aircraftLabel({
    title: params.title,
    aircraft: params.aircraft,
    virtualAircraft: params.virtualAircraft
  });

  const rows: Prisma.AppNotificationCreateManyInput[] = [];

  if (params.toStatus === EventStatus.IN_PROGRESS) {
    rows.push({
      kind: KIND_IN_PROGRESS,
      title: "Событие перешло в работу",
      body: `${label}: «${params.title}» — статус автоматически сменён на «В работе».`,
      eventId: params.eventId,
      sandboxId: null,
      dedupeKey: `status-in-progress:${params.eventId}`
    });
  }

  if (params.toStatus === EventStatus.DONE) {
    rows.push({
      kind: KIND_DONE,
      title: "Событие завершено",
      body: `${label}: «${params.title}» — статус автоматически сменён на «Завершено».`,
      eventId: params.eventId,
      sandboxId: null,
      dedupeKey: `status-done:${params.eventId}`
    });
  }

  if (rows.length === 0) return 0;

  const created = await prisma.appNotification.createMany({
    data: rows,
    skipDuplicates: true
  });
  return created.count;
}
