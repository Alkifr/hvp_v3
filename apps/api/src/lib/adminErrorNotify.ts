import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";

import type { SerializedUserError } from "./userErrors.js";

export const KIND_USER_ERROR = "USER_ERROR";

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function actorLabel(req: FastifyRequest): string {
  const auth = req.auth;
  if (!auth) return "неавторизованный запрос";
  const name = String(auth.displayName ?? "").trim();
  const email = String(auth.email ?? "").trim();
  if (name && email) return `${name} (${email})`;
  return name || email || auth.id;
}

function requestPath(req: FastifyRequest): string {
  const url = String(req.url ?? "").split("?")[0] ?? "";
  return url || "/";
}

function hashDetail(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

/**
 * Пишет в колокольчик уведомление только для администраторов (фильтр по kind на GET).
 * Дедуп: один и тот же пользователь + запрос + текст в окне 5 минут.
 */
export async function notifyAdminsOfUserError(
  app: FastifyInstance,
  req: FastifyRequest,
  payload: SerializedUserError
): Promise<void> {
  if (!payload.notifyAdmins) return;
  if (!app.db?.connected) return;
  const url = requestPath(req);
  if (url.startsWith("/health")) return;

  const method = String(req.method ?? "GET").toUpperCase();
  const userId = req.auth?.id ?? "anon";
  const detail = String(payload.adminDetail ?? payload.message);
  const bucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  const dedupeKey = `user-error:${userId}:${method}:${url}:${payload.statusCode}:${hashDetail(detail)}:${bucket}`;

  const sandboxName = req.sandbox?.name ? `Песочница: ${req.sandbox.name}.` : "Контур: рабочий.";
  const body = [
    `Пользователь: ${actorLabel(req)}.`,
    `Запрос: ${method} ${url} → HTTP ${payload.statusCode}.`,
    sandboxName,
    `Детали: ${detail.slice(0, 400)}`
  ].join(" ");

  try {
    await app.prisma.appNotification.create({
      data: {
        kind: KIND_USER_ERROR,
        title: "Ошибка у пользователя",
        body,
        eventId: null,
        sandboxId: null,
        dedupeKey
      }
    });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") return;
    app.log.warn({ err }, "failed to create admin user-error notification");
  }
}
