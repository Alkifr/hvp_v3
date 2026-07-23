import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";

import { prismaPlugin } from "./plugins/prisma.js";
import { authPlugin } from "./plugins/auth.js";
import { sandboxPlugin } from "./plugins/sandbox.js";
import { sandboxRoutes } from "./routes/sandboxes.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { referenceRoutes } from "./routes/reference/index.js";
import { planningRoutes } from "./routes/planning/index.js";
import { adminRoutes } from "./routes/admin/index.js";
import { resourcesRoutes } from "./routes/resources/index.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { reportRoutes } from "./routes/reports.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { runEventStatusMaintenance } from "./lib/eventMaintenance.js";

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
  await app.register(sandboxPlugin);

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(referenceRoutes, { prefix: "/api/ref" });
  await app.register(planningRoutes, { prefix: "/api" });
  await app.register(resourcesRoutes, { prefix: "/api/resources" });
  await app.register(analyticsRoutes, { prefix: "/api/analytics" });
  await app.register(reportRoutes, { prefix: "/api/reports" });
  await app.register(notificationsRoutes, { prefix: "/api/notifications" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(sandboxRoutes, { prefix: "/api/sandboxes" });

  // Автостатусы + уведомления о просрочке без факта (раз в минуту)
  let maintenanceBusy = false;
  const maintenanceTimer = setInterval(() => {
    if (!app.db.connected || maintenanceBusy) return;
    maintenanceBusy = true;
    void runEventStatusMaintenance(app)
      .then((r) => {
        if (r.statusUpdated || r.notificationsCreated) {
          app.log.info(r, "event status maintenance");
        }
      })
      .catch((err) => {
        app.db.markDisconnected(err);
        app.log.warn({ err }, "event status maintenance failed");
      })
      .finally(() => {
        maintenanceBusy = false;
      });
  }, 60_000);
  // Первый прогон чуть позже старта
  setTimeout(() => {
    if (!app.db.connected || maintenanceBusy) return;
    maintenanceBusy = true;
    void runEventStatusMaintenance(app)
      .catch((err) => {
        app.db.markDisconnected(err);
        app.log.warn({ err }, "event status maintenance failed");
      })
      .finally(() => {
        maintenanceBusy = false;
      });
  }, 15_000);

  app.addHook("onClose", async () => {
    clearInterval(maintenanceTimer);
  });

  return app;
}

