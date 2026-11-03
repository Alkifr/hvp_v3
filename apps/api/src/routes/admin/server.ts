import type { FastifyPluginAsync } from "fastify";

import { collectServerStatus } from "../../lib/serverStatus.js";
import { assertAnyPermission } from "../../lib/rbac.js";

export const serverAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/server", async (req) => {
    assertAnyPermission(req as any, ["admin:users", "admin:roles", "admin:mail", "admin:cleanup"]);
    const status = await collectServerStatus(app.prisma);
    return { ok: true as const, ...status };
  });
};
