import { APRON_STAND_LABEL, durationMs, formatDurationLabel, formatMskDateTime } from "./towReport.js";

export type TowPlanPlacement = {
  id: string;
  origin: "MANUAL" | "AUTO_GAP";
  startAt: Date;
  endAt: Date;
  hangarId: string | null;
  hangarLabel: string | null;
  hangarNumber: string | null;
  layoutName: string | null;
  standCode: string | null;
};

export type TowPlanTow = {
  id: string;
  startAt: Date;
  endAt: Date;
  fromLabel: string | null;
  toLabel: string | null;
  placementId: string | null;
  occupancyEndAt: Date | null;
};

export type TowPlanHangar = { id: string; label: string };

export type TowPlanEvent = {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  locked: boolean;
  hangarId: string | null;
  hangars: TowPlanHangar[];
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
  operatorId: string;
  operator: string;
  eventTitle: string;
  eventType: string;
  registryNotes?: string | null;
  registryPosition?: string | null;
  registryStartReason?: string | null;
  placements: TowPlanPlacement[];
  tows: TowPlanTow[];
  skipped: boolean;
};

export type TowPlanRow = {
  id: string;
  towId: string;
  eventId: string;
  locked: boolean;
  hangarId: string;
  hangars: TowPlanHangar[];
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
  operatorId: string;
  operator: string;
  eventTitle: string;
  eventType: string;
  hangarNumber: string;
  layoutName: string;
  parkedStand: string;
  fromStand: string;
  toStand: string;
  eventStartAt: string;
  eventEndAt: string;
  eventStartMsk: string;
  eventEndMsk: string;
  towStartAt: string;
  towEndAt: string;
  standOccupancy: string;
  placementId: string;
  createdAt: string;
  isNew: boolean;
  standOptions: string[];
  skipped: boolean;
  registryNotes: string;
  registryPosition: string;
  registryStartReason: string;
};

function text(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function intersects(start: Date, end: Date, from: Date, to: Date): boolean {
  return start < to && end > from;
}

function periodPlacements(event: TowPlanEvent, from: Date, to: Date): TowPlanPlacement[] {
  const manuals = event.placements.filter((placement) => placement.origin !== "AUTO_GAP");
  const source = manuals.length ? manuals : event.placements;
  return source
    .filter((placement) => intersects(placement.startAt, placement.endAt, from, to))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id));
}

function uniqueJoin(values: Array<string | null | undefined>): string {
  const items: string[] = [];
  for (const value of values) {
    const label = text(value);
    if (!label || items.includes(label)) continue;
    items.push(label);
  }
  return items.join(", ");
}

function standChoices(event: TowPlanEvent, from: Date, to: Date): string[] {
  const manuals = event.placements.filter((placement) => placement.origin !== "AUTO_GAP");
  const source = manuals.length ? manuals : event.placements;
  const stands: string[] = [];
  for (const placement of source) {
    if (!intersects(placement.startAt, placement.endAt, from, to)) continue;
    const code = text(placement.standCode);
    if (!code || code === APRON_STAND_LABEL || stands.includes(code)) continue;
    stands.push(code);
  }
  return [APRON_STAND_LABEL, ...stands];
}

function placementSpan(event: TowPlanEvent): { start: Date; end: Date; placementId: string } {
  const manuals = event.placements.filter((placement) => placement.origin !== "AUTO_GAP");
  const source = manuals.length ? manuals : event.placements;
  if (!source.length) return { start: event.startAt, end: event.endAt, placementId: "" };
  let start = source[0]!.startAt;
  let end = source[0]!.endAt;
  let placementId = source[0]!.id;
  for (const placement of source) {
    if (placement.startAt < start) {
      start = placement.startAt;
      placementId = placement.id;
    }
    if (placement.endAt > end) end = placement.endAt;
  }
  return { start, end, placementId };
}

export function buildTowPlanRows(events: TowPlanEvent[], from: Date, to: Date): TowPlanRow[] {
  const rows: TowPlanRow[] = [];
  for (const event of events) {
    const span = placementSpan(event);
    const inPeriod = periodPlacements(event, from, to);
    const standOptions = standChoices(event, from, to);
    const place = {
      hangarNumber: uniqueJoin(inPeriod.map((placement) => placement.hangarNumber)),
      layoutName: uniqueJoin(inPeriod.map((placement) => placement.layoutName)),
      parkedStand: uniqueJoin(inPeriod.map((placement) => placement.standCode))
    };
    const visible = event.tows
      .filter((tow) => intersects(tow.startAt, tow.endAt, from, to))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id));
    const base = {
      eventId: event.id,
      locked: event.locked,
      hangarId: text(event.hangarId),
      hangars: event.hangars,
      aircraftTypeId: event.aircraftTypeId,
      aircraftType: event.aircraftType,
      aircraftId: event.aircraftId,
      tailNumber: event.tailNumber,
      operatorId: event.operatorId,
      operator: event.operator,
      eventTitle: event.eventTitle,
      eventType: event.eventType,
      ...place,
      eventStartAt: span.start.toISOString(),
      eventEndAt: span.end.toISOString(),
      eventStartMsk: formatMskDateTime(span.start),
      eventEndMsk: formatMskDateTime(span.end),
      createdAt: event.createdAt.toISOString(),
      isNew: false,
      standOptions,
      skipped: event.skipped === true,
      registryNotes: text(event.registryNotes),
      registryPosition: text(event.registryPosition),
      registryStartReason: text(event.registryStartReason)
    };
    if (!visible.length) {
      rows.push({
        ...base,
        id: `event:${event.id}`,
        towId: "",
        fromStand: "",
        toStand: "",
        towStartAt: "",
        towEndAt: "",
        standOccupancy: "",
        placementId: span.placementId
      });
      continue;
    }
    for (const tow of visible) {
      const occupancyEnd = tow.occupancyEndAt ?? span.end;
      rows.push({
        ...base,
        id: tow.id,
        towId: tow.id,
        fromStand: text(tow.fromLabel),
        toStand: text(tow.toLabel),
        towStartAt: tow.startAt.toISOString(),
        towEndAt: tow.endAt.toISOString(),
        standOccupancy: formatDurationLabel(durationMs(tow.startAt, occupancyEnd)),
        placementId: text(tow.placementId) || span.placementId
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.eventStartAt.localeCompare(b.eventStartAt) ||
      a.towStartAt.localeCompare(b.towStartAt) ||
      a.tailNumber.localeCompare(b.tailNumber, "ru") ||
      a.id.localeCompare(b.id)
  );
  return rows;
}
