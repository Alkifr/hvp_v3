export const HOME_PAGES = [
  "gantt",
  "hangar",
  "analytics",
  "itp",
  "import",
  "ref",
  "mail",
  "admin",
  "sandboxes",
  "help"
] as const;

export type HomePage = (typeof HOME_PAGES)[number];

export const NOTIFICATION_KINDS = [
  "EVENT_OVERDUE_NO_FACT",
  "EVENT_STATUS_IN_PROGRESS",
  "EVENT_STATUS_DONE",
  "USER_ERROR"
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const HOME_SET = new Set<string>(HOME_PAGES);
const KIND_SET = new Set<string>(NOTIFICATION_KINDS);

export function parseHomePage(raw: unknown): HomePage | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v || v === "auto") return null;
  return HOME_SET.has(v) ? (v as HomePage) : null;
}

export function parseMutedNotificationKinds(raw: unknown): NotificationKind[] {
  if (!Array.isArray(raw)) return [];
  const out: NotificationKind[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const v = String(item ?? "").trim();
    if (!KIND_SET.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v as NotificationKind);
  }
  return out;
}
