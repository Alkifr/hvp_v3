export const ANNOUNCEMENT_KINDS = ["UPDATE", "CHANGE", "MAINTENANCE", "OUTAGE"] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

export const ANNOUNCEMENT_KIND_LABEL: Record<AnnouncementKind, string> = {
  UPDATE: "Обновление",
  CHANGE: "Изменение",
  MAINTENANCE: "Ограничение",
  OUTAGE: "Приостановка"
};

const KIND_RANK: Record<AnnouncementKind, number> = {
  OUTAGE: 0,
  MAINTENANCE: 1,
  CHANGE: 2,
  UPDATE: 3
};

export function isAnnouncementKind(value: string): value is AnnouncementKind {
  return (ANNOUNCEMENT_KINDS as readonly string[]).includes(value);
}

export function announcementKindLabel(kind: string): string {
  return isAnnouncementKind(kind) ? ANNOUNCEMENT_KIND_LABEL[kind] : kind;
}

/** Показывать пользователю: опубликовано и период ещё не истёк. */
export function isAnnouncementVisible(
  row: { isActive: boolean; endsAt: Date | null },
  now = new Date()
): boolean {
  if (!row.isActive) return false;
  if (row.endsAt && row.endsAt.getTime() < now.getTime()) return false;
  return true;
}

export function announcementVisibleWhere(now: Date) {
  return {
    isActive: true,
    OR: [{ endsAt: null }, { endsAt: { gte: now } }]
  };
}

export function compareAnnouncementsForPopup<T extends { kind: string; createdAt: Date }>(a: T, b: T): number {
  const ra = KIND_RANK[a.kind as AnnouncementKind] ?? 9;
  const rb = KIND_RANK[b.kind as AnnouncementKind] ?? 9;
  if (ra !== rb) return ra - rb;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

export type AnnouncementStatus = "active" | "inactive" | "expired";

export function announcementStatus(
  row: { isActive: boolean; endsAt: Date | null },
  now = new Date()
): AnnouncementStatus {
  if (!row.isActive) return "inactive";
  if (row.endsAt && row.endsAt.getTime() < now.getTime()) return "expired";
  return "active";
}

export function serializeAnnouncement(row: {
  id: string;
  kind: string;
  title: string;
  body: string;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdById?: string | null;
  createdBy?: { id: string; email: string; displayName: string | null } | null;
  _count?: { dismissals: number };
}) {
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: announcementKindLabel(row.kind),
    title: row.title,
    body: row.body,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
    status: announcementStatus(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy
      ? { id: row.createdBy.id, email: row.createdBy.email, displayName: row.createdBy.displayName }
      : null,
    dismissalCount: row._count?.dismissals ?? undefined
  };
}
