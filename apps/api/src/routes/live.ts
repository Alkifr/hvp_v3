import type { FastifyPluginAsync } from "fastify";

import { liveSignalVisible, subscribeLive } from "../lib/liveBus.js";

const HEARTBEAT_MS = 25_000;

export const liveRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req, reply) => {
    const userId = req.auth?.id;
    if (!userId) {
      const err: Error & { statusCode?: number } = new Error("UNAUTHORIZED");
      err.statusCode = 401;
      throw err;
    }

    const viewer = { sandboxId: req.sandbox?.id ?? null, userId };
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const write = (chunk: string) => {
      if (raw.writableEnded || raw.destroyed) return false;
      try {
        raw.write(chunk);
        return true;
      } catch {
        return false;
      }
    };
    write("retry: 3000\n\n");
    write(": ping\n\n");

    const unsubscribe = subscribeLive((signal) => {
      if (!liveSignalVisible(signal, viewer)) return;
      write(`event: live\ndata: ${JSON.stringify(signal)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!write(": ping\n\n")) cleanup();
    }, HEARTBEAT_MS);

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (!raw.writableEnded) raw.end();
    };
    req.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);
  });
};
