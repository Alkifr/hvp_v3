import { getActiveSandboxId } from "./api";

export type PresenceKind = "PING" | "PAGE" | "ACTION";

const PING_MS = 120_000;

let lastSent = "";
let lastSentAt = 0;

function postPresence(body: { kind: PresenceKind; page?: string; detail?: string }) {
  const key = `${body.kind}:${body.page ?? ""}:${body.detail ?? ""}`;
  const now = Date.now();
  if (key === lastSent && now - lastSentAt < 15_000) return;
  lastSent = key;
  lastSentAt = now;
  try {
    void fetch("/api/presence", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export function reportPageView(page: string) {
  postPresence({ kind: "PAGE", page });
}

export function reportPresenceAction(detail: string, page?: string) {
  postPresence({ kind: "ACTION", page, detail });
}

export function installPresenceTracker(getPage: () => string): () => void {
  const ping = () => {
    if (document.visibilityState !== "visible") return;
    postPresence({ kind: "PING" });
  };
  const interval = window.setInterval(ping, PING_MS);
  const onVis = () => {
    if (document.visibilityState === "visible") ping();
  };
  document.addEventListener("visibilitychange", onVis);

  const onSandbox = () => {
    const id = getActiveSandboxId();
    reportPresenceAction(id ? `sandbox:${id}` : "sandbox:prod", getPage());
  };
  window.addEventListener("hangarPlanning:sandboxChanged", onSandbox);

  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("hangarPlanning:sandboxChanged", onSandbox);
  };
}
