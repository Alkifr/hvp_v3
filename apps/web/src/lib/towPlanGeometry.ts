export type ChipBox = {
  leftPct: number;
  widthPct: number;
  anchor: "start" | "end";
};

export function chipBox(startMs: number, endMs: number, rangeStart: number, rangeEnd: number): ChipBox | null {
  if (!(rangeEnd > rangeStart) || !(endMs > startMs)) return null;
  const start = Math.max(startMs, rangeStart);
  const end = Math.min(endMs, rangeEnd);
  if (!(end > start)) return null;
  const span = rangeEnd - rangeStart;
  const leftPct = ((start - rangeStart) / span) * 100;
  const widthPct = ((end - start) / span) * 100;
  const anchor = leftPct + widthPct > 88 ? "end" : "start";
  return { leftPct, widthPct, anchor };
}

export function conflictKeys(items: Array<{ key: string; startMs: number; endMs: number }>): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const left = items[i];
    if (!left) continue;
    for (let j = i + 1; j < items.length; j += 1) {
      const right = items[j];
      if (!right) continue;
      if (left.startMs < right.endMs && right.startMs < left.endMs) {
        out.add(left.key);
        out.add(right.key);
      }
    }
  }
  return out;
}

export type DayPlacement = {
  id: string;
  origin: "MANUAL" | "AUTO_GAP";
  startAt: string;
  endAt: string;
  hangarId: string;
  hangarLabel: string;
  standCode: string;
};

export type DayTow = {
  id: string;
  placementId: string;
  startAt: string;
  endAt: string;
  fromLabel: string;
  toLabel: string;
  directionLabel: string;
};

export type DayPending = {
  role: string;
  startAt: string;
  endAt: string;
  placementId: string;
  fromLabel: string;
  toLabel: string;
};

export type DayEvent = {
  eventId: string;
  title: string;
  tailNumber: string;
  startAt: string;
  endAt: string;
  hangars: Array<{ id: string; label: string }>;
  placements: DayPlacement[];
  tows: DayTow[];
  pending: DayPending[];
  locked: boolean;
};

export type DayChip = {
  key: string;
  kind: "tow" | "pending";
  towId: string;
  role: string;
  label: string;
  title: string;
  startMs: number;
  endMs: number;
  conflict: boolean;
};

export type HangarDayGroup = {
  hangarId: string;
  hangarLabel: string;
  rows: Array<{
    eventId: string;
    tailNumber: string;
    title: string;
    locked: boolean;
    chips: DayChip[];
  }>;
};

function ms(iso: string): number {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : NaN;
}

function overlaps(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  return start < rangeEnd && end > rangeStart;
}

function hangarOf(event: DayEvent, placementId: string): { id: string; label: string } | null {
  const placement = event.placements.find((item) => item.id === placementId);
  if (placement?.hangarId) return { id: placement.hangarId, label: placement.hangarLabel || placement.hangarId };
  const primary = event.hangars[0];
  return primary?.id ? primary : null;
}

function chipLabel(directionLabel: string, fromLabel: string, toLabel: string): string {
  const name = directionLabel || "Буксировка";
  const route = [fromLabel, toLabel].filter(Boolean).join("→");
  return route ? `${name} ${route}` : name;
}

