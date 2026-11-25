export type PlanCopyRow = {
  id: string;
  eventId: string;
  added?: boolean;
  copyAnchorId?: string;
};

/** Вставляет несохранённые копии сразу после исходной строки. Если исходной строки уже нет — после последнего ряда того же события. */
export function placeAddedRows<T extends PlanCopyRow>(base: readonly T[], copies: readonly T[]): T[] {
  const pending = copies.filter((row) => row.added);
  if (!pending.length) return [...base];
  const baseIds = new Set(base.map((row) => row.id));
  const byAnchor = new Map<string, T[]>();
  const loose: T[] = [];
  for (const copy of pending) {
    const anchor = copy.copyAnchorId;
    if (anchor && baseIds.has(anchor)) {
      const list = byAnchor.get(anchor) ?? [];
      list.push(copy);
      byAnchor.set(anchor, list);
    } else {
      loose.push(copy);
    }
  }
  const next: T[] = [];
  for (const row of base) {
    next.push(row);
    for (const copy of byAnchor.get(row.id) ?? []) next.push(copy);
  }
  for (const copy of loose) {
    let index = -1;
    for (let i = next.length - 1; i >= 0; i -= 1) {
      if (next[i]?.eventId === copy.eventId) {
        index = i;
        break;
      }
    }
    if (index >= 0) next.splice(index + 1, 0, copy);
    else next.push(copy);
  }
  return next;
}
