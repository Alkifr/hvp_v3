import { planEdgeTows, selectPlannedEdges, towPlacementRelation, type PlannedEdgeTow } from "./edgeTows.js";
import { isDoneScheduleLocked } from "./eventStatus.js";
import { formatMskDateTime, TOW_EXPORT_COLUMNS } from "./towReport.js";
import { virtualAircraftDisplayLabel } from "./virtualAircraft.js";

export type RegistryEdgeRole = "event-in" | "event-out";
export type RegistryEdgeState = "assigned" | "waived" | "empty";
export type RegistryMark = "same" | "new" | "changed" | "removed";

export type RegistryPlacement = {
  id: string;
  origin: "MANUAL" | "AUTO_GAP";
  startAt: Date;
  endAt: Date;
  hangarId: string | null;
  hangarName: string | null;
  hangarCode: string | null;
  standCode: string | null;
};

export type RegistryTow = {
  id: string;
  placementId: string | null;
  startAt: Date;
  endAt: Date;
  fromLabel: string | null;
  toLabel: string | null;
};

export type RegistryEventInput = {
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
  placements: RegistryPlacement[];
  tows: RegistryTow[];
  waivedRoles: RegistryEdgeRole[];
  createdAt?: Date;
};

export type TowRegistryEdgeView = {
  role: RegistryEdgeRole;
  state: RegistryEdgeState;
  towId: string;
  placementId: string;
  fromStand: string;
  toStand: string;
  startAt: string;
  endAt: string;
  startMsk: string;
  endMsk: string;
  planStartAt: string;
  planEndAt: string;
  planFrom: string;
  planTo: string;
  note: string;
};

export type TowRegistryHangar = { id: string; label: string };

export const TOW_REGISTRY_COLUMNS = [
  { key: "seq", title: "Строка" },
  { key: "hangarNumber", title: "Ангар" },
  { key: "aircraftType", title: "Тип ВС" },
  { key: "tailNumber", title: "Бортовой номер" },
  { key: "operator", title: "Оператор" },
  { key: "eventTitle", title: "Событие" },
  { key: "eventStartMsk", title: "Начало события (мск)" },
  { key: "eventEndMsk", title: "Окончание события (мск)" },
  { key: "inMark", title: "Закатка" },
  { key: "inFrom", title: "Закатка откуда" },
  { key: "inTo", title: "Закатка куда" },
  { key: "inStartMsk", title: "Закатка начало (мск)" },
  { key: "inEndMsk", title: "Закатка окончание (мск)" },
  { key: "outMark", title: "Выкатка" },
  { key: "outFrom", title: "Выкатка откуда" },
  { key: "outTo", title: "Выкатка куда" },
  { key: "outStartMsk", title: "Выкатка начало (мск)" },
  { key: "outEndMsk", title: "Выкатка окончание (мск)" },
  { key: "changeMark", title: "Отличие от отправки" }
] as const;

export type TowRegistryColumnKey = (typeof TOW_REGISTRY_COLUMNS)[number]["key"];

export const TOW_REGISTRY_COMPARE_KEYS = TOW_REGISTRY_COLUMNS.map((column) => column.key).filter(
  (key): key is Exclude<TowRegistryColumnKey, "seq" | "changeMark"> => key !== "seq" && key !== "changeMark"
);

export type TowRegistrySnapshotRow = {
  eventId: string;
  hangarId: string;
  operatorId: string;
  aircraftTypeId: string;
  aircraftId: string;
  seq: string;
  hangarNumber: string;
  aircraftType: string;
  tailNumber: string;
  operator: string;
  eventTitle: string;
  eventStartMsk: string;
  eventEndMsk: string;
  inMark: string;
  inFrom: string;
  inTo: string;
  inStartMsk: string;
  inEndMsk: string;
  outMark: string;
  outFrom: string;
  outTo: string;
  outStartMsk: string;
  outEndMsk: string;
  changeMark: string;
};

export type TowRegistryRow = {
  eventId: string;
  seq: number;
  title: string;
  status: string;
  locked: boolean;
  hangarId: string;
  hangarNumber: string;
  hangars: TowRegistryHangar[];
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
  operatorId: string;
  operator: string;
  eventStartAt: string;
  eventEndAt: string;
  eventStartMsk: string;
  eventEndMsk: string;
  createdAt: string;
  inEdge: TowRegistryEdgeView;
  outEdge: TowRegistryEdgeView;
  mark: RegistryMark;
  changedFields: string[];
  export: TowRegistrySnapshotRow;
};

