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

export function parseHashPage(hashRaw: string): { page: string; query: URLSearchParams } {
  const hash = (hashRaw || "").replace(/^#/, "");
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return { page: hash, query: new URLSearchParams() };
  return {
    page: hash.slice(0, qIdx),
    query: new URLSearchParams(hash.slice(qIdx + 1))
  };
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
