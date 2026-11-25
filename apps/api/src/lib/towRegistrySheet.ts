import type { TowPlanRow } from "./towPlan.js";
import { registryNoteText, registryPositionText } from "./towRegistryNote.js";
import { formatMskDateTime, TOW_EXPORT_COLUMNS, type TowReportRow } from "./towReport.js";

export const REGISTRY_ADDED = "Добавлено";
export const REGISTRY_UPDATED = "Обновлено";
export const REGISTRY_REMOVED = "Удалено";

export type RegistryMailRow = TowReportRow & { changeStatus?: string };

const COMPARE_KEYS = [
  "hangarNumber",
  "aircraftType",
  "tailNumber",
  "operator",
  "fromStand",
  "toStand",
  "plannedStartMsk",
  "standOccupancy",
  "notes",
  "toSlotDuration",
  "positionComment",
  "startChangeReason"
] as const satisfies ReadonlyArray<keyof TowReportRow | "hangarNumber">;

const COLUMN_TITLE = new Map<string, string>([
  ["hangarNumber", "Ангар"],
  ...TOW_EXPORT_COLUMNS.map((column) => [column.key, column.title] as const)
]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function placeholder(row: TowPlanRow): TowReportRow {
  const id = `plan:${row.eventId}`;
  const notes = registryNoteText({
    id,
    notes: row.registryNotes,
    hangarNumber: row.hangarNumber,
    fromStand: row.fromStand,
    toStand: row.toStand,
    eventType: row.eventType,
    eventTitle: row.eventTitle,
    parkedStand: row.parkedStand,
    plannedStartAt: row.towStartAt || null
  });
  const slot = row.eventEndMsk || "";
  return {
    id,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    eventStatus: "",
    eventTypeId: "",
    eventType: row.eventType,
    seq: 0,
    direction: "UNKNOWN",
    directionLabel: "",
    towDurationMinutes: null,
    hangarId: row.hangarId,
    hangarNumber: row.hangarNumber,
    aircraftTypeId: row.aircraftTypeId,
    aircraftType: row.aircraftType,
    aircraftId: row.aircraftId,
    tailNumber: row.tailNumber,
    operatorId: row.operatorId,
    operator: row.operator,
    fromStand: row.fromStand,
    toStand: row.toStand,
    plannedStartAt: row.towStartAt,
    plannedStartMsk: row.towStartAt ? formatMskDateTime(new Date(row.towStartAt)) : "",
    plannedEndAt: row.towEndAt,
    plannedEndMsk: row.towEndAt ? formatMskDateTime(new Date(row.towEndAt)) : "",
    occupancyEndAt: "",
    occupancyEndMsk: "",
    inferredOccupancyEndAt: row.towId ? row.eventEndAt : "",
    standOccupancy: row.towId ? row.standOccupancy : "",
    standOccupancyMinutes: null,
    notes,
    toSlotEndAt: row.eventEndAt,
    toSlotEndMsk: slot,
    toSlotDuration: slot ? `Слот до ${slot} мск` : "",
    toSlotMinutes: null,
    positionComment: registryPositionText(row.registryPosition, ""),
    startChangeReason: row.registryStartReason,
    fromLabel: row.fromStand,
    toLabel: row.toStand,
    placementId: row.placementId
  };
}

function applyPlan(base: TowReportRow, plan: TowPlanRow): TowReportRow {
  const notes = registryNoteText({
    id: base.id,
    notes: base.notes,
    hangarNumber: plan.hangarNumber || base.hangarNumber,
    fromStand: base.fromStand,
    toStand: base.toStand,
    direction: base.direction,
    directionLabel: base.directionLabel,
    eventType: base.eventType || plan.eventType,
    eventTitle: base.eventTitle || plan.eventTitle,
    parkedStand: plan.parkedStand,
    plannedStartAt: base.plannedStartAt
  });
  return {
    ...base,
    hangarNumber: plan.hangarNumber || base.hangarNumber,
    eventType: base.eventType || plan.eventType,
    notes,
    positionComment: registryPositionText(plan.registryPosition, base.positionComment),
    startChangeReason: base.startChangeReason || plan.registryStartReason
  };
}

/** Строки реестра как на экране: события плана, кроме «Не требуется», с автопримечанием и позицией. */
export function composeRegistrySheet(plan: TowPlanRow[], report: TowReportRow[]): TowReportRow[] {
  const skipped = new Set(plan.filter((row) => row.skipped).map((row) => row.eventId));
  const visibleReport = report.filter((row) => !skipped.has(row.eventId));
  const byTow = new Map(visibleReport.map((row) => [row.id, row]));
  const eventsWithReport = new Set(visibleReport.map((row) => row.eventId));
  const out: TowReportRow[] = [];
  const blankSeen = new Set<string>();
  for (const row of plan) {
    if (skipped.has(row.eventId)) continue;
    if (row.towId) {
      out.push(applyPlan(byTow.get(row.towId) ?? placeholder(row), row));
      continue;
    }
    if (eventsWithReport.has(row.eventId) || blankSeen.has(row.eventId)) continue;
    blankSeen.add(row.eventId);
    out.push(applyPlan(placeholder(row), row));
  }
  return out.map((row, index) => ({ ...row, seq: index + 1 }));
}

function rowId(row: { id?: unknown; eventId?: unknown }): string {
  return text(row.id) || text(row.eventId);
}

function clip(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "—";
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}

function changedFields(before: Record<string, unknown>, row: TowReportRow): string[] {
  const lines: string[] = [];
  for (const key of COMPARE_KEYS) {
    const from = text(before[key]);
    const to = text(row[key]);
    if (from === to) continue;
    lines.push(`${COLUMN_TITLE.get(key) ?? key}: «${clip(from)}» → «${clip(to)}»`);
  }
  return lines;
}

function eventLabel(row: Record<string, unknown>): string {
  const tail = text(row.tailNumber) || "борт";
  const title = text(row.eventTitle);
  return title && title !== tail ? `${tail} · ${title}` : tail;
}

function eventSignature(row: Record<string, unknown>): string {
  const id = text(row.id) || text(row.eventId);
  return `${id}\u001e${COMPARE_KEYS.map((key) => text(row[key])).join("\u001f")}`;
}

function eventGroups(rows: Array<Record<string, unknown>>): Map<string, { label: string; sig: string }> {
  const grouped = new Map<string, { label: string; parts: string[] }>();
  for (const row of rows) {
    const id = text(row.eventId) || text(row.id);
    if (!id) continue;
    const current = grouped.get(id);
    if (current) current.parts.push(eventSignature(row));
    else grouped.set(id, { label: eventLabel(row), parts: [eventSignature(row)] });
  }
  const out = new Map<string, { label: string; sig: string }>();
  for (const [id, group] of grouped) out.set(id, { label: group.label, sig: group.parts.sort().join("\u001d") });
  return out;
}

function asRecords(rows: Array<Record<string, unknown> | TowReportRow> | null): Array<Record<string, unknown>> {
  return (rows ?? []).map((row) => row as Record<string, unknown>);
}

function towLine(row: Record<string, unknown>): string {
  const tail = text(row.tailNumber) || "борт";
  const route = [text(row.fromStand), text(row.toStand)].filter(Boolean).join(" → ");
  return [tail, route, text(row.plannedStartMsk)].filter(Boolean).join(", ");
}

function snapshotMailRow(row: Record<string, unknown>): RegistryMailRow {
  const id = rowId(row);
  return {
    id,
    eventId: text(row.eventId) || id,
    eventTitle: text(row.eventTitle),
    eventStatus: "",
    eventTypeId: "",
    eventType: "",
    seq: Number(row.seq) || 0,
    direction: "UNKNOWN",
    directionLabel: "",
    towDurationMinutes: null,
    hangarId: "",
    hangarNumber: text(row.hangarNumber),
    aircraftTypeId: "",
    aircraftType: text(row.aircraftType),
    aircraftId: "",
    tailNumber: text(row.tailNumber),
    operatorId: "",
    operator: text(row.operator),
    fromStand: text(row.fromStand),
    toStand: text(row.toStand),
    plannedStartAt: "",
    plannedStartMsk: text(row.plannedStartMsk),
    plannedEndAt: "",
    plannedEndMsk: "",
    occupancyEndAt: "",
    occupancyEndMsk: "",
    inferredOccupancyEndAt: "",
    standOccupancy: text(row.standOccupancy),
    standOccupancyMinutes: null,
    notes: text(row.notes),
    toSlotEndAt: "",
    toSlotEndMsk: "",
    toSlotDuration: text(row.toSlotDuration),
    toSlotMinutes: null,
    positionComment: text(row.positionComment),
    startChangeReason: text(row.startChangeReason),
    fromLabel: text(row.fromStand),
    toLabel: text(row.toStand),
    placementId: "",
    changeStatus: REGISTRY_REMOVED
  };
}

export function removedMailRows(
  previous: Array<Record<string, unknown>> | null,
  current: Array<{ id: string }>,
  outsideTowIds?: ReadonlySet<string>
): RegistryMailRow[] {
  const ids = new Set(current.map((row) => row.id));
  return (previous ?? [])
    .filter((row) => text(row.changeStatus) !== REGISTRY_REMOVED)
    .filter((row) => {
      const id = rowId(row);
      return Boolean(id) && !ids.has(id) && !outsideTowIds?.has(id);
    })
    .map(snapshotMailRow);
}

export function markRegistryChanges(
  previous: Array<Record<string, unknown>> | null,
  rows: TowReportRow[],
  outsideTowIds?: ReadonlySet<string>
): { rows: RegistryMailRow[]; lines: string[] } {
  const prevById = new Map((previous ?? []).map((row) => [rowId(row), row]));
  const marked: RegistryMailRow[] = rows.map((row) => {
    if (!previous) return { ...row, changeStatus: REGISTRY_ADDED };
    const before = prevById.get(row.id);
    if (before) return { ...row, changeStatus: changedFields(before, row).length ? REGISTRY_UPDATED : "" };
    const moved = (previous ?? []).filter((item) => text(item.eventId) === row.eventId && outsideTowIds?.has(rowId(item)));
    if (row.id.startsWith("plan:") && moved.length) {
      const same = moved.some((item) => changedFields(item, row).length === 0);
      return { ...row, changeStatus: same ? "" : REGISTRY_UPDATED };
    }
    return { ...row, changeStatus: REGISTRY_ADDED };
  });
  const removed = removedMailRows(previous, marked, outsideTowIds);
  return { rows: [...marked, ...removed], lines: registryChangeLines(previous, marked, outsideTowIds) };
}

/** Краткий список событий: одно событие — одна строка, без перечисления полей. */
export function registryChangeLines(
  previous: Array<Record<string, unknown>> | null,
  rows: RegistryMailRow[],
  outsideTowIds?: ReadonlySet<string>
): string[] {
  const before = eventGroups(asRecords(previous));
  const after = eventGroups(asRecords(rows));
  const added: string[] = [];
  const updated: string[] = [];
  const nextIds = new Set(rows.map((row) => row.id));
  const removed = (previous ?? [])
    .filter((row) => text(row.changeStatus) !== REGISTRY_REMOVED && !nextIds.has(rowId(row)) && !outsideTowIds?.has(rowId(row)))
    .map((row) => towLine(row));
  for (const [id, event] of after) {
    const prev = before.get(id);
    if (!previous || !prev) added.push(event.label);
    else if (prev.sig !== event.sig) updated.push(event.label);
  }
  added.sort((a, b) => a.localeCompare(b, "ru"));
  updated.sort((a, b) => a.localeCompare(b, "ru"));
  removed.sort((a, b) => a.localeCompare(b, "ru"));
  if (!previous) {
    const lines = ["Первая фиксация периода."];
    if (added.length) {
      lines.push("Добавлено:");
      for (const label of added) lines.push(`+ ${label}`);
    }
    return lines;
  }
  if (!added.length && !updated.length && !removed.length) return ["Изменений с прошлой фиксации нет."];
  const lines = ["Изменения с прошлой фиксации:"];
  if (added.length) {
    lines.push("Добавлено:");
    for (const label of added) lines.push(`+ ${label}`);
  }
  if (updated.length) {
    lines.push("Обновлено:");
    for (const label of updated) lines.push(`~ ${label}`);
  }
  if (removed.length) {
    lines.push("Удалено:");
    for (const label of removed) lines.push(`- ${label} — ${REGISTRY_REMOVED}`);
  }
  return lines;
}
