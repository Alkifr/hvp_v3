import type { FastifyPluginAsync } from "fastify";

import { eventsRoutes } from "./events.js";
import { reservationsRoutes } from "./reservations.js";
import { massPlanningRoutes } from "./mass.js";

export const planningRoutes: FastifyPluginAsync = async (app) => {
  await app.register(eventsRoutes, { prefix: "/events" });
  await app.register(reservationsRoutes, { prefix: "/reservations" });
  await app.register(massPlanningRoutes, { prefix: "/mass" });
};

