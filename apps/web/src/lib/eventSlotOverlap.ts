const INACTIVE_STATUSES = new Set(["CANCELLED", "DELETED"]);

export type OverlapSlotEvent = {
  id: string;
  status?: string | null;
  startAt: string;
  endAt: string;
  allowOverlap?: boolean | null;
  hangar?: { id?: string } | null;
  layout?: { id?: string } | null;
  reservation?: { stand?: { id?: string } | null } | null;
  placements?: Array<{
    startAt?: string;
    endAt?: string;
    hangarId?: string | null;
    layoutId?: string | null;
    standId?: string | null;
    hangar?: { id?: string } | null;
    layout?: { id?: string } | null;
    stand?: { id?: string } | null;
  }>;
};

type Slot = {
  startAt: string;
  endAt: string;
  hangarId: string | null;
  layoutId: string | null;
  standId: string | null;
};

function slotsOf(ev: OverlapSlotEvent): Slot[] {
  if (ev.placements?.length) {
    return ev.placements.map((p) => ({
      startAt: p.startAt ?? ev.startAt,
      endAt: p.endAt ?? ev.endAt,
      hangarId: p.hangarId ?? p.hangar?.id ?? null,
      layoutId: p.layoutId ?? p.layout?.id ?? null,
      standId: p.standId ?? p.stand?.id ?? null
    }));
  }
  return [
    {
      startAt: ev.startAt,
      endAt: ev.endAt,
      hangarId: ev.hangar?.id ?? null,
      layoutId: ev.layout?.id ?? null,
      standId: ev.reservation?.stand?.id ?? null
    }
  ];
}

function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = Date.parse(aStart);
  const ae = Date.parse(aEnd);
  const bs = Date.parse(bStart);
  const be = Date.parse(bEnd);
  return Number.isFinite(as) && Number.isFinite(ae) && Number.isFinite(bs) && Number.isFinite(be) && as < be && ae > bs;
}

export function eventHasSlotOverlap(ev: OverlapSlotEvent, all: OverlapSlotEvent[]): boolean {
  if (INACTIVE_STATUSES.has(String(ev.status ?? ""))) return false;
  const mine = slotsOf(ev).filter((s) => s.standId || (s.hangarId && s.layoutId));
  if (mine.length === 0) return false;

  for (const other of all) {
    if (other.id === ev.id) continue;
    if (INACTIVE_STATUSES.has(String(other.status ?? ""))) continue;
    const others = slotsOf(other);
    for (const a of mine) {
      for (const b of others) {
        if (!intervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt)) continue;
        if (a.standId && b.standId && a.standId === b.standId) return true;
        if (
          a.hangarId &&
          b.hangarId &&
          a.hangarId === b.hangarId &&
          a.layoutId &&
          b.layoutId &&
          a.layoutId !== b.layoutId
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

export function eventAllowsOverlap(ev: OverlapSlotEvent, all: OverlapSlotEvent[]): boolean {
  return Boolean(ev.allowOverlap) || eventHasSlotOverlap(ev, all);
}
