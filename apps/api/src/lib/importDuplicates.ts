/** Предупреждения о вероятных дублях импорта. Строку не блокируют. */
export const FILE_DUPLICATE_WARNING_PREFIX = "Вероятный дубль в файле:";
export const PLAN_DUPLICATE_WARNING_PREFIX = "Вероятный дубль в плане:";

const MAX_LISTED = 5;
const MSK_OFFSET_MS = 180 * 60_000;

export type ImportDuplicateRow = {
  rowIndex: number;
  aircraftId: string;
  eventTypeId: string;
  title: string;
  tail: string;
  startAt: Date;
  endAt: Date;
};

export type PlanDuplicateEvent = {
  id: string;
  aircraftId: string;
  eventTypeId: string;
  title: string;
  tail: string;
  startAt: Date;
  endAt: Date;
};

function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && end > otherStart;
}

function formatMsk(value: Date): string {
  const wall = new Date(value.getTime() + MSK_OFFSET_MS);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(wall.getUTCDate())}.${pad(wall.getUTCMonth() + 1)}.${wall.getUTCFullYear()} ${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

function listWithMore(parts: string[], total: number): string {
  if (total <= parts.length) return parts.join(", ");
  return `${parts.join(", ")} и ещё ${total - parts.length}`;
}

function groupKey(aircraftId: string, eventTypeId: string): string {
  return `${aircraftId}\0${eventTypeId}`;
}

/** Тот же борт и тип события с пересечением оперативного периода внутри файла. */
export function fileDuplicateWarnings(rows: ImportDuplicateRow[]): Map<number, string> {
  const groups = new Map<string, ImportDuplicateRow[]>();
  for (const row of rows) {
    const key = groupKey(row.aircraftId, row.eventTypeId);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const out = new Map<number, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      const start = row.startAt.getTime();
      const end = row.endAt.getTime();
      const partners = group
        .filter((other) => other.rowIndex !== row.rowIndex && overlaps(start, end, other.startAt.getTime(), other.endAt.getTime()))
        .sort((a, b) => a.rowIndex - b.rowIndex);
      if (!partners.length) continue;
      const shown = partners.slice(0, MAX_LISTED).map((other) => {
        const title = other.title.trim();
        return title ? `${other.rowIndex} «${title}»` : String(other.rowIndex);
      });
      const tail = row.tail.trim() ? ` ${row.tail.trim()}` : "";
      const rowsLabel = partners.length === 1 ? "со строкой" : "со строками";
      out.set(
        row.rowIndex,
        `${FILE_DUPLICATE_WARNING_PREFIX} борт${tail}, тот же тип события, пересекается ${rowsLabel} ${listWithMore(shown, partners.length)}.`
      );
    }
  }
  return out;
}

/** Тот же борт и тип события уже стоят в текущем плане на пересекающемся периоде. */
export function planDuplicateWarnings(rows: ImportDuplicateRow[], existing: PlanDuplicateEvent[]): Map<number, string> {
  const groups = new Map<string, PlanDuplicateEvent[]>();
  for (const event of existing) {
    const key = groupKey(event.aircraftId, event.eventTypeId);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  const out = new Map<number, string>();
  for (const row of rows) {
    const events = groups.get(groupKey(row.aircraftId, row.eventTypeId)) ?? [];
    const start = row.startAt.getTime();
    const end = row.endAt.getTime();
    const hits = events
      .filter((event) => overlaps(start, end, event.startAt.getTime(), event.endAt.getTime()))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.title.localeCompare(b.title, "ru"));
    if (!hits.length) continue;
    const shown = hits
      .slice(0, MAX_LISTED)
      .map((event) => `«${event.title}» ${formatMsk(event.startAt)}–${formatMsk(event.endAt)}`);
    const tail = row.tail.trim() ? ` ${row.tail.trim()}` : "";
    out.set(
      row.rowIndex,
      `${PLAN_DUPLICATE_WARNING_PREFIX} борт${tail}, тот же тип события, уже есть в плане: ${listWithMore(shown, hits.length)}.`
    );
  }
  return out;
}