export type RegistrySendRef = {
  sentAt: string;
  fromAt: string;
  toAt: string;
  rows: TowRegistrySnapshotRow[];
};

export type TowRegistryFieldDiff = {
  key: string;
  title: string;
  before: string;
  after: string;
};

export type TowRegistryCompare = {
  added: TowRegistrySnapshotRow[];
  removed: TowRegistrySnapshotRow[];
  changed: Array<{ eventId: string; tailNumber: string; fields: TowRegistryFieldDiff[] }>;
};

const IN_FIELDS = ["inMark", "inFrom", "inTo", "inStartMsk", "inEndMsk"] as const;
const OUT_FIELDS = ["outMark", "outFrom", "outTo", "outStartMsk", "outEndMsk"] as const;

export function eventIntersectsWindow(startAt: Date, endAt: Date, from: Date, to: Date): boolean {
  return startAt.getTime() < to.getTime() && endAt.getTime() > from.getTime();
}

export function plannedEdgeCreates(params: {
  minutes: number;
  placements: Array<{
    id: string;
    origin: "MANUAL" | "AUTO_GAP";
    startAt: Date;
    endAt: Date;
    standCode: string | null;
  }>;
  existing: Array<{ startAt: Date; endAt: Date }>;
  waivedRoles?: RegistryEdgeRole[];
}): PlannedEdgeTow[] {
  const plan = planEdgeTows({
    minutes: params.minutes,
    placements: params.placements,
    existing: params.existing
  });
  const waived = new Set(params.waivedRoles ?? []);
  return selectPlannedEdges(plan).filter((tow) => {
    if (tow.role !== "event-in" && tow.role !== "event-out") return true;
    return !waived.has(tow.role);
  });
}

export function coveredEdgeRole(
  tow: { startAt: Date; endAt: Date },
  placements: Array<{ id: string; origin: "MANUAL" | "AUTO_GAP"; startAt: Date; endAt: Date }>
): RegistryEdgeRole | null {
  const manuals = placements.filter((placement) => placement.origin !== "AUTO_GAP");
  const first = manuals[0];
  const last = manuals[manuals.length - 1];
  if (first && towPlacementRelation(tow, first) === "in") return "event-in";
  if (last && towPlacementRelation(tow, last) === "out") return "event-out";
  return null;
}

export function towChangeRows(params: {
  eventId: string;
  towId?: string | null;
  sandboxId?: string | null;
  actor: string;
  reason?: string | null;
  pairs: Array<{ field: string; before: string; after: string }>;
}) {
  return params.pairs
    .filter((pair) => pair.before !== pair.after)
    .map((pair) => ({
      eventId: params.eventId,
      towId: params.towId ?? null,
      sandboxId: params.sandboxId ?? null,
      actor: params.actor,
      field: pair.field,
      before: pair.before,
      after: pair.after,
      reason: params.reason ?? null
    }));
}

function text(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function hangarLabel(name: string | null, code: string | null, id: string): string {
  return text(name) || text(code) || id;
}

function edgeMark(state: RegistryEdgeState): string {
  if (state === "assigned") return "назначена";
  if (state === "waived") return "не требуется";
  return "не назначена";
}

function columnTitle(key: string): string {
  return TOW_REGISTRY_COLUMNS.find((column) => column.key === key)?.title ?? key;
}

function blankEdge(
  role: RegistryEdgeRole,
  state: RegistryEdgeState,
  placementId: string,
  note: string,
  plan?: PlannedEdgeTow
): TowRegistryEdgeView {
  return {
    role,
    state,
    towId: "",
    placementId,
    fromStand: "",
    toStand: "",
    startAt: "",
    endAt: "",
    startMsk: "",
    endMsk: "",
    planStartAt: plan ? plan.startAt.toISOString() : "",
    planEndAt: plan ? plan.endAt.toISOString() : "",
    planFrom: plan ? text(plan.fromLabel) : "",
    planTo: plan ? text(plan.toLabel) : "",
    note
  };
}

function matchTow(role: RegistryEdgeRole, placement: RegistryPlacement, tows: RegistryTow[]): RegistryTow | null {
  const relation = role === "event-in" ? "in" : "out";
  const hits = tows.filter((tow) => towPlacementRelation(tow, placement) === relation);
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const distance = (tow: RegistryTow) =>
      role === "event-in"
        ? Math.abs(tow.startAt.getTime() - placement.startAt.getTime())
        : Math.abs(tow.endAt.getTime() - placement.endAt.getTime());
    return distance(a) - distance(b);
  });
  return hits[0] ?? null;
}