export function buildHangarDay(events: DayEvent[], dayStartMs: number, dayEndMs: number): HangarDayGroup[] {
  if (!(dayEndMs > dayStartMs)) return [];
  const groups = new Map<string, HangarDayGroup>();

  const ensure = (hangar: { id: string; label: string }) => {
    const existing = groups.get(hangar.id);
    if (existing) return existing;
    const created: HangarDayGroup = { hangarId: hangar.id, hangarLabel: hangar.label || hangar.id, rows: [] };
    groups.set(hangar.id, created);
    return created;
  };

  for (const event of events) {
    const eventStart = ms(event.startAt);
    const eventEnd = ms(event.endAt);
    if (!overlaps(eventStart, eventEnd, dayStartMs, dayEndMs)) continue;

    const hangarIds = new Set<string>();
    for (const placement of event.placements) {
      const start = ms(placement.startAt);
      const end = ms(placement.endAt);
      if (!placement.hangarId || !overlaps(start, end, dayStartMs, dayEndMs)) continue;
      hangarIds.add(placement.hangarId);
      ensure({ id: placement.hangarId, label: placement.hangarLabel });
    }
    const rememberMovement = (placementId: string, startAt: string, endAt: string) => {
      if (!overlaps(ms(startAt), ms(endAt), dayStartMs, dayEndMs)) return;
      const hangar = hangarOf(event, placementId);
      if (!hangar) return;
      hangarIds.add(hangar.id);
      ensure(hangar);
    };
    for (const tow of event.tows) rememberMovement(tow.placementId, tow.startAt, tow.endAt);
    for (const pending of event.pending) rememberMovement(pending.placementId, pending.startAt, pending.endAt);
    if (hangarIds.size === 0 && event.placements.length === 0 && event.hangars[0]) {
      hangarIds.add(event.hangars[0].id);
      ensure(event.hangars[0]);
    }

    for (const hangarId of hangarIds) {
      const group = groups.get(hangarId);
      if (!group) continue;
      const chips: DayChip[] = [];
      for (const tow of event.tows) {
        const hangar = hangarOf(event, tow.placementId);
        if (hangar?.id !== hangarId) continue;
        const startMs = ms(tow.startAt);
        const endMs = ms(tow.endAt);
        if (!overlaps(startMs, endMs, dayStartMs, dayEndMs)) continue;
        const label = chipLabel(tow.directionLabel, tow.fromLabel, tow.toLabel);
        chips.push({
          key: `tow:${tow.id}`,
          kind: "tow",
          towId: tow.id,
          role: "",
          label,
          title: label,
          startMs,
          endMs,
          conflict: false
        });
      }
      for (const pending of event.pending) {
        const hangar = hangarOf(event, pending.placementId);
        if (hangar?.id !== hangarId) continue;
        const startMs = ms(pending.startAt);
        const endMs = ms(pending.endAt);
        if (!overlaps(startMs, endMs, dayStartMs, dayEndMs)) continue;
        const name = pending.role.endsWith("in") ? "Закатка" : "Выкатка";
        const label = chipLabel(name, pending.fromLabel, pending.toLabel);
        chips.push({
          key: `pending:${event.eventId}:${pending.role}:${pending.placementId}`,
          kind: "pending",
          towId: "",
          role: pending.role,
          label,
          title: `${label}, по нормативу`,
          startMs,
          endMs,
          conflict: false
        });
      }
      chips.sort((a, b) => a.startMs - b.startMs);
      group.rows.push({
        eventId: event.eventId,
        tailNumber: event.tailNumber || event.title || event.eventId,
        title: event.title,
        locked: event.locked,
        chips
      });
    }
  }

  const ordered = [...groups.values()].sort((a, b) => a.hangarLabel.localeCompare(b.hangarLabel, "ru"));
  for (const group of ordered) {
    group.rows.sort((a, b) => a.tailNumber.localeCompare(b.tailNumber, "ru"));
    const marked = conflictKeys(
      group.rows.flatMap((row) => row.chips.filter((chip) => chip.kind === "tow").map((chip) => ({ key: chip.key, startMs: chip.startMs, endMs: chip.endMs })))
    );
    for (const row of group.rows) {
      for (const chip of row.chips) chip.conflict = marked.has(chip.key);
    }
  }
  return ordered.filter((group) => group.rows.length > 0);
}

const MSK_SHIFT_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WeekEdge = {
  key: string;
  eventId: string;
  placementId: string;
  side: "start" | "end";
  at: string;
  day: string;
  minute: number;
  tailNumber: string;
  title: string;
  hangarLabel: string;
  standCode: string;
  locked: boolean;
  towId: string;
  towStart: string;
  towEnd: string;
  fromLabel: string;
  toLabel: string;
  occupancyEndAt: string;
  startChangeReason: string;
  long: boolean;
};

