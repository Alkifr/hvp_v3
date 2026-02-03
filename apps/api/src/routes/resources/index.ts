import type { FastifyPluginAsync } from "fastify";

import { eventResourcesRoutes } from "./event-resources.js";

export const resourcesRoutes: FastifyPluginAsync = async (app) => {
  await app.register(eventResourcesRoutes, { prefix: "/events" });
};