function buildEdge(
  role: RegistryEdgeRole,
  manuals: RegistryPlacement[],
  tows: RegistryTow[],
  waived: Set<RegistryEdgeRole>,
  pending: PlannedEdgeTow | undefined,
  skippedReason: string,
  minutes: number | null
): TowRegistryEdgeView {
  const placement = role === "event-in" ? manuals[0] : manuals[manuals.length - 1];
  if (!placement) {
    return blankEdge(role, waived.has(role) ? "waived" : "empty", "", skippedReason || "нет ручного этапа размещения");
  }
  const matched = matchTow(role, placement, tows);
  if (matched) {
    return {
      role,
      state: "assigned",
      towId: matched.id,
      placementId: placement.id,
      fromStand: text(matched.fromLabel),
      toStand: text(matched.toLabel),
      startAt: matched.startAt.toISOString(),
      endAt: matched.endAt.toISOString(),
      startMsk: formatMskDateTime(matched.startAt),
      endMsk: formatMskDateTime(matched.endAt),
      planStartAt: pending ? pending.startAt.toISOString() : matched.startAt.toISOString(),
      planEndAt: pending ? pending.endAt.toISOString() : matched.endAt.toISOString(),
      planFrom: pending ? text(pending.fromLabel) : text(matched.fromLabel),
      planTo: pending ? text(pending.toLabel) : text(matched.toLabel),
      note: ""
    };
  }
  const state: RegistryEdgeState = waived.has(role) ? "waived" : "empty";
  const note =
    state === "waived"
      ? ""
      : pending
        ? `Норматив ${minutes ?? ""} мин: ${text(pending.fromLabel)} → ${text(pending.toLabel)}, ${formatMskDateTime(pending.startAt)}–${formatMskDateTime(pending.endAt)}`
        : skippedReason || (minutes == null ? "Не задан норматив буксировки" : "");
  return blankEdge(role, state, placement.id, note, pending);
}

export function snapshotFromRow(row: Pick<
  TowRegistryRow,
  | "eventId"
  | "hangarId"
  | "operatorId"
  | "aircraftTypeId"
  | "aircraftId"
  | "hangarNumber"
  | "aircraftType"
  | "tailNumber"
  | "operator"
  | "title"
  | "eventStartMsk"
  | "eventEndMsk"
  | "inEdge"
  | "outEdge"
> & { seq?: number; changeMark?: string }): TowRegistrySnapshotRow {
  return {
    eventId: row.eventId,
    hangarId: row.hangarId,
    operatorId: row.operatorId,
    aircraftTypeId: row.aircraftTypeId,
    aircraftId: row.aircraftId,
    seq: row.seq == null ? "" : String(row.seq),
    hangarNumber: row.hangarNumber,
    aircraftType: row.aircraftType,
    tailNumber: row.tailNumber,
    operator: row.operator,
    eventTitle: row.title,
    eventStartMsk: row.eventStartMsk,
    eventEndMsk: row.eventEndMsk,
    inMark: edgeMark(row.inEdge.state),
    inFrom: row.inEdge.state === "assigned" ? row.inEdge.fromStand : "",
    inTo: row.inEdge.state === "assigned" ? row.inEdge.toStand : "",
    inStartMsk: row.inEdge.state === "assigned" ? row.inEdge.startMsk : "",
    inEndMsk: row.inEdge.state === "assigned" ? row.inEdge.endMsk : "",
    outMark: edgeMark(row.outEdge.state),
    outFrom: row.outEdge.state === "assigned" ? row.outEdge.fromStand : "",
    outTo: row.outEdge.state === "assigned" ? row.outEdge.toStand : "",
    outStartMsk: row.outEdge.state === "assigned" ? row.outEdge.startMsk : "",
    outEndMsk: row.outEdge.state === "assigned" ? row.outEdge.endMsk : "",
    changeMark: row.changeMark ?? ""
  };
}

