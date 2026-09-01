import {
  requestOpenEventFromNotification,
  type OpenEventFromNotification
} from "../ui/components/NotificationBell";

export type EventDeepLink = OpenEventFromNotification;

/** `#gantt?event=...&sandbox=...` — период на Гантте у получателя не меняется */
export function buildEventShareUrl(params: {
  eventId: string;
  sandboxId?: string | null;
}): string {
  const q = new URLSearchParams();
  q.set("event", params.eventId);
  if (params.sandboxId) q.set("sandbox", params.sandboxId);
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return `${base}#gantt?${q.toString()}`;
}

export const ADMIN_HASH_TABS = [
  "overview",
  "users",
  "roles",
  "activity",
  "presence",
  "announce",
  "cleanup",
  "mail",
  "sandboxes",
  "reports"
] as const;

export type AdminHashTab = (typeof ADMIN_HASH_TABS)[number];

export function isAdminHashTab(value: string): value is AdminHashTab {
  return (ADMIN_HASH_TABS as readonly string[]).includes(value);
}

export function parseHashPage(hashRaw: string): { page: string; rest: string; query: URLSearchParams } {
  const hash = (hashRaw || "").replace(/^#/, "");
  const qIdx = hash.indexOf("?");
  const path = qIdx < 0 ? hash : hash.slice(0, qIdx);
  const query = qIdx < 0 ? new URLSearchParams() : new URLSearchParams(hash.slice(qIdx + 1));
  const slash = path.indexOf("/");
  if (slash < 0) return { page: path, rest: "", query };
  return { page: path.slice(0, slash), rest: path.slice(slash + 1), query };
}

export function adminTabFromHash(hashRaw: string): AdminHashTab | null {
  const { page, rest } = parseHashPage(hashRaw);
  if (page !== "admin") return null;
  const tab = rest.split("/").filter(Boolean)[0] ?? "";
  return isAdminHashTab(tab) ? tab : null;
}

export function buildAdminHash(tab: string, opts?: { invite?: boolean }): string {
  const q = new URLSearchParams();
  if (opts?.invite) q.set("invite", "1");
  const qs = q.toString();
  return `admin/${tab}${qs ? `?${qs}` : ""}`;
}

export function eventDeepLinkFromHashQuery(query: URLSearchParams): EventDeepLink | null {
  const eventId = query.get("event")?.trim();
  if (!eventId) return null;
  const sandbox = query.get("sandbox");
  return {
    eventId,
    sandboxId: sandbox && sandbox.length > 0 ? sandbox : null
  };
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Применить deep-link: открытие карточки на Гантте (песочницу переключает App). */
export function applyEventDeepLink(detail: EventDeepLink) {
  requestOpenEventFromNotification(detail);
}
