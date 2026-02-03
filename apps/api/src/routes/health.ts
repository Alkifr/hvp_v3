import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    return { ok: true };
  });

  app.get("/db", async () => {
    return { ok: app.db.connected, connected: app.db.connected, lastError: app.db.lastError };
  });
};