export function readRegistrySnapshot(value: unknown): TowRegistrySnapshotRow[] {
  if (!Array.isArray(value)) return [];
  const rows: TowRegistrySnapshotRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const eventId = text(typeof row.eventId === "string" ? row.eventId : "");
    if (!eventId) continue;
    const cell = (key: keyof TowRegistrySnapshotRow) => text(typeof row[key] === "string" || typeof row[key] === "number" ? String(row[key]) : "");
    rows.push({
      eventId,
      hangarId: cell("hangarId"),
      operatorId: cell("operatorId"),
      aircraftTypeId: cell("aircraftTypeId"),
      aircraftId: cell("aircraftId"),
      seq: cell("seq"),
      hangarNumber: cell("hangarNumber"),
      aircraftType: cell("aircraftType"),
      tailNumber: cell("tailNumber"),
      operator: cell("operator"),
      eventTitle: cell("eventTitle"),
      eventStartMsk: cell("eventStartMsk"),
      eventEndMsk: cell("eventEndMsk"),
      inMark: cell("inMark"),
      inFrom: cell("inFrom"),
      inTo: cell("inTo"),
      inStartMsk: cell("inStartMsk"),
      inEndMsk: cell("inEndMsk"),
      outMark: cell("outMark"),
      outFrom: cell("outFrom"),
      outTo: cell("outTo"),
      outStartMsk: cell("outStartMsk"),
      outEndMsk: cell("outEndMsk"),
      changeMark: cell("changeMark")
    });
  }
  return rows;
}

function diffKeys(previous: TowRegistrySnapshotRow, current: TowRegistrySnapshotRow): string[] {
  return TOW_REGISTRY_COMPARE_KEYS.filter((key) => previous[key] !== current[key]);
}

function paint(row: TowRegistryRow, mark: RegistryMark, changedFields: string[], changeMark: string): TowRegistryRow {
  const exportRow = snapshotFromRow({ ...row, changeMark });
  return { ...row, mark, changedFields, export: exportRow };
}

function removedRow(snapshot: TowRegistrySnapshotRow, seq: number): TowRegistryRow {
  const edge = (role: RegistryEdgeRole, mark: string, from: string, to: string, start: string, end: string): TowRegistryEdgeView => ({
    role,
    state: mark === "не требуется" ? "waived" : mark === "назначена" ? "assigned" : "empty",
    towId: "",
    placementId: "",
    fromStand: from,
    toStand: to,
    startAt: "",
    endAt: "",
    startMsk: start,
    endMsk: end,
    planStartAt: "",
    planEndAt: "",
    planFrom: from,
    planTo: to,
    note: ""
  });
  const base: TowRegistryRow = {
    eventId: snapshot.eventId,
    seq,
    title: snapshot.eventTitle,
    status: "",
    locked: true,
    hangarId: snapshot.hangarId,
    hangarNumber: snapshot.hangarNumber,
    hangars: snapshot.hangarId ? [{ id: snapshot.hangarId, label: snapshot.hangarNumber || snapshot.hangarId }] : [],
    aircraftTypeId: snapshot.aircraftTypeId,
    aircraftType: snapshot.aircraftType,
    aircraftId: snapshot.aircraftId,
    tailNumber: snapshot.tailNumber,
    operatorId: snapshot.operatorId,
    operator: snapshot.operator,
    eventStartAt: "",
    eventEndAt: "",
    createdAt: "",
    eventStartMsk: snapshot.eventStartMsk,
    eventEndMsk: snapshot.eventEndMsk,
    inEdge: edge("event-in", snapshot.inMark, snapshot.inFrom, snapshot.inTo, snapshot.inStartMsk, snapshot.inEndMsk),
    outEdge: edge("event-out", snapshot.outMark, snapshot.outFrom, snapshot.outTo, snapshot.outStartMsk, snapshot.outEndMsk),
    mark: "removed",
    changedFields: [...TOW_REGISTRY_COMPARE_KEYS],
    export: { ...snapshot, seq: String(seq), changeMark: "снята" }
  };
  return base;
}

