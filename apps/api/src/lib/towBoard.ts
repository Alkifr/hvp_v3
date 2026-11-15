import { planEdgeTows, type PlannedEdgeTow } from "./edgeTows.js";
import { isDoneScheduleLocked } from "./eventStatus.js";
import { directionFromTowLabels, formatMskDateTime, towDirectionLabel } from "./towReport.js";
import { virtualAircraftDisplayLabel } from "./virtualAircraft.js";

export type TowBoardEdgeRole = PlannedEdgeTow["role"];

export type TowBoardPlacement = {
  id: string;
  origin: "MANUAL" | "AUTO_GAP";
  startAt: Date;
  endAt: Date;
  hangarId: string | null;
  hangarName: string | null;
  hangarCode: string | null;
  standCode: string | null;
};

export type TowBoardTow = {
  id?: string;
  placementId?: string | null;
  occupancyEndAt?: Date | null;
  startChangeReason?: string | null;
  startAt: Date;
  endAt: Date;
  fromLabel: string | null;
  toLabel: string | null;
};

export type TowBoardPlacementView = {
  id: string;
  origin: "MANUAL" | "AUTO_GAP";
  startAt: string;
  endAt: string;
  hangarId: string;
  hangarLabel: string;
  standCode: string;
};

export type TowBoardTowView = {
  id: string;
  placementId: string;
  startAt: string;
  endAt: string;
  fromLabel: string;
  toLabel: string;
  direction: string;
  directionLabel: string;
  occupancyEndAt: string;
  startChangeReason: string;
};

export type TowBoardPending = {
  role: TowBoardEdgeRole;
  startAt: string;
  endAt: string;
  placementId: string;
  fromLabel: string;
  toLabel: string;
};

export type TowBoardInput = {
  id: string;
  title: string;
  status: string;
  startAt: Date;
  endAt: Date;
  hangarId: string | null;
  hangarName: string | null;
  hangarCode: string | null;
  tailNumber: string | null;
  aircraftId: string | null;
  virtual: boolean;
  aircraftTypeId: string | null;
  aircraftType: string | null;
  operatorId: string | null;
  operator: string | null;
  placements: TowBoardPlacement[];
  tows: TowBoardTow[];
};

export type TowBoardHangar = { id: string; label: string };

export type TowBoardRow = {
  eventId: string;
  title: string;
  status: string;
  startMsk: string;
  endMsk: string;
  hangarNumber: string;
  hangars: TowBoardHangar[];
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
  operatorId: string;
  operator: string;
  standLabel: string;
  locked: boolean;
  towCount: number;
  pendingEdges: TowBoardEdgeRole[];
  pending: TowBoardPending[];
  placements: TowBoardPlacementView[];
  tows: TowBoardTowView[];
  startAt: string;
  endAt: string;
  minutes: number | null;
  actionLabel: string;
  edgeNote: string;
  existingTows: string[];
};

function text(v: string | null | undefined): string {
  return String(v ?? "").trim();
}

function hangarLabel(name: string | null, code: string | null, id: string): string {
  return text(name) || text(code) || id;
}

export function edgeActionLabel(minutes: number, pending: TowBoardEdgeRole[]): string {
  if (!pending.length || minutes < 1) return "";
  const inbound = pending.some((role) => role === "event-in" || role === "gap-in");
  const outbound = pending.some((role) => role === "event-out" || role === "gap-out");
  const gap = pending.some((role) => role === "gap-in" || role === "gap-out");
  const side = inbound && outbound ? "Закатка и выкатка" : inbound ? "Закатка" : outbound ? "Выкатка" : "Края";
  return `${side}${gap ? ", включая разрыв" : ""}, ${minutes} мин`;
}

function uniqueRoles(roles: TowBoardEdgeRole[]): TowBoardEdgeRole[] {
  const seen = new Set<TowBoardEdgeRole>();
  const out: TowBoardEdgeRole[] = [];
  for (const role of roles) {
    if (seen.has(role)) continue;
    seen.add(role);
    out.push(role);
  }
  return out;
}

function towLine(tow: TowBoardTow): string {
  const direction = towDirectionLabel(directionFromTowLabels(tow.fromLabel, tow.toLabel) ?? "UNKNOWN");
  const name = direction || "Буксировка";
  return `${name} ${formatMskDateTime(tow.startAt)} — ${formatMskDateTime(tow.endAt)}`;
}

