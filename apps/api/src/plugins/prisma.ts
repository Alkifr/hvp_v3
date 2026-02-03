import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    db: {
      connected: boolean;
      lastError?: string;
    };
  }
}

export const prismaPlugin = fp(async (app) => {
  const prisma = new PrismaClient();

  app.decorate("prisma", prisma);
  app.decorate("db", { connected: false });

  const tryConnect = async () => {
    try {
      await prisma.$connect();
      app.db.connected = true;
      app.db.lastError = undefined;
      app.log.info("PostgreSQL connected");
      return true;
    } catch (e: any) {
      app.db.connected = false;
      app.db.lastError = String(e?.message ?? e);
      app.log.warn({ err: app.db.lastError }, "PostgreSQL not connected (will retry)");
      return false;
    }
  };

  // Первичная попытка без падения процесса (чтобы UI мог подняться и подсказать проблему)
  void tryConnect();

  // Быстрый ретрай в dev/стенде: подключимся как только БД станет доступна
  const interval = setInterval(() => {
    if (app.db.connected) return;
    void tryConnect();
  }, 5000);

  // Если БД недоступна — быстро отвечаем 503 на API, не тратя время на таймауты Prisma.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api")) return;
    if (app.db.connected) return;
    reply.code(503).send({
      ok: false,
      error: "DB_NOT_CONNECTED",
      detail: app.db.lastError ?? "No connection"
    });
  });

  app.addHook("onClose", async (instance) => {
    clearInterval(interval);
    await instance.prisma.$disconnect();
  });
});

