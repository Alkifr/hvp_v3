import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";

import { parseCorsOrigins } from "./lib/bootEnv.js";

import { prismaPlugin } from "./plugins/prisma.js";
import { authPlugin } from "./plugins/auth.js";
import { sandboxPlugin } from "./plugins/sandbox.js";
import { errorHandlerPlugin } from "./plugins/errorHandler.js";
import { registerWebStatic } from "./plugins/webStatic.js";
import { sandboxRoutes } from "./routes/sandboxes.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { referenceRoutes } from "./routes/reference/index.js";
import { planningRoutes } from "./routes/planning/index.js";
import { adminRoutes } from "./routes/admin/index.js";
import { resourcesRoutes } from "./routes/resources/index.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { reportRoutes } from "./routes/reports.js";
import { primaryTableRoutes } from "./routes/primaryTable.js";
import { tableViewRoutes } from "./routes/tableViews.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { presenceRoutes } from "./routes/presence.js";
import { mailDigestComposeRoutes } from "./routes/mailDigest.js";
import { runEventStatusMaintenance } from "./lib/eventMaintenance.js";
import { runScheduledMailDigest } from "./lib/mailDigestSend.js";
import { prunePresenceEvents } from "./lib/userPresence.js";

export async function buildServer() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    // Импорт событий/справочников шлёт JSON на сотни–тысячи строк; дефолт Fastify — 1 MiB.
    bodyLimit: 10 * 1024 * 1024
  });

  await app.register(cors, {
    origin: parseCorsOrigins(process.env.CORS_ORIGINS, process.env.NODE_ENV ?? "development"),
    credentials: true
  });

  await app.register(sensible);
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(sandboxPlugin);
  await app.register(errorHandlerPlugin);

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(referenceRoutes, { prefix: "/api/ref" });
  await app.register(planningRoutes, { prefix: "/api" });
  await app.register(resourcesRoutes, { prefix: "/api/resources" });
  await app.register(analyticsRoutes, { prefix: "/api/analytics" });
  await app.register(primaryTableRoutes, { prefix: "/api/analytics/primary-table" });
  await app.register(reportRoutes, { prefix: "/api/reports" });
  await app.register(tableViewRoutes, { prefix: "/api/table-views" });
  await app.register(notificationsRoutes, { prefix: "/api/notifications" });
  await app.register(presenceRoutes, { prefix: "/api/presence" });
  await app.register(mailDigestComposeRoutes, { prefix: "/api/mail-digest" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(sandboxRoutes, { prefix: "/api/sandboxes" });
  const webRoot = await registerWebStatic(app);
  if (!webRoot) {
    app.log.info("WEB_DIST not found — API-only (в dev фронт на Vite :3000)");
  }

  // Автостатусы + уведомления о просрочке без факта (раз в минуту)
  let maintenanceBusy = false;
  let lastPresencePruneAt = 0;
  const maintenanceTimer = setInterval(() => {
    if (!app.db.connected || maintenanceBusy) return;
    maintenanceBusy = true;
    void runEventStatusMaintenance(app)
      .then(async (r) => {
        if (r.statusUpdated || r.notificationsCreated) {
          app.log.info(r, "event status maintenance");
        }
        if (Date.now() - lastPresencePruneAt > 24 * 60 * 60 * 1000) {
          lastPresencePruneAt = Date.now();
          const pruned = await prunePresenceEvents(app.prisma);
          if (pruned) app.log.info({ pruned }, "presence events pruned");
        }
        try {
          await runScheduledMailDigest(app);
        } catch (err) {
          app.log.warn({ err }, "mail digest scheduled send failed");
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

