export const VIRTUAL_AIRCRAFT_LABEL = "VIRT";

export const VIRTUAL_AIRCRAFT_NEEDS_REAL_MESSAGE =
  "Событие создано массовым планированием с виртуальным бортом. Выберите реальный борт из справочника, затем повторите смену статуса.";

const VIRTUAL_AIRCRAFT_ALLOWED_STATUSES = new Set([
  "PENDING_EXECUTOR_APPROVAL",
  "PENDING_CUSTOMER_APPROVAL",
  "CANCELLED",
  "DELETED"
]);

export function isVirtualAircraftPlaceholder(event: {
  aircraftId?: string | null;
  virtualAircraft?: unknown;
}): boolean {
  return !event.aircraftId && event.virtualAircraft != null;
}

export function statusAllowsVirtualAircraft(status: string | null | undefined): boolean {
  if (!status) return false;
  return VIRTUAL_AIRCRAFT_ALLOWED_STATUSES.has(status);
}

export function virtualAircraftDisplayLabel(_raw?: string | null): string {
  return VIRTUAL_AIRCRAFT_LABEL;
}

export function virtualAircraftStatusError(params: {
  status: string | null | undefined;
  aircraftId?: string | null;
  hasVirtualAircraft: boolean;
}): string | null {
  if (params.aircraftId) return null;
  if (!params.hasVirtualAircraft) return null;
  if (statusAllowsVirtualAircraft(params.status)) return null;
  return VIRTUAL_AIRCRAFT_NEEDS_REAL_MESSAGE;
}
