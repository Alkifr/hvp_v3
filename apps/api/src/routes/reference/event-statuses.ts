import type { FastifyPluginAsync } from "fastify";

import { assertPermission } from "../../lib/rbac.js";
import { EVENT_STATUS_CATALOG } from "../../lib/eventStatusCatalog.js";

export const eventStatusesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    return EVENT_STATUS_CATALOG.map((item) => ({
      code: item.code,
      name: item.name,
      sortOrder: item.sortOrder,
      selectable: item.selectable,
      manualOnly: item.manualOnly,
      allowsAutoInProgress: item.allowsAutoInProgress,
      isSystem: item.code === "DELETED"
    }));
  });
};
