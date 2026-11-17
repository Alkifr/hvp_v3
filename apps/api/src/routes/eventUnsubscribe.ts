import type { FastifyPluginAsync } from "fastify";

import { resolveJwtSecret } from "../lib/bootEnv.js";
import { readEventUnsubscribe, unsubscribeNoticeHtml } from "../lib/eventWatchMail.js";

function page(title: string, text: string) {
  return unsubscribeNoticeHtml({ title, text });
}

export const eventUnsubscribeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/unsubscribe/event", async (req, reply) => {
    const token = typeof (req.query as { token?: unknown }).token === "string" ? (req.query as { token: string }).token : "";
    const parsed = readEventUnsubscribe(token, resolveJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV ?? "development"));
    reply.type("text/html; charset=utf-8");
    if (!parsed) {
      return reply.code(400).send(page("Ссылка недействительна", "Отписаться можно в профиле, вкладка «Подписки»."));
    }

    const event = await app.prisma.maintenanceEvent.findUnique({
      where: { id: parsed.eventId },
      select: { title: true, aircraft: { select: { tailNumber: true } } }
    });
    const label = [event?.aircraft?.tailNumber?.trim(), event?.title?.trim()].filter(Boolean).join(" · ") || "этого события";
    const removed = await app.prisma.eventChangeSubscription.deleteMany({
      where: { userId: parsed.userId, eventId: parsed.eventId }
    });
    if (removed.count === 0) {
      return reply.send(page("Подписка уже отменена", `Письма об изменениях «${label}» вам не приходят.`));
    }
    return reply.send(page("Подписка отменена", `Вы больше не будете получать письма об изменениях «${label}».`));
  });
};