export function buildTowBoardRow(input: TowBoardInput, minutes: number | null): TowBoardRow {
  const hangars: TowBoardHangar[] = [];
  const seenHangars = new Set<string>();
  const pushHangar = (id: string | null, name: string | null, code: string | null) => {
    const hangarId = text(id);
    if (!hangarId || seenHangars.has(hangarId)) return;
    seenHangars.add(hangarId);
    hangars.push({ id: hangarId, label: hangarLabel(name, code, hangarId) });
  };
  pushHangar(input.hangarId, input.hangarName, input.hangarCode);
  for (const placement of input.placements) {
    pushHangar(placement.hangarId, placement.hangarName, placement.hangarCode);
  }

  const manuals = input.placements.filter((placement) => placement.origin !== "AUTO_GAP");
  const firstStand = text(manuals[0]?.standCode);
  const lastStand = text(manuals[manuals.length - 1]?.standCode);
  const standLabel = firstStand && lastStand && firstStand !== lastStand ? `${firstStand} → ${lastStand}` : firstStand || lastStand;

  const normMinutes = minutes != null && minutes > 0 ? minutes : null;
  let pendingEdges: TowBoardEdgeRole[] = [];
  let pending: TowBoardPending[] = [];
  let actionLabel = "";
  let edgeNote = "";
  if (normMinutes == null) {
    edgeNote = "Не задан норматив буксировки";
  } else {
    const plan = planEdgeTows({
      minutes: normMinutes,
      placements: input.placements.map((placement) => ({
        id: placement.id,
        origin: placement.origin,
        startAt: placement.startAt,
        endAt: placement.endAt,
        standCode: placement.standCode
      })),
      existing: input.tows.map((tow) => ({ startAt: tow.startAt, endAt: tow.endAt }))
    });
    pending = plan.create.map((tow) => ({
      role: tow.role,
      startAt: tow.startAt.toISOString(),
      endAt: tow.endAt.toISOString(),
      placementId: tow.placementId,
      fromLabel: tow.fromLabel,
      toLabel: tow.toLabel
    }));
    pendingEdges = uniqueRoles(pending.map((tow) => tow.role));
    actionLabel = edgeActionLabel(normMinutes, pendingEdges);
    if (!actionLabel) {
      edgeNote = plan.skipped.length
        ? plan.skipped.map((item) => `${item.label}: ${item.reason}`).join("; ")
        : "Края уже заняты";
    }
  }

  const placementViews: TowBoardPlacementView[] = input.placements.map((placement) => ({
    id: placement.id,
    origin: placement.origin,
    startAt: placement.startAt.toISOString(),
    endAt: placement.endAt.toISOString(),
    hangarId: text(placement.hangarId),
    hangarLabel: hangarLabel(placement.hangarName, placement.hangarCode, text(placement.hangarId)),
    standCode: text(placement.standCode)
  }));
  const towViews: TowBoardTowView[] = input.tows.map((tow) => {
    const direction = directionFromTowLabels(tow.fromLabel, tow.toLabel) ?? "UNKNOWN";
    return {
      id: text(tow.id),
      placementId: text(tow.placementId),
      startAt: tow.startAt.toISOString(),
      endAt: tow.endAt.toISOString(),
      fromLabel: text(tow.fromLabel),
      toLabel: text(tow.toLabel),
      direction,
      directionLabel: towDirectionLabel(direction),
      occupancyEndAt: tow.occupancyEndAt ? tow.occupancyEndAt.toISOString() : "",
      startChangeReason: text(tow.startChangeReason)
    };
  });

  const existingTows = input.tows.slice(0, 6).map(towLine);
  if (input.tows.length > existingTows.length) {
    existingTows.push(`ещё ${input.tows.length - 6}`);
  }

  return {
    eventId: input.id,
    title: text(input.title),
    status: input.status,
    startAt: input.startAt.toISOString(),
    endAt: input.endAt.toISOString(),
    minutes: normMinutes,
    startMsk: formatMskDateTime(input.startAt),
    endMsk: formatMskDateTime(input.endAt),
    hangarNumber: hangars[0]?.label ?? "",
    hangars,
    aircraftTypeId: text(input.aircraftTypeId),
    aircraftType: text(input.aircraftType),
    aircraftId: text(input.aircraftId) || (input.virtual ? `virt:${input.id}` : ""),
    tailNumber: text(input.tailNumber) || (input.virtual ? virtualAircraftDisplayLabel() : ""),
    operatorId: text(input.operatorId),
    operator: text(input.operator),
    standLabel,
    locked: isDoneScheduleLocked(input.status),
    towCount: input.tows.length,
    pendingEdges,
    pending,
    placements: placementViews,
    tows: towViews,
    actionLabel,
    edgeNote,
    existingTows
  };
}
