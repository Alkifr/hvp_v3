import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { recordPresence } from "../lib/userPresence.js";

export const presenceRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (req) => {
    const userId = (req as any).auth?.id as string | undefined;
    if (!userId) {
      const err: any = new Error("UNAUTHORIZED");
      err.statusCode = 401;
      throw err;
    }

    const body = z
      .object({
        kind: z.enum(["PING", "PAGE", "ACTION"]),
        page: z.string().trim().max(40).optional(),
        detail: z.string().trim().max(160).optional()
      })
      .parse(req.body ?? {});

    const result = await recordPresence(app.prisma, {
      userId,
      kind: body.kind,
      page: body.page,
      detail: body.detail
    });
    return { ok: true as const, recorded: result.recorded };
  });
};
