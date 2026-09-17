import { EventStatus } from "./eventStatusCatalog.js";

/** Короткая подпись плейсхолдера; в справочник бортов не пишется. */
export const VIRTUAL_AIRCRAFT_LABEL = "VIRT";

const VIRTUAL_AIRCRAFT_ALLOWED_STATUSES = new Set<EventStatus>([
  EventStatus.PENDING_EXECUTOR_APPROVAL,
  EventStatus.PENDING_CUSTOMER_APPROVAL,
  EventStatus.CANCELLED,
  EventStatus.DELETED
]);

export function isVirtualAircraftPlaceholder(event: {
  aircraftId?: string | null;
  virtualAircraft?: unknown;
}): boolean {
  return !event.aircraftId && event.virtualAircraft != null;
}

export function statusAllowsVirtualAircraft(status: EventStatus | string): boolean {
  return VIRTUAL_AIRCRAFT_ALLOWED_STATUSES.has(status as EventStatus);
}

export function virtualAircraftDisplayLabel(_raw?: string | null): string {
  return VIRTUAL_AIRCRAFT_LABEL;
}
