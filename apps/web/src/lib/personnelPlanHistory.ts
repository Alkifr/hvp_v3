/** Сравнение двух сохранённых проектов одного периода: исходный и состояние на выбранный момент. */

const DEPARTMENTS = ["ME", "AV", "INT", "NDT", "SHOP", "CAB_REP", "PAINT"] as const;
const HOUR_EPS = 0.05;
const DAY_MS = 86_400_000;

export type HistoryArchiveItem = {
  id: string;
  periodFrom: string;
  periodTo: string;
  workshopLabel: string;
  createdAt: string;
  title: string;
};

export type HistoryPlacement = {
  startAt: string;
  endAt: string;
  hangar?: { code?: string | null; name?: string | null } | null;
  stand?: { code?: string | null; name?: string | null } | null;
};

export type HistoryEvent = {
  id: string;
  title?: string;
  aircraftLabel?: string;
  status?: string;
  statusLabel?: string;
  startAt: string;
  endAt: string;
  workshop?: { code?: string | null; name?: string | null } | null;
  operator?: { code?: string | null; name?: string | null } | null;
  aircraftType?: { icaoType?: string | null; name?: string | null } | null;
  hangar?: { code?: string | null; name?: string | null } | null;
  placements?: HistoryPlacement[];
  reportMetrics?: Array<{ department?: string; manHours?: number | string }>;
};

export type HistoryDay = {
  date: string;
  demand?: Record<string, number>;
  authorizedSupply?: Record<string, number>;
  strictBalance?: Record<string, number>;
  eventDemand?: Array<{ id: string; byDepartment?: Record<string, number> }>;
};

export type HistoryPayload = {
  from: string;
  to: string;
  workshops?: Array<{ id: string; code?: string; name?: string }>;
  aircraftTypes?: Array<{ id: string; name?: string; icaoType?: string | null }>;
  departments?: string[];
  events?: HistoryEvent[];
  calculation?: HistoryDay[];
  resourceSlices?: Array<{ workshopId: string; aircraftTypeId: string; planned: number; available: number; difference: number }>;
};

export type HistoryChange = {
  kind: "added" | "removed" | "changed" | "total";
  eventId: string;
  what: string;
  changed: string;
  before: string;
  after: string;
};

