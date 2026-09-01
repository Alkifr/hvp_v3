import { EventStatus } from "@prisma/client";

const INACTIVE_EVENT_STATUSES: EventStatus[] = [EventStatus.CANCELLED, EventStatus.DELETED];

export function resolveAllowOverlap(params: {
  requested?: boolean;
  stored?: boolean;
  existingOverlap: boolean;
}): { skipChecks: boolean; storedValue: boolean } {
  const stored = Boolean(params.stored);
  const skipChecks = Boolean(params.requested || stored || params.existingOverlap);
  let storedValue = stored;
  if (params.existingOverlap || params.requested === true) storedValue = true;
  else if (params.requested === false) storedValue = false;
  return { skipChecks, storedValue };
}

export async function eventHasExistingSlotOverlap(
  tx: any,
  params: { sandboxId: string | null; eventId: string }
): Promise<boolean> {
  const reservations = await tx.standReservation.findMany({
    where: { eventId: params.eventId, sandboxId: params.sandboxId },
    select: {
      standId: true,
      layoutId: true,
      startAt: true,
      endAt: true,
      layout: { select: { hangarId: true } }
    }
  });
  if (reservations.length === 0) return false;

  for (const reservation of reservations) {
    const standConflict = await tx.standReservation.findFirst({
      where: {
        sandboxId: params.sandboxId,
        standId: reservation.standId,
        eventId: { not: params.eventId },
        startAt: { lt: reservation.endAt },
        endAt: { gt: reservation.startAt },
        event: { status: { notIn: INACTIVE_EVENT_STATUSES } }
      },
      select: { id: true }
    });
    if (standConflict) return true;

    const hangarId = reservation.layout?.hangarId;
    if (!hangarId) continue;

    const layoutConflict = await tx.standReservation.findFirst({
      where: {
        sandboxId: params.sandboxId,
        eventId: { not: params.eventId },
        layoutId: { not: reservation.layoutId },
        startAt: { lt: reservation.endAt },
        endAt: { gt: reservation.startAt },
        layout: { hangarId },
        event: { status: { notIn: INACTIVE_EVENT_STATUSES } }
      },
      select: { id: true }
    });
    if (layoutConflict) return true;
  }

  return false;
}