export function mskDayAndMinute(ms: number): { day: string; minute: number } | null {
  if (!Number.isFinite(ms)) return null;
  const wall = new Date(ms + MSK_SHIFT_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    day: `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
    minute: wall.getUTCHours() * 60 + wall.getUTCMinutes()
  };
}

export function mondayOfMskDay(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const utc = Date.UTC(year!, month! - 1, day!);
  const dow = new Date(utc).getUTCDay();
  const delta = dow === 0 ? 6 : dow - 1;
  const monday = new Date(utc - delta * DAY_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

function towCoversEdge(tow: DayTow, at: number, side: "start" | "end"): boolean {
  const start = ms(tow.startAt);
  const end = ms(tow.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const slack = 2 * 60 * 1000;
  if (side === "start") return Math.abs(start - at) <= slack || (start <= at && end > at);
  return Math.abs(end - at) <= slack || (start < at && end >= at);
}

export function buildWeekEdges(events: DayEvent[], weekStartMs: number): WeekEdge[] {
  const weekEndMs = weekStartMs + 7 * DAY_MS;
  const edges: WeekEdge[] = [];
  for (const event of events) {
    for (const placement of event.placements) {
      if (placement.origin === "AUTO_GAP") continue;
      for (const side of ["start", "end"] as const) {
        const at = ms(side === "start" ? placement.startAt : placement.endAt);
        if (!Number.isFinite(at) || at < weekStartMs || at >= weekEndMs) continue;
        const wall = mskDayAndMinute(at);
        if (!wall) continue;
        const linked = event.tows.filter((tow) => !tow.placementId || tow.placementId === placement.id);
        const matched = linked
          .filter((tow) => towCoversEdge(tow, at, side))
          .sort((a, b) => {
            const left = Math.abs(ms(side === "start" ? a.startAt : a.endAt) - at);
            const right = Math.abs(ms(side === "start" ? b.startAt : b.endAt) - at);
            return left - right;
          })[0];
        const durationMin = matched ? Math.round((ms(matched.endAt) - ms(matched.startAt)) / 60_000) : 0;
        const extra = matched as (DayTow & { occupancyEndAt?: string; startChangeReason?: string }) | undefined;
        edges.push({
          key: `${event.eventId}:${placement.id}:${side}`,
          eventId: event.eventId,
          placementId: placement.id,
          side,
          at: new Date(at).toISOString(),
          day: wall.day,
          minute: wall.minute,
          tailNumber: event.tailNumber,
          title: event.title,
          hangarLabel: placement.hangarLabel || event.hangars[0]?.label || "",
          standCode: placement.standCode,
          locked: event.locked,
          towId: matched?.id ?? "",
          towStart: matched?.startAt ?? "",
          towEnd: matched?.endAt ?? "",
          fromLabel: matched?.fromLabel ?? "",
          toLabel: matched?.toLabel ?? "",
          occupancyEndAt: extra?.occupancyEndAt ?? "",
          startChangeReason: extra?.startChangeReason ?? "",
          long: durationMin > 120
        });
      }
    }
  }
  edges.sort((a, b) => a.day.localeCompare(b.day) || a.minute - b.minute || a.tailNumber.localeCompare(b.tailNumber, "ru"));
  return edges;
}

export function weekEdgeSpan(edge: Pick<WeekEdge, "day" | "minute" | "towId" | "towStart" | "towEnd">, stepMin: number): { start: number; minutes: number } {
  const fallback = { start: edge.minute, minutes: stepMin };
  if (!edge.towId || !edge.towStart || !edge.towEnd) return fallback;
  const start = mskDayAndMinute(ms(edge.towStart));
  const end = mskDayAndMinute(ms(edge.towEnd));
  if (!start || !end || start.day > edge.day || end.day < edge.day) return fallback;
  const startMin = start.day < edge.day ? 0 : start.minute;
  const endMin = end.day > edge.day ? 1440 : end.minute;
  if (endMin - startMin < 1) return fallback;
  return { start: startMin, minutes: endMin - startMin };
}
