import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { apiGet, onSandboxChange } from "./api";

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

/** Короткий срок свежести списка: пачка сигналов схлопывается в один запрос. */
export const EVENTS_LIST_STALE_MS = 2_000;
const LIVE_PATCH_MS = 400;

const openEvent = { id: null as string | null };

export function setLiveOpenEventId(id: string | null) {
  openEvent.id = id;
}

export function personnelQueryLive(queryKey: readonly unknown[]): boolean {
  if (queryKey[0] !== "personnel") return false;
  return queryKey[1] !== "plan-archive" && queryKey[1] !== "plan-archives";
}

export type LiveQueryPlan = {
  /** Конкретные события: влить в кэш списка, не сбрасывая весь период. */
  patchEventIds: string[] | null;
  invalidate: QueryKey[];
  personnel: boolean;
};

export function liveQueryPlan(
  signal: Pick<LiveSignal, "topic" | "bulk" | "ids">,
  openEventId: string | null = openEvent.id
): LiveQueryPlan {
  if (signal.topic === "presence") return { patchEventIds: null, invalidate: [], personnel: false };
  if (signal.topic === "personnel") return { patchEventIds: null, invalidate: [], personnel: true };

  const patchEventIds =
    (signal.topic === "events" || signal.topic === "placements") && !signal.bulk && signal.ids && signal.ids.length > 0
      ? signal.ids
      : null;
  const invalidate: QueryKey[] = [];
  for (const queryKey of QUERY_KEYS[signal.topic]) {
    const head = queryKey[0];
    if (head === "event-history" || head === "event-tows") continue;
    if (patchEventIds && head === "events") continue;
    invalidate.push(queryKey);
  }

  const cardTopic = signal.topic === "events" || signal.topic === "placements" || signal.topic === "tows";
  const openId = openEventId ?? "";
  const touchesOpen =
    openId.length > 0 && (signal.bulk || !signal.ids || signal.ids.length === 0 || signal.ids.includes(openId));
  if (cardTopic && touchesOpen) {
    if (signal.topic !== "tows") invalidate.push(["event-history", openId]);
    invalidate.push(["event-tows", openId]);
  }

  return { patchEventIds, invalidate, personnel: false };
}

export function invalidateLiveSignal(
  qc: InvalidateClient,
  signal: Pick<LiveSignal, "topic" | "bulk" | "ids">,
  openEventId: string | null = openEvent.id
) {
  const plan = liveQueryPlan(signal, openEventId);
  if (plan.personnel) {
    void qc.invalidateQueries({
      predicate: (query: { queryKey: readonly unknown[] }) => personnelQueryLive(query.queryKey)
    });
    return;
  }
  for (const queryKey of plan.invalidate) {
    void qc.invalidateQueries({ queryKey });
  }
}

type EventInterval = { startAt?: string | null; endAt?: string | null; actualStartAt?: string | null; actualEndAt?: string | null };

export type CachedEventRow = EventInterval & {
  id: string;
  placements?: EventInterval[] | null;
};

function intervalHits(start: string | null | undefined, end: string | null | undefined, fromMs: number, toMs: number) {
  if (!start || !end) return false;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < toMs && endMs > fromMs;
}

export function eventInListWindow(event: CachedEventRow, fromIso: string, toIso: string): boolean {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return false;
  if (intervalHits(event.startAt, event.endAt, fromMs, toMs)) return true;
  if (intervalHits(event.actualStartAt, event.actualEndAt, fromMs, toMs)) return true;
  for (const placement of event.placements ?? []) {
    if (intervalHits(placement.startAt, placement.endAt, fromMs, toMs)) return true;
    if (intervalHits(placement.actualStartAt, placement.actualEndAt, fromMs, toMs)) return true;
  }
  return false;
}

export function mergeEventList(
  rows: CachedEventRow[],
  updates: Map<string, CachedEventRow | null>,
  fromIso: string,
  toIso: string
): CachedEventRow[] {
  const seen = new Set<string>();
  const next: CachedEventRow[] = [];
  for (const row of rows) {
    seen.add(row.id);
    if (!updates.has(row.id)) {
      next.push(row);
      continue;
    }
    const updated = updates.get(row.id);
    if (!updated || !eventInListWindow(updated, fromIso, toIso)) continue;
    next.push(updated);
  }
  for (const [id, updated] of updates) {
    if (!updated || seen.has(id) || !eventInListWindow(updated, fromIso, toIso)) continue;
    next.push(updated);
  }
  next.sort((a, b) => String(a.startAt ?? "").localeCompare(String(b.startAt ?? "")));
  return next;
}

function eventMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /не найдено|not found|404/i.test(message);
}

export async function patchCachedEvents(
  qc: Pick<QueryClient, "getQueriesData" | "setQueryData">,
  ids: string[],
  load: (id: string) => Promise<CachedEventRow | null> = (id) => apiGet<CachedEventRow>(`/api/events/${encodeURIComponent(id)}`)
) {
  const updates = new Map<string, CachedEventRow | null>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      try {
        const row = await load(id);
        updates.set(id, row?.id ? row : null);
      } catch (error) {
        if (eventMissing(error)) updates.set(id, null);
      }
    })
  );
  if (updates.size === 0) return;
  const entries = qc.getQueriesData<CachedEventRow[]>({ queryKey: ["events"] });
  for (const [key, data] of entries) {
    if (!Array.isArray(data)) continue;
    const fromIso = typeof key[1] === "string" ? key[1] : "";
    const toIso = typeof key[2] === "string" ? key[2] : "";
    if (!fromIso || !toIso) continue;
    qc.setQueryData(key, mergeEventList(data, updates, fromIso, toIso));
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

function scheduleLiveApply(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const patchIds = new Set<string>();
  let bulkEvents = false;
  const invalidate = new Map<string, QueryKey>();
  let personnel = false;

  const flush = () => {
    timer = null;
    const ids = [...patchIds];
    const bulk = bulkEvents;
    const keys = [...invalidate.values()];
    const refreshPersonnel = personnel;
    patchIds.clear();
    bulkEvents = false;
    invalidate.clear();
    personnel = false;
    if (refreshPersonnel) {
      void qc.invalidateQueries({
        predicate: (query) => personnelQueryLive(query.queryKey)
      });
    }
    for (const queryKey of keys) {
      if (bulk && queryKey[0] === "events") continue;
      void qc.invalidateQueries({ queryKey });
    }
    if (bulk) void qc.invalidateQueries({ queryKey: ["events"] });
    else if (ids.length > 0) void patchCachedEvents(qc, ids);
  };

  const apply = (signal: Pick<LiveSignal, "topic" | "bulk" | "ids">) => {
    const plan = liveQueryPlan(signal);
    if (plan.personnel) personnel = true;
    if (plan.patchEventIds) {
      for (const id of plan.patchEventIds) patchIds.add(id);
    }
    for (const queryKey of plan.invalidate) {
      if (queryKey[0] === "events") bulkEvents = true;
      invalidate.set(JSON.stringify(queryKey), queryKey);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, LIVE_PATCH_MS);
  };

  return {
    apply,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      patchIds.clear();
      invalidate.clear();
    }
  };
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
  const liveApply = scheduleLiveApply(qc);

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
            else liveApply.apply(signal);
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
    liveApply.cancel();
    stopSandbox();
  };
}
