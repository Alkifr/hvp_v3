import type { FastifyRequest } from "fastify";

export const LIVE_WINDOW_MS = 400;
export const LIVE_MAX_IDS = 50;

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
export type LiveScope = "prod" | "global" | `sandbox:${string}` | `user:${string}`;

export type LivePresence = {
  userId: string;
  displayName: string;
  page: string;
  eventId: string | null;
};

export type LivePublish = {
  topic: LiveTopic;
  scope: LiveScope;
  ids?: string[];
  bulk?: boolean;
  actorId?: string;
  at?: string;
  presence?: LivePresence;
};

export type LiveSignal = {
  topic: LiveTopic;
  scope: LiveScope;
  bulk?: boolean;
  actorId?: string;
  at: string;
  ids?: string[];
  presence?: LivePresence;
};

type Acc = {
  topic: LiveTopic;
  scope: LiveScope;
  ids: Set<string>;
  bulk: boolean;
  actorId?: string;
};

export function scopeForSandbox(sandboxId: string | null | undefined): "prod" | `sandbox:${string}` {
  return sandboxId ? `sandbox:${sandboxId}` : "prod";
}

export function liveSignalVisible(
  signal: Pick<LiveSignal, "scope">,
  viewer: { sandboxId: string | null; userId: string }
): boolean {
  if (signal.scope === "global") return true;
  if (signal.scope.startsWith("user:")) return signal.scope === `user:${viewer.userId}`;
  const mine = viewer.sandboxId ? `sandbox:${viewer.sandboxId}` : "prod";
  return signal.scope === mine;
}

export function createLiveBus(windowMs = LIVE_WINDOW_MS) {
  const listeners = new Set<(signal: LiveSignal) => void>();
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; acc: Acc }>();

  function emit(signal: LiveSignal) {
    for (const listener of listeners) listener(signal);
  }

  function flushKey(key: string) {
    const row = pending.get(key);
    if (!row) return;
    clearTimeout(row.timer);
    pending.delete(key);
    const tooMany = row.acc.ids.size > LIVE_MAX_IDS;
    const bulk = row.acc.bulk || tooMany;
    const signal: LiveSignal = {
      topic: row.acc.topic,
      scope: row.acc.scope,
      at: new Date().toISOString(),
      ...(row.acc.actorId ? { actorId: row.acc.actorId } : {}),
      ...(bulk ? { bulk: true } : {}),
      ...(!bulk && row.acc.ids.size > 0 ? { ids: [...row.acc.ids] } : {})
    };
    emit(signal);
  }

  return {
    publish(input: LivePublish) {
      if (input.topic === "presence") {
        emit({
          topic: input.topic,
          scope: input.scope,
          at: input.at ?? new Date().toISOString(),
          ...(input.actorId ? { actorId: input.actorId } : {}),
          ...(input.presence ? { presence: input.presence } : {}),
          ...(input.ids && input.ids.length > 0 ? { ids: input.ids.slice(0, LIVE_MAX_IDS) } : {})
        });
        return;
      }
      const key = `${input.scope}\0${input.topic}`;
      let row = pending.get(key);
      if (!row) {
        row = {
          acc: {
            topic: input.topic,
            scope: input.scope,
            ids: new Set(),
            bulk: false,
            actorId: input.actorId
          },
          timer: setTimeout(() => flushKey(key), windowMs)
        };
        pending.set(key, row);
      }
      if (input.bulk || !input.ids || input.ids.length === 0) row.acc.bulk = true;
      for (const id of input.ids ?? []) {
        if (id) row.acc.ids.add(id);
      }
      if (row.acc.ids.size > LIVE_MAX_IDS) row.acc.bulk = true;
      if (input.actorId) row.acc.actorId = input.actorId;
    },
    flush() {
      for (const key of [...pending.keys()]) flushKey(key);
    },
    subscribe(listener: (signal: LiveSignal) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      for (const row of pending.values()) clearTimeout(row.timer);
      pending.clear();
      listeners.clear();
    }
  };
}

export type LiveBus = ReturnType<typeof createLiveBus>;

const bus = createLiveBus();

export function publishLive(input: LivePublish) {
  bus.publish(input);
}

export function subscribeLive(listener: (signal: LiveSignal) => void) {
  return bus.subscribe(listener);
}

declare module "fastify" {
  interface FastifyRequest {
    liveNotes?: LivePublish[];
  }
}

export function noteLive(req: FastifyRequest, input: LivePublish) {
  (req.liveNotes ??= []).push(input);
}

export function noteIds(
  req: FastifyRequest,
  sandboxId: string | null | undefined,
  topics: LiveTopic[],
  ids: string[]
) {
  const scope = scopeForSandbox(sandboxId);
  const actorId = req.auth?.id;
  const clean = ids.filter((id) => id.length > 0);
  for (const topic of topics) noteLive(req, { topic, scope, ids: clean, actorId });
}

export function noteBulk(
  req: FastifyRequest,
  sandboxId: string | null | undefined,
  topics: LiveTopic[] = ["events", "placements", "tows"]
) {
  const scope = scopeForSandbox(sandboxId);
  const actorId = req.auth?.id;
  for (const topic of topics) noteLive(req, { topic, scope, bulk: true, actorId });
}

export function flushRequestLive(req: FastifyRequest) {
  const notes = req.liveNotes;
  req.liveNotes = undefined;
  if (!notes) return;
  for (const note of notes) publishLive(note);
}
