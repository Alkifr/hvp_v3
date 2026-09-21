import { MSK_OFFSET_MINUTES } from "./localDate.js";

/** Перрон / стоянка вне ангара — «откуда» при закатке в начале ТО. */
export const APRON_STAND_LABEL = "МС";

export type TowPlacementInput = {
  id?: string | null;
  startAt: Date;
  endAt: Date;
  hangarId?: string | null;
  hangarCode: string | null;
  hangarName: string | null;
  standCode: string | null;
};

export type TowDirection = "IN" | "OUT" | "TRANSFER" | "UNKNOWN";

export type TowRouteInference = {
  direction: TowDirection;
  fromStand: string | null;
  toStand: string | null;
  hangarId: string | null;
  hangarCode: string | null;
  hangarName: string | null;
  occupancyMs: number | null;
  placementId: string | null;
};

const MATCH_SLACK_MS = 2 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatMskDateTime(at: Date, offsetMinutes = MSK_OFFSET_MINUTES): string {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000);
  return `${pad2(shifted.getUTCDate())}.${pad2(shifted.getUTCMonth() + 1)}.${shifted.getUTCFullYear()} ${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
}

export function formatDurationLabel(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

export function durationMs(start?: Date | null, end?: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function towDirectionLabel(direction: TowDirection): string {
  if (direction === "IN") return "Закатка";
  if (direction === "OUT") return "Выкатка";
  if (direction === "TRANSFER") return "Перестановка";
  return "";
}

function near(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= MATCH_SLACK_MS;
}

function locHangar(p: TowPlacementInput | null | undefined, fallback?: { hangarId?: string | null; hangarCode: string | null; hangarName: string | null }) {
  return {
    hangarId: p?.hangarId ?? fallback?.hangarId ?? null,
    hangarCode: p?.hangarCode ?? fallback?.hangarCode ?? null,
    hangarName: p?.hangarName ?? fallback?.hangarName ?? null
  };
}

export function inferTowRoute(
  towStart: Date,
  towEnd: Date,
  placements: TowPlacementInput[],
  fallback?: {
    hangarId?: string | null;
    hangarCode: string | null;
    hangarName: string | null;
    occupancyMs: number | null;
  },
  bound?: TowPlacementInput | null
): TowRouteInference {
  const sorted = [...placements].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const prev = [...sorted].reverse().find((p) => near(p.endAt, towStart)) ?? null;
  const next = sorted.find((p) => near(p.startAt, towEnd)) ?? null;
  const overlap =
    sorted.find((p) => p.startAt.getTime() < towEnd.getTime() && p.endAt.getTime() > towStart.getTime()) ?? null;

  let direction: TowDirection = "UNKNOWN";
  if (bound) {
    if (near(towEnd, bound.startAt) && !near(towStart, bound.endAt)) direction = "IN";
    else if (near(towStart, bound.endAt) && !near(towEnd, bound.startAt)) direction = "OUT";
    else if (prev && next && prev.id !== next.id) direction = "TRANSFER";
    else if (near(towEnd, bound.startAt)) direction = "IN";
    else if (near(towStart, bound.endAt)) direction = "OUT";
  } else if (prev && next && prev !== next) direction = "TRANSFER";
  else if (next) direction = "IN";
  else if (prev) direction = "OUT";

  const loc =
    bound ??
    (direction === "IN" ? next : direction === "OUT" ? prev : direction === "TRANSFER" ? next : overlap);

  let fromStand: string | null = prev?.standCode ?? null;
  let toStand: string | null = next?.standCode ?? null;
  if (direction === "IN") {
    fromStand = APRON_STAND_LABEL;
    toStand = (bound ?? next)?.standCode ?? null;
  } else if (direction === "OUT") {
    fromStand = (bound ?? prev)?.standCode ?? null;
    toStand = APRON_STAND_LABEL;
  }

  const hangar = locHangar(loc, fallback);
  return {
    direction,
    fromStand,
    toStand,
    hangarId: hangar.hangarId,
    hangarCode: hangar.hangarCode,
    hangarName: hangar.hangarName,
    occupancyMs: loc ? durationMs(loc.startAt, loc.endAt) : (fallback?.occupancyMs ?? null),
    placementId: bound?.id ?? loc?.id ?? null
  };
}

export type TowReportSource = {
  id: string;
  eventId: string;
  startAt: Date;
  endAt: Date;
  fromLabel: string | null;
  toLabel: string | null;
  notes: string | null;
  positionComment: string | null;
  startChangeReason: string | null;
  occupancyEndAt: Date | null;
  fromStandCode: string | null;
  toStandCode: string | null;
  placementId: string | null;
  eventStatus: string;
  eventTitle: string;
  eventTypeId: string | null;
  eventType: string | null;
  eventNotes: string | null;
  eventStartAt: Date;
  eventEndAt: Date;
  hangarId: string | null;
  hangarCode: string | null;
  hangarName: string | null;
  reservationStandCode: string | null;
  tailNumber: string | null;
  aircraftId: string | null;
  aircraftType: string | null;
  aircraftTypeId: string | null;
  operator: string | null;
  operatorId: string | null;
  customerSlotStartAt: Date | null;
  customerSlotEndAt: Date | null;
  placements: TowPlacementInput[];
};

export type TowReportRow = {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStatus: string;
  eventTypeId: string;
  eventType: string;
  seq: number;
  direction: TowDirection;
  directionLabel: string;
  towDurationMinutes: number | null;
  hangarId: string;
  hangarNumber: string;
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
  operatorId: string;
  operator: string;
  fromStand: string;
  toStand: string;
  plannedStartAt: string;
  plannedStartMsk: string;
  plannedEndAt: string;
  plannedEndMsk: string;
  occupancyEndAt: string;
  occupancyEndMsk: string;
  inferredOccupancyEndAt: string;
  standOccupancy: string;
  standOccupancyMinutes: number | null;
  notes: string;
  toSlotEndAt: string;
  toSlotEndMsk: string;
  toSlotDuration: string;
  toSlotMinutes: number | null;
  positionComment: string;
  startChangeReason: string;
  fromLabel: string;
  toLabel: string;
  placementId: string;
};

function text(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function buildTowReportRow(src: TowReportSource): TowReportRow {
  const bound = src.placementId ? src.placements.find((p) => p.id === src.placementId) ?? null : null;
  const inferred = inferTowRoute(
    src.startAt,
    src.endAt,
    src.placements,
    {
      hangarId: src.hangarId,
      hangarCode: src.hangarCode,
      hangarName: src.hangarName,
      occupancyMs: durationMs(src.eventStartAt, src.eventEndAt)
    },
    bound
  );
  const fromStand = text(src.fromLabel) || text(src.fromStandCode) || text(inferred.fromStand);
  const toStand = text(src.toLabel) || text(src.toStandCode) || text(inferred.toStand);
  const slotEnd = bound?.endAt ?? src.eventEndAt;
  const occupancyEnd = src.occupancyEndAt ?? slotEnd;
  const occupancyMs = durationMs(src.startAt, occupancyEnd);
  const slotMs = durationMs(src.eventStartAt, slotEnd);
  const movementMs = durationMs(src.startAt, src.endAt);
  const hangarNumber = text(inferred.hangarName) || text(src.hangarName) || text(inferred.hangarCode) || text(src.hangarCode);

  return {
    id: src.id,
    eventId: src.eventId,
    eventTitle: src.eventTitle,
    eventStatus: text(src.eventStatus),
    eventTypeId: text(src.eventTypeId),
    eventType: text(src.eventType),
    seq: 0,
    direction: inferred.direction,
    directionLabel: towDirectionLabel(inferred.direction),
    towDurationMinutes: movementMs == null ? null : Math.round(movementMs / 60_000),
    hangarId: text(inferred.hangarId) || text(src.hangarId),
    hangarNumber,
    aircraftTypeId: text(src.aircraftTypeId),
    aircraftType: text(src.aircraftType),
    aircraftId: text(src.aircraftId),
    tailNumber: text(src.tailNumber),
    operatorId: text(src.operatorId),
    operator: text(src.operator),
    fromStand,
    toStand,
    plannedStartAt: src.startAt.toISOString(),
    plannedStartMsk: formatMskDateTime(src.startAt),
    plannedEndAt: src.endAt.toISOString(),
    plannedEndMsk: formatMskDateTime(src.endAt),
    occupancyEndAt: src.occupancyEndAt ? src.occupancyEndAt.toISOString() : "",
    occupancyEndMsk: formatMskDateTime(occupancyEnd),
    inferredOccupancyEndAt: slotEnd.toISOString(),
    standOccupancy: formatDurationLabel(occupancyMs),
    standOccupancyMinutes: occupancyMs == null ? null : Math.round(occupancyMs / 60_000),
    notes: text(src.notes) || text(src.eventNotes),
    toSlotEndAt: slotEnd.toISOString(),
    toSlotEndMsk: formatMskDateTime(slotEnd),
    toSlotDuration: formatDurationLabel(slotMs),
    toSlotMinutes: slotMs == null ? null : Math.round(slotMs / 60_000),
    positionComment: text(src.positionComment),
    startChangeReason: text(src.startChangeReason),
    fromLabel: text(src.fromLabel),
    toLabel: text(src.toLabel),
    placementId: text(src.placementId) || text(inferred.placementId)
  };
}

export const TOW_EXPORT_COLUMNS: Array<{ key: keyof TowReportRow; title: string }> = [
  { key: "seq", title: "Строка" },
  { key: "hangarNumber", title: "Ангар" },
  { key: "aircraftType", title: "Тип ВС" },
  { key: "tailNumber", title: "Бортовой номер" },
  { key: "operator", title: "Оператор" },
  { key: "fromStand", title: "Откуда (с МС)" },
  { key: "toStand", title: "Куда (на МС)" },
  { key: "plannedStartMsk", title: "Плановое время начала буксировки (мск)" },
  { key: "occupancyEndMsk", title: "Конец (мск)" },
  { key: "standOccupancy", title: "Продолжительность занятия МС" },
  { key: "notes", title: "Примечание" },
  { key: "toSlotEndMsk", title: "Слот ТО" },
  { key: "positionComment", title: "Позиция" },
  { key: "startChangeReason", title: "Причина изменения времени начала буксировки" }
];
