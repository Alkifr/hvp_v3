import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

import { resolveWebDist } from "../lib/webDist.js";

function isApiOrHealth(url: string): boolean {
  return url.startsWith("/api") || url.startsWith("/health");
}

export async function registerWebStatic(app: FastifyInstance): Promise<string | null> {
  const root = resolveWebDist();
  if (!root) return null;

  await app.register(fastifyStatic, {
    root,
    index: ["index.html"],
    wildcard: false,
    prefix: "/"
  });

  app.setNotFoundHandler((req, reply) => {
    const url = String(req.raw.url ?? "").split("?")[0] ?? "";
    if (isApiOrHealth(url)) {
      return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
    }
    return reply.sendFile("index.html");
  });

  app.log.info({ root: path.resolve(root) }, "serving web UI from dist");
  return root;
}
