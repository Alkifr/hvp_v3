import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";

import { prismaPlugin } from "./plugins/prisma.js";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { referenceRoutes } from "./routes/reference/index.js";
import { planningRoutes } from "./routes/planning/index.js";
import { adminRoutes } from "./routes/admin/index.js";
import { resourcesRoutes } from "./routes/resources/index.js";

export async function buildServer() {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  await app.register(sensible);
  await app.register(prismaPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(referenceRoutes, { prefix: "/api/ref" });
  await app.register(planningRoutes, { prefix: "/api" });
  await app.register(resourcesRoutes, { prefix: "/api/resources" });
  await app.register(adminRoutes, { prefix: "/api/admin" });

  return app;
}

