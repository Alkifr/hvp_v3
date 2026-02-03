import type { FastifyPluginAsync } from "fastify";

import { eventsRoutes } from "./events.js";
import { reservationsRoutes } from "./reservations.js";

export const planningRoutes: FastifyPluginAsync = async (app) => {
  await app.register(eventsRoutes, { prefix: "/events" });
  await app.register(reservationsRoutes, { prefix: "/reservations" });
};

