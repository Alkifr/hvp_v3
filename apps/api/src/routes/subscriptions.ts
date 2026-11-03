import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { parseRecipients } from "../lib/mailer.js";
import { assertAnyPermission } from "../lib/rbac.js";

const zUuid = z.string().uuid();

function requireUser(req: { auth?: { id?: string; email?: string } }) {
  const id = req.auth?.id;
  const email = req.auth?.email?.trim().toLowerCase() ?? "";
  if (!id || !email) {
    const err: any = new Error("UNAUTHORIZED");
    err.statusCode = 401;
    throw err;
  }
  return { id, email };
}

function canWatchEvents(req: any) {
  try {
    assertAnyPermission(req, ["events:read", "gantt:read", "hangar:read"]);
    return true;
  } catch {
    return false;
  }
}

const SCHEDULE_LABEL: Record<string, string> = {
  manual: "вручную",
  daily: "каждый день",
  weekly: "каждую неделю",
  monthly: "каждый месяц"
};

async function mailingRows(prisma: any, email: string) {
  const variants = await prisma.mailDigestVariant.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, scheduleMode: true, isActive: true, recipients: true }
  });
  return variants
    .filter((row: { recipients: unknown }) => parseRecipients(row.recipients).includes(email))
    .map((row: { id: string; name: string; scheduleMode: string; isActive: boolean }) => ({
      id: row.id,
      name: row.name,
      scheduleMode: row.scheduleMode,
      scheduleLabel: SCHEDULE_LABEL[row.scheduleMode] ?? row.scheduleMode,
      isActive: row.isActive
    }));
}

async function removeEmailFromVariant(prisma: any, variantId: string, email: string) {
  const row = await prisma.mailDigestVariant.findUnique({
    where: { id: variantId },
    select: { id: true, recipients: true }
  });
  if (!row) return false;
  const recipients = parseRecipients(row.recipients);
  if (!recipients.includes(email)) return false;
  await prisma.mailDigestVariant.update({
    where: { id: variantId },
    data: { recipients: recipients.filter((item: string) => item !== email) }
  });
  return true;
}

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const user = requireUser(req);
    const [mailings, watches] = await Promise.all([
      mailingRows(app.prisma, user.email),
      canWatchEvents(req)
        ? app.prisma.eventChangeSubscription.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            select: {
              eventId: true,
              createdAt: true,
              event: {
                select: {
                  id: true,
                  title: true,
                  startAt: true,
                  endAt: true,
                  sandboxId: true,
                  aircraft: { select: { tailNumber: true } },
                  sandbox: { select: { name: true } }
                }
              }
            }
          })
        : Promise.resolve([])
    ]);

    return {
      mailings,
      events: watches.map((row) => ({
        eventId: row.eventId,
        title: row.event.title,
        aircraftTail: row.event.aircraft?.tailNumber ?? null,
        startAt: row.event.startAt.toISOString(),
        endAt: row.event.endAt.toISOString(),
        sandboxId: row.event.sandboxId,
        sandboxName: row.event.sandbox?.name ?? null,
        createdAt: row.createdAt.toISOString()
      }))
    };
  });

  app.get("/events", async (req) => {
    const user = requireUser(req);
    if (!canWatchEvents(req)) return { eventIds: [] as string[] };
    const rows = await app.prisma.eventChangeSubscription.findMany({
      where: { userId: user.id },
      select: { eventId: true }
    });
    return { eventIds: rows.map((row) => row.eventId) };
  });

  app.post("/events/:eventId", async (req) => {
    const user = requireUser(req);
    assertAnyPermission(req as any, ["events:read", "gantt:read", "hangar:read"]);
    const { eventId } = z.object({ eventId: zUuid }).parse(req.params);
    const event = await app.prisma.maintenanceEvent.findUnique({
      where: { id: eventId },
      select: { id: true }
    });
    if (!event) throw app.httpErrors.notFound("Событие не найдено");
    await app.prisma.eventChangeSubscription.upsert({
      where: { userId_eventId: { userId: user.id, eventId } },
      create: { userId: user.id, eventId },
      update: {}
    });
    return { ok: true as const, eventId, subscribed: true };
  });

  app.delete("/events/:eventId", async (req) => {
    const user = requireUser(req);
    const { eventId } = z.object({ eventId: zUuid }).parse(req.params);
    await app.prisma.eventChangeSubscription.deleteMany({ where: { userId: user.id, eventId } });
    return { ok: true as const, eventId, subscribed: false };
  });

  app.delete("/events", async (req) => {
    const user = requireUser(req);
    const result = await app.prisma.eventChangeSubscription.deleteMany({ where: { userId: user.id } });
    return { ok: true as const, removed: result.count };
  });

  app.delete("/mailings/:variantId", async (req) => {
    const user = requireUser(req);
    const { variantId } = z.object({ variantId: zUuid }).parse(req.params);
    const removed = await removeEmailFromVariant(app.prisma, variantId, user.email);
    if (!removed) throw app.httpErrors.notFound("Вы не состоите в этой рассылке");
    return { ok: true as const };
  });

  app.delete("/mailings", async (req) => {
    const user = requireUser(req);
    const mailings = await mailingRows(app.prisma, user.email);
    for (const row of mailings) {
      await removeEmailFromVariant(app.prisma, row.id, user.email);
    }
    return { ok: true as const, removed: mailings.length };
  });

  app.delete("/", async (req) => {
    const user = requireUser(req);
    const mailings = await mailingRows(app.prisma, user.email);
    for (const row of mailings) {
      await removeEmailFromVariant(app.prisma, row.id, user.email);
    }
    const events = await app.prisma.eventChangeSubscription.deleteMany({ where: { userId: user.id } });
    return { ok: true as const, mailingsRemoved: mailings.length, eventsRemoved: events.count };
  });
};
