import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { onSandboxChange } from "./api";

export const LIVE_EVENT = "hangarPlanning:live";
export const PEER_FRESH_MS = 3 * 60 * 1000;

export const LIVE_TOPICS = [
  "events",
  "placements",
  "tows",
  "personnel",
  "ref",
  "notifications",
  "announcements",
  "presence"
] as const;

export type LiveTopic = (typeof LIVE_TOPICS)[number];

export type LivePresence = {
  userId: string;
  displayName: string;
  page: string;
  eventId?: string | null;
};

export type LiveSignal = {
  topic: LiveTopic;
  scope: string;
  at: string;
  ids?: string[];
  bulk?: boolean;
  actorId?: string;
  presence?: LivePresence;
};

export type LiveViewer = { sandboxId: string | null; userId: string };

export type LivePeer = {
  userId: string;
  displayName: string;
  page: string;
  eventId: string | null;
  seenAt: number;
};

const QUERY_KEYS: Record<Exclude<LiveTopic, "personnel" | "presence">, QueryKey[]> = {
  events: [
    ["events"],
    ["event-history"],
    ["event-tows"],
    ["itp-events"],
    ["itp-plan"],
    ["analytics", "primary-table"],
    ["hangar-planning"]
  ],
  placements: [["hangar-planning"], ["reservations"], ["events"]],
  tows: [
    ["tows-plan"],
    ["tows-report"],
    ["tows-board"],
    ["tows-registry"],
    ["tows-changes"],
    ["event-tows"]
  ],
  ref: [["ref"], ["layout"]],
  notifications: [["notifications"]],
  announcements: [["announcements"]]
};

export function signalVisible(signal: { scope: string }, viewer: LiveViewer): boolean {
  if (signal.scope === "global") return true;
  if (signal.scope.startsWith("user:")) return signal.scope === `user:${viewer.userId}`;
  const mine = viewer.sandboxId ? `sandbox:${viewer.sandboxId}` : "prod";
  return signal.scope === mine;
}

export function draftTouchedBySignal(signal: LiveSignal, eventId: string, viewer: LiveViewer): boolean {
  if (!signalVisible(signal, viewer)) return false;
  if (signal.actorId && signal.actorId === viewer.userId) return false;
  if (signal.topic !== "events" && signal.topic !== "placements" && signal.topic !== "tows") return false;
  if (signal.bulk || !signal.ids || signal.ids.length === 0) return true;
  return signal.ids.includes(eventId);
}

type InvalidateClient = Pick<QueryClient, "invalidateQueries">;

export function personnelQueryLive(queryKey: readonly unknown[]): boolean {
  if (queryKey[0] !== "personnel") return false;
  return queryKey[1] !== "plan-archive" && queryKey[1] !== "plan-archives";
}

export function invalidateLiveSignal(qc: InvalidateClient, signal: Pick<LiveSignal, "topic">) {
  if (signal.topic === "presence") return;
  if (signal.topic === "personnel") {
    void qc.invalidateQueries({
      predicate: (query: { queryKey: readonly unknown[] }) => personnelQueryLive(query.queryKey)
    });
    return;
  }
  for (const queryKey of QUERY_KEYS[signal.topic]) {
    void qc.invalidateQueries({ queryKey });
  }
}

export function invalidateLiveSnapshot(qc: InvalidateClient) {
  for (const topic of ["events", "placements", "tows", "personnel", "ref", "notifications", "announcements"] as const) {
    invalidateLiveSignal(qc, { topic });
  }
}

const peers = new Map<string, LivePeer>();
const peerListeners = new Set<() => void>();

function notifyPeers() {
  for (const listener of peerListeners) listener();
}

export function applyPresence(signal: LiveSignal, now = Date.now()) {
  const presence = signal.presence;
  if (!presence?.userId) return;
  const prev = peers.get(presence.userId);
  if (!presence.page) {
    if (prev) peers.set(presence.userId, { ...prev, seenAt: now });
    notifyPeers();
    return;
  }
  if (presence.page !== "gantt" && presence.page !== "hangar") {
    if (prev) {
      peers.delete(presence.userId);
      notifyPeers();
    }
    return;
  }
  peers.set(presence.userId, {
    userId: presence.userId,
    displayName: presence.displayName || "Пользователь",
    page: presence.page,
    eventId: presence.eventId === undefined ? (prev?.eventId ?? null) : presence.eventId,
    seenAt: now
  });
  notifyPeers();
}

export function peersOnPage(page: "gantt" | "hangar", selfId: string, now = Date.now()): LivePeer[] {
  const min = now - PEER_FRESH_MS;
  return [...peers.values()]
    .filter((peer) => peer.userId !== selfId && peer.page === page && peer.seenAt >= min)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));
}

export function subscribePeers(listener: () => void) {
  peerListeners.add(listener);
  return () => peerListeners.delete(listener);
}

async function readSse(body: ReadableStream<Uint8Array>, onData: (data: string) => void, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let split = buf.indexOf("\n\n");
      while (split >= 0) {
        const chunk = buf.slice(0, split);
        buf = buf.slice(split + 2);
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) onData(data);
        split = buf.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export function installLiveSync(
  qc: QueryClient,
  getViewer: () => LiveViewer,
  sandboxHeader: () => string | null = () => null
): () => void {
  let stopped = false;
  let generation = 0;
  let abort: AbortController | null = null;
  let reconnect = false;

  const loop = async () => {
    while (!stopped) {
      const ticket = generation;
      abort = new AbortController();
      const viewer = getViewer();
      let opened = false;
      try {
        const headers: Record<string, string> = { Accept: "text/event-stream" };
        const sandboxId = sandboxHeader() ?? viewer.sandboxId;
        if (sandboxId) headers["X-Sandbox-Id"] = sandboxId;
        const res = await fetch("/api/live", {
          credentials: "include",
          headers,
          cache: "no-store",
          signal: abort.signal
        });
        if (!res.ok || !res.body) throw new Error("live");
        opened = true;
        if (reconnect) invalidateLiveSnapshot(qc);
        reconnect = true;
        await readSse(
          res.body,
          (raw) => {
            let signal: LiveSignal;
            try {
              signal = JSON.parse(raw) as LiveSignal;
            } catch {
              return;
            }
            if (!signalVisible(signal, getViewer())) return;
            if (signal.topic === "presence") applyPresence(signal);
            else invalidateLiveSignal(qc, signal);
            window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: signal }));
          },
          abort.signal
        );
      } catch {
        /* обрыв или смена контура */
      }
      if (stopped) return;
      if (ticket !== generation) continue;
      if (opened) invalidateLiveSnapshot(qc);
      await sleep(1500, abort.signal);
    }
  };

  void loop();
  const stopSandbox = onSandboxChange(() => {
    generation += 1;
    abort?.abort();
  });
  return () => {
    stopped = true;
    generation += 1;
    abort?.abort();
    stopSandbox();
  };
}
