import fp from "fastify-plugin";
import { Prisma, PrismaClient } from "@prisma/client";

import { bindEventWatchMail, enqueueEventAuditMails, notesFromAuditWrite } from "../lib/eventWatchMail.js";
import { errorBody } from "../lib/userErrors.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    db: {
      connected: boolean;
      lastError?: string;
      /** Пометить БД недоступной (включает ретрай $connect). */
      markDisconnected: (err?: unknown) => void;
    };
  }
}

const CONNECTION_ERROR_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database server reached but timed out
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
  "P2024" // Timed out fetching a new connection from the pool
]);

export function isDbConnectionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return CONNECTION_ERROR_CODES.has(err.code);
  }
  const msg = String((err as any)?.message ?? err);
  return /Can't reach database server|Server has closed the connection|Connection reset|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Engine is not yet connected/i.test(
    msg
  );
}

export const prismaPlugin = fp(async (app) => {
  let markDisconnected: (err?: unknown) => void = () => undefined;
  let inflight = 0;

  const attach = (base: PrismaClient) => {
    bindEventWatchMail({ prisma: base, log: app.log });
    return base.$extends({
      query: {
        $allOperations: async ({ model, operation, args, query }) => {
          inflight += 1;
          try {
            const result = await query(args);
            if (model === "MaintenanceEventAudit" && (operation === "create" || operation === "createMany")) {
              const notes = notesFromAuditWrite(operation, args as { data?: unknown }, result);
              if (notes.length) enqueueEventAuditMails(notes);
            }
            return result;
          } catch (e) {
            if (isDbConnectionError(e)) markDisconnected(e);
            throw e;
          } finally {
            inflight -= 1;
          }
        }
      }
    }) as unknown as PrismaClient;
  };

  // Ловим обрыв на любом запросе — иначе connected=true «залипает» после P1001
  let prisma = attach(new PrismaClient());

  markDisconnected = (err?: unknown) => {
    if (err != null && !isDbConnectionError(err)) return;
    const detail = err != null ? String((err as any)?.message ?? err) : app.db.lastError;
    if (app.db.connected === false && app.db.lastError === detail) return;
    app.db.connected = false;
    app.db.lastError = detail;
    app.log.warn({ err: detail }, "PostgreSQL marked disconnected (will retry)");
  };

  app.decorate("prisma", prisma);
  app.decorate("db", {
    connected: false as boolean,
    lastError: undefined as string | undefined,
    markDisconnected
  });

  let connectInFlight = false;
  const tryConnect = async () => {
    if (connectInFlight) return false;
    connectInFlight = true;
    try {
      const stuck = /Engine is not yet connected/i.test(app.db.lastError ?? "");
      if (stuck && inflight === 0) {
        const previous = prisma;
        prisma = attach(new PrismaClient());
        app.prisma = prisma;
        await previous.$disconnect().catch(() => undefined);
      } else if (inflight === 0) {
        // Сброс пула после обрыва, иначе мёртвые сокеты могут висеть.
        // $disconnect во время чужого запроса оставляет движок в
        // "Engine is not yet connected" навсегда, поэтому ждём тишины.
        await prisma.$disconnect().catch(() => undefined);
      }
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      app.db.connected = true;
      app.db.lastError = undefined;
      app.log.info("PostgreSQL connected");
      return true;
    } catch (e: any) {
      app.db.connected = false;
      app.db.lastError = String(e?.message ?? e);
      app.log.warn({ err: app.db.lastError }, "PostgreSQL not connected (will retry)");
      return false;
    } finally {
      connectInFlight = false;
    }
  };

  // Первичная попытка без падения процесса (чтобы UI мог подняться и подсказать проблему)
  void tryConnect();

  // Быстрый ретрай: подключимся как только БД станет доступна
  const interval = setInterval(() => {
    if (app.db.connected || connectInFlight) return;
    void tryConnect();
  }, 5000);

  // Если БД недоступна — быстро отвечаем 503 на API, не тратя время на таймауты Prisma.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api")) return;
    if (app.db.connected) return;
    reply.code(503).send(errorBody("DB_NOT_CONNECTED"));
  });

  app.addHook("onClose", async (instance) => {
    clearInterval(interval);
    await instance.prisma.$disconnect();
  });
});