export function buildRegistryRows(events: RegistryEventInput[], minutes: number | null): TowRegistryRow[] {
  return events.map((event, index) => {
    const hangars: TowRegistryHangar[] = [];
    const seen = new Set<string>();
    const pushHangar = (id: string | null, name: string | null, code: string | null) => {
      const hangarId = text(id);
      if (!hangarId || seen.has(hangarId)) return;
      seen.add(hangarId);
      hangars.push({ id: hangarId, label: hangarLabel(name, code, hangarId) });
    };
    pushHangar(event.hangarId, event.hangarName, event.hangarCode);
    for (const placement of event.placements) pushHangar(placement.hangarId, placement.hangarName, placement.hangarCode);

    const manuals = event.placements.filter((placement) => placement.origin !== "AUTO_GAP");
    const waived = new Set(event.waivedRoles);
    const norm = minutes != null && minutes > 0 ? minutes : null;
    const plan = norm
      ? planEdgeTows({
          minutes: norm,
          placements: event.placements.map((placement) => ({
            id: placement.id,
            origin: placement.origin,
            startAt: placement.startAt,
            endAt: placement.endAt,
            standCode: placement.standCode
          })),
          existing: event.tows.map((tow) => ({ startAt: tow.startAt, endAt: tow.endAt }))
        })
      : null;
    const skippedReason = plan?.skipped.map((item) => `${item.label}: ${item.reason}`).join("; ") ?? "";
    const rowBase = {
      eventId: event.id,
      seq: index + 1,
      title: text(event.title),
      status: event.status,
      locked: isDoneScheduleLocked(event.status),
      hangarId: hangars[0]?.id ?? "",
      hangarNumber: hangars[0]?.label ?? "",
      hangars,
      aircraftTypeId: text(event.aircraftTypeId),
      aircraftType: text(event.aircraftType),
      aircraftId: text(event.aircraftId) || (event.virtual ? `virt:${event.id}` : ""),
      tailNumber: text(event.tailNumber) || (event.virtual ? virtualAircraftDisplayLabel() : ""),
      operatorId: text(event.operatorId),
      operator: text(event.operator),
      eventStartAt: event.startAt.toISOString(),
      eventEndAt: event.endAt.toISOString(),
      createdAt: (event.createdAt ?? event.startAt).toISOString(),
      eventStartMsk: formatMskDateTime(event.startAt),
      eventEndMsk: formatMskDateTime(event.endAt),
      inEdge: buildEdge(
        "event-in",
        manuals,
        event.tows,
        waived,
        plan?.create.find((tow) => tow.role === "event-in"),
        skippedReason,
        norm
      ),
      outEdge: buildEdge(
        "event-out",
        manuals,
        event.tows,
        waived,
        plan?.create.find((tow) => tow.role === "event-out"),
        skippedReason,
        norm
      ),
      mark: "same" as const,
      changedFields: [] as string[]
    };
    return { ...rowBase, export: snapshotFromRow(rowBase) };
  });
}

export function markRegistryRows(
  rows: TowRegistryRow[],
  history: RegistrySendRef[],
  window: { from: string; to: string }
): { items: TowRegistryRow[]; removed: TowRegistryRow[] } {
  const sorted = [...history].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const items = rows.map((row) => {
    const previous = [...sorted].reverse().find((send) => send.rows.some((item) => item.eventId === row.eventId));
    if (!previous) return paint(row, "new", [], "новая строка");
    const snap = previous.rows.find((item) => item.eventId === row.eventId)!;
    const changedFields = diffKeys(snap, snapshotFromRow(row));
    const changeMark = changedFields.map(columnTitle).join(", ");
    return paint(row, changedFields.length ? "changed" : "same", changedFields, changeMark);
  });
  const numbered = items.map((row, index) => paint(row, row.mark, row.changedFields, row.export.changeMark));
  numbered.forEach((row, index) => {
    row.seq = index + 1;
    row.export = { ...row.export, seq: String(index + 1) };
  });
  const windowSends = sorted.filter((send) => send.fromAt === window.from && send.toAt === window.to);
  const last = windowSends[windowSends.length - 1];
  const present = new Set(rows.map((row) => row.eventId));
  const removed = last
    ? last.rows.filter((snap) => !present.has(snap.eventId)).map((snap, index) => removedRow(snap, numbered.length + index + 1))
    : [];
  return { items: numbered, removed };
}

export function registryMatchesFilters(
  row: Pick<TowRegistryRow, "hangarId" | "hangars" | "operatorId" | "aircraftTypeId" | "aircraftId">,
  filters: { hangarIds?: string[]; operatorIds?: string[]; aircraftTypeIds?: string[]; aircraftIds?: string[] }
): boolean {
  if (filters.hangarIds?.length) {
    const ids = row.hangars.length ? row.hangars.map((hangar) => hangar.id) : row.hangarId ? [row.hangarId] : [];
    if (!ids.some((id) => filters.hangarIds!.includes(id))) return false;
  }
  if (filters.operatorIds?.length && !filters.operatorIds.includes(row.operatorId)) return false;
  if (filters.aircraftTypeIds?.length && !filters.aircraftTypeIds.includes(row.aircraftTypeId)) return false;
  if (filters.aircraftIds?.length && !filters.aircraftIds.includes(row.aircraftId)) return false;
  return true;
}

