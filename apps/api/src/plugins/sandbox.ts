import fp from "fastify-plugin";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type SandboxContext = {
  id: string;
  name: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
  canWrite: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    sandbox?: SandboxContext;
  }
}

const HEADER = "x-sandbox-id";

function readSandboxHeader(req: FastifyRequest): string {
  const raw = req.headers[HEADER];
  const headerValue = Array.isArray(raw) ? raw[0] : raw;
  return typeof headerValue === "string" ? headerValue.trim() : "";
}

async function resolveSandboxFor(
  app: FastifyInstance,
  sandboxId: string,
  userId: string
): Promise<SandboxContext | null | "denied"> {
  const sandbox = await app.prisma.sandbox.findUnique({
    where: { id: sandboxId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      members: { where: { userId }, select: { role: true } }
    }
  });
  if (!sandbox) return null;

  let role: SandboxContext["role"] | null = null;
  if (sandbox.ownerId === userId) {
    role = "OWNER";
  } else if (sandbox.members[0]) {
    role = sandbox.members[0].role as SandboxContext["role"];
  }
  if (!role) return "denied";

  return {
    id: sandbox.id,
    name: sandbox.name,
    role,
    canWrite: role === "OWNER" || role === "EDITOR"
  };
}

/**
 * Плагин sandbox: читает заголовок X-Sandbox-Id, проверяет членство текущего пользователя
 * и подвешивает req.sandbox = { id, name, role, canWrite }. Если заголовок есть, но доступа нет — 403.
 * Если заголовка нет — req.sandbox остаётся undefined (рабочий контур).
 *
 * Регистрируется ПОСЛЕ authPlugin. Маршруты /api/auth/* пропускаются: они должны вызывать
 * loadSandboxForRequest() вручную после собственной проверки авторизации.
 */
export const sandboxPlugin = fp(async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api")) return;
    if (req.url.startsWith("/api/auth/")) return;
    if (!req.auth) return;

    const sandboxId = readSandboxHeader(req);
    if (!sandboxId) return;

    const ctx = await resolveSandboxFor(app, sandboxId, req.auth.id);
    if (ctx === null) {
      return reply.code(404).send({ ok: false, error: "SANDBOX_NOT_FOUND" });
    }
    if (ctx === "denied") {
      return reply.code(403).send({ ok: false, error: "SANDBOX_ACCESS_DENIED" });
    }
    req.sandbox = ctx;
  });
});

/**
 * Ручная подгрузка sandbox-контекста (для маршрутов, которые обходят preHandler, например /api/auth/*).
 * Возвращает true, если можно продолжать, false — если отправили ошибочный ответ.
 */
export async function loadSandboxForRequest(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string
): Promise<boolean> {
  const sandboxId = readSandboxHeader(req);
  if (!sandboxId) return true;
  const ctx = await resolveSandboxFor(app, sandboxId, userId);
  if (ctx === null) {
    reply.code(404).send({ ok: false, error: "SANDBOX_NOT_FOUND" });
    return false;
  }
  if (ctx === "denied") {
    reply.code(403).send({ ok: false, error: "SANDBOX_ACCESS_DENIED" });
    return false;
  }
  req.sandbox = ctx;
  return true;
}

/**
 * Возвращает { sandboxId: null } для рабочего контура или { sandboxId: <id> } для песочницы.
 * Подставлять в where: prisma.maintenanceEvent.findMany({ where: { ...sandboxFilter(req), ... } })
 */
export function sandboxFilter(req: FastifyRequest): { sandboxId: string | null } {
  return { sandboxId: req.sandbox?.id ?? null };
}

/** Возвращает sandboxId или null — чтобы записать в create-данные. */
export function sandboxIdFor(req: FastifyRequest): string | null {
  return req.sandbox?.id ?? null;
}

/**
 * Проверка права на запись в активном контексте:
 * - в рабочем контуре — всегда true (права уже проверены через permissions)
 * - в песочнице — только OWNER/EDITOR
 */
export function canWriteInContext(req: FastifyRequest): boolean {
  if (!req.sandbox) return true;
  return req.sandbox.canWrite;
}
