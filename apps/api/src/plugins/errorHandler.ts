import fp from "fastify-plugin";

import { notifyAdminsOfUserError } from "../lib/adminErrorNotify.js";
import { serializeUserError } from "../lib/userErrors.js";

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error, req, reply) => {
    const payload = serializeUserError(error);
    if (payload.statusCode >= 500) {
      app.log.error({ err: error, url: req.url, method: req.method }, "unhandled request error");
    }

    if (payload.notifyAdmins) {
      void notifyAdminsOfUserError(app, req, payload);
    }

    if (reply.sent) return;
    reply.code(payload.statusCode).send({
      ok: false,
      error: payload.code,
      message: payload.message
    });
  });
});