export function compareRegistrySnapshots(left: TowRegistrySnapshotRow[], right: TowRegistrySnapshotRow[]): TowRegistryCompare {
  const leftById = new Map(left.map((row) => [row.eventId, row]));
  const rightById = new Map(right.map((row) => [row.eventId, row]));
  const added = right.filter((row) => !leftById.has(row.eventId));
  const removed = left.filter((row) => !rightById.has(row.eventId));
  const changed: TowRegistryCompare["changed"] = [];
  for (const row of right) {
    const previous = leftById.get(row.eventId);
    if (!previous) continue;
    const fields = TOW_REGISTRY_COMPARE_KEYS.filter((key) => previous[key] !== row[key]).map((key) => ({
      key,
      title: columnTitle(key),
      before: previous[key],
      after: row[key]
    }));
    if (fields.length) changed.push({ eventId: row.eventId, tailNumber: row.tailNumber, fields });
  }
  return { added, removed, changed };
}

export function readSendRows(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  const rows: Array<Record<string, string>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const row: Record<string, string> = {};
    for (const [key, cell] of Object.entries(source)) {
      if (typeof cell === "string" || typeof cell === "number") row[key] = String(cell);
    }
    if (!row.id && !row.eventId) continue;
    rows.push(row);
  }
  return rows;
}

export function compareSentRows(leftRaw: unknown, rightRaw: unknown): TowRegistryCompare {
  const leftRows = readSendRows(leftRaw);
  const rightRows = readSendRows(rightRaw);
  const eventShape = [...leftRows, ...rightRows].some((row) => "inMark" in row && !row.id);
  if (eventShape) return compareRegistrySnapshots(readRegistrySnapshot(leftRaw), readRegistrySnapshot(rightRaw));
  const titles = new Map(TOW_EXPORT_COLUMNS.map((column) => [column.key, column.title]));
  const keys = TOW_EXPORT_COLUMNS.map((column) => column.key).filter((key) => key !== "seq");
  const idOf = (row: Record<string, string>) => row.id || row.eventId;
  const leftById = new Map(leftRows.map((row) => [idOf(row), row]));
  const rightById = new Map(rightRows.map((row) => [idOf(row), row]));
  const asSnap = (row: Record<string, string>): TowRegistrySnapshotRow => ({
    eventId: row.eventId || row.id || "",
    hangarId: "",
    operatorId: "",
    aircraftTypeId: "",
    aircraftId: "",
    seq: row.seq ?? "",
    hangarNumber: row.hangarNumber ?? "",
    aircraftType: row.aircraftType ?? "",
    tailNumber: row.tailNumber ?? "",
    operator: row.operator ?? "",
    eventTitle: row.eventTitle || "",
    eventStartMsk: row.plannedStartMsk ?? "",
    eventEndMsk: "",
    inMark: "",
    inFrom: "",
    inTo: "",
    inStartMsk: "",
    inEndMsk: "",
    outMark: "",
    outFrom: "",
    outTo: "",
    outStartMsk: "",
    outEndMsk: "",
    changeMark: ""
  });
  const changed: TowRegistryCompare["changed"] = [];
  for (const row of rightRows) {
    const previous = leftById.get(idOf(row));
    if (!previous) continue;
    const fields = keys
      .filter((key) => (previous[key] ?? "") !== (row[key] ?? ""))
      .map((key) => ({
        key,
        title: titles.get(key as (typeof TOW_EXPORT_COLUMNS)[number]["key"]) ?? key,
        before: previous[key] ?? "",
        after: row[key] ?? ""
      }));
    if (fields.length) changed.push({ eventId: row.eventId || row.id || "", tailNumber: row.tailNumber ?? "", fields });
  }
  return {
    added: rightRows.filter((row) => !leftById.has(idOf(row))).map(asSnap),
    removed: leftRows.filter((row) => !rightById.has(idOf(row))).map(asSnap),
    changed
  };
}

export function registryEdgeFields(role: RegistryEdgeRole): readonly string[] {
  return role === "event-in" ? IN_FIELDS : OUT_FIELDS;
}

export function registryPeriodLabel(from: Date, to: Date): string {
  return `${formatMskDateTime(from)} – ${formatMskDateTime(to)}`;
}
