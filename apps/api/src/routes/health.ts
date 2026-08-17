import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    return { ok: true };
  });

  app.get("/ready", async (_req, reply) => {
    if (!app.db.connected) {
      return reply.code(503).send({ ok: false, connected: false });
    }
    return { ok: true, connected: true };
  });

  app.get("/db", async (_req, reply) => {
    if (!app.db.connected) {
      return reply.code(503).send({ ok: false, connected: false });
    }
    return { ok: true, connected: true };
  });
};