export function planFamilyKey(periodFrom: string, periodTo: string, workshopLabel: string) {
  const shops = workshopLabel.split(",").map((item) => item.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
  return `${periodFrom.slice(0, 10)}|${periodTo.slice(0, 10)}|${shops.join(",")}`;
}

export function mskDateTimeLocal(date = new Date()) {
  const shifted = new Date(date.getTime() + 180 * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function mskLocalToMs(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return Date.parse(`${trimmed}T23:59:59+03:00`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return Date.parse(`${trimmed}:00+03:00`);
  return Date.parse(trimmed);
}

export function selectPlanHistory(
  items: HistoryArchiveItem[],
  atMs: number,
  family: { periodFrom: string; periodTo: string; workshopLabel: string }
) {
  const key = planFamilyKey(family.periodFrom, family.periodTo, family.workshopLabel);
  const familyItems = items
    .filter((item) => planFamilyKey(item.periodFrom, item.periodTo, item.workshopLabel) === key)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (!familyItems.length) {
    return { baseline: undefined, target: undefined, error: "Для выбранного периода и цехов ещё нет сохранённых планов." };
  }
  const baseline = familyItems[0]!;
  const eligible = familyItems.filter((item) => Date.parse(item.createdAt) <= atMs);
  if (!eligible.length) {
    return {
      baseline,
      target: undefined,
      error: `На это время плана ещё не было. Первый снимок сохранён ${fmtStamp(baseline.createdAt)}.`
    };
  }
  return { baseline, target: eligible[eligible.length - 1]!, error: "" };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function moscow(value: string) {
  return new Date(new Date(value).getTime() + 180 * 60_000);
}

export function fmtStamp(value: string) {
  const date = moscow(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function fmtDay(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}.${month}.${year}` : value;
}

function labelOf(row?: { code?: string | null; name?: string | null } | null) {
  return row?.code || row?.name || "";
}

export function historyEventPlace(event: HistoryEvent, from: string, to: string) {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00+03:00`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00+03:00`) + DAY_MS;
  let best: HistoryPlacement | null = null;
  let bestOverlap = 0;
  for (const placement of event.placements ?? []) {
    const overlap = Math.max(0, Math.min(Date.parse(placement.endAt), end) - Math.max(Date.parse(placement.startAt), start));
    if (overlap > bestOverlap) {
      best = placement;
      bestOverlap = overlap;
    }
  }
  const hangar = labelOf(best?.hangar) || labelOf(event.hangar) || "—";
  const stand = labelOf(best?.stand) || "—";
  return { hangar, stand };
}

function hoursOf(event: HistoryEvent, days: HistoryDay[]) {
  const totals: Record<string, number> = {};
  let seen = false;
  for (const day of days) {
    const item = day.eventDemand?.find((row) => row.id === event.id);
    if (!item?.byDepartment) continue;
    seen = true;
    for (const [department, hours] of Object.entries(item.byDepartment)) {
      totals[department] = (totals[department] ?? 0) + Number(hours || 0);
    }
  }
  if (!seen) {
    for (const metric of event.reportMetrics ?? []) {
      if (!metric.department) continue;
      totals[metric.department] = Number(metric.manHours || 0);
    }
  }
  return totals;
}

function hoursText(totals: Record<string, number>) {
  const parts = DEPARTMENTS.flatMap((department) => {
    const hours = totals[department] ?? 0;
    return Math.abs(hours) >= HOUR_EPS ? [`${department} ${fmtHours(hours)}`] : [];
  });
  return parts.join(", ") || "—";
}

function fmtHours(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function eventText(event: HistoryEvent, payload: HistoryPayload) {
  const place = historyEventPlace(event, payload.from, payload.to);
  const hours = hoursText(hoursOf(event, payload.calculation ?? []));
  return [
    `${fmtStamp(event.startAt)}–${fmtStamp(event.endAt)}`,
    `${place.hangar} / ${place.stand}`,
    labelOf(event.workshop) || "—",
    labelOf(event.operator) || "—",
    event.aircraftType?.icaoType || event.aircraftType?.name || "—",
    event.statusLabel || event.status || "—",
    hours
  ].join("; ");
}

function eventTitle(event: HistoryEvent) {
  const tail = event.aircraftLabel || "—";
  return `${tail} · ${event.title || "Событие"}`;
}

function sameHours(left: Record<string, number>, right: Record<string, number>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (Math.abs((left[key] ?? 0) - (right[key] ?? 0)) >= HOUR_EPS) return false;
  }
  return true;
}

export function diffPlanPayloads(before: HistoryPayload, after: HistoryPayload): HistoryChange[] {
  const beforeEvents = new Map((before.events ?? []).map((event) => [event.id, event]));
  const afterEvents = new Map((after.events ?? []).map((event) => [event.id, event]));
  const changes: HistoryChange[] = [];
  const ids = [...new Set([...beforeEvents.keys(), ...afterEvents.keys()])];
  ids.sort((a, b) => eventTitle(afterEvents.get(a) ?? beforeEvents.get(a)!).localeCompare(eventTitle(afterEvents.get(b) ?? beforeEvents.get(b)!), "ru"));
  for (const id of ids) {
    const left = beforeEvents.get(id);
    const right = afterEvents.get(id);
    if (left && !right) {
      changes.push({ kind: "removed", eventId: id, what: eventTitle(left), changed: "снято с плана", before: eventText(left, before), after: "—" });
      continue;
    }
    if (!left && right) {
      changes.push({ kind: "added", eventId: id, what: eventTitle(right), changed: "добавлено", before: "—", after: eventText(right, after) });
      continue;
    }
    if (!left || !right) continue;
    const leftHours = hoursOf(left, before.calculation ?? []);
    const rightHours = hoursOf(right, after.calculation ?? []);
    const leftPlace = historyEventPlace(left, before.from, before.to);
    const rightPlace = historyEventPlace(right, after.from, after.to);
    const fields: string[] = [];
    if (left.startAt !== right.startAt || left.endAt !== right.endAt) fields.push("срок");
    if (leftPlace.hangar !== rightPlace.hangar || leftPlace.stand !== rightPlace.stand) fields.push("место");
    if ((left.statusLabel || left.status) !== (right.statusLabel || right.status)) fields.push("статус");
    if (labelOf(left.workshop) !== labelOf(right.workshop)) fields.push("цех");
    if ((left.title || "") !== (right.title || "")) fields.push("название");
    if (!sameHours(leftHours, rightHours)) fields.push("часы");
    if (!fields.length) continue;
    changes.push({
      kind: "changed",
      eventId: id,
      what: eventTitle(right),
      changed: fields.join(", "),
      before: eventText(left, before),
      after: eventText(right, after)
    });
  }

  const dates = [...new Set([...(before.calculation ?? []), ...(after.calculation ?? [])].map((day) => day.date.slice(0, 10)))].sort();
  const beforeDay = new Map((before.calculation ?? []).map((day) => [day.date.slice(0, 10), day]));
  const afterDay = new Map((after.calculation ?? []).map((day) => [day.date.slice(0, 10), day]));
  const departments = [...new Set([...(before.departments ?? []), ...(after.departments ?? []), ...DEPARTMENTS])];
  for (const date of dates) {
    for (const department of departments) {
      const pairs: Array<[string, number, number]> = [
        ["Потребность", Number(beforeDay.get(date)?.demand?.[department] ?? 0), Number(afterDay.get(date)?.demand?.[department] ?? 0)],
        ["Доступный ресурс", Number(beforeDay.get(date)?.authorizedSupply?.[department] ?? 0), Number(afterDay.get(date)?.authorizedSupply?.[department] ?? 0)],
        ["Разница", Number(beforeDay.get(date)?.strictBalance?.[department] ?? 0), Number(afterDay.get(date)?.strictBalance?.[department] ?? 0)]
      ];
      for (const [label, was, became] of pairs) {
        if (Math.abs(was - became) < HOUR_EPS) continue;
        if (Math.abs(was) < HOUR_EPS && Math.abs(became) < HOUR_EPS) continue;
        changes.push({
          kind: "total",
          eventId: "",
          what: `${label} ${department} · ${fmtDay(date)}`,
          changed: "сутки",
          before: fmtHours(was),
          after: fmtHours(became)
        });
      }
    }
  }
  return changes;
}

export function wasBecameText(change: Pick<HistoryChange, "before" | "after"> | undefined) {
  if (!change || (change.before === "—" && change.after === "—")) return "";
  if (change.before === change.after) return "";
  return `Было: ${change.before}\nСтало: ${change.after}`;
}
