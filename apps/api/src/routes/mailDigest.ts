import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zDateTime } from "../lib/zod.js";
import { assertAnyPermission } from "../lib/rbac.js";
import { buildChangeDigest } from "../lib/changeDigest.js";
import { parseRecipients } from "../lib/mailer.js";
import { UserMsg } from "../lib/userErrors.js";
import {
  DIGEST_PERIOD_MODES,
  DIGEST_SCHEDULE_MODES,
  parseDigestPeriodMode,
  parseDigestScheduleMode,
  parseMonthDay,
  parseScheduleTime,
  parseWeekdays,
  resolveDigestPeriod
} from "../lib/mailDigestPeriod.js";
import { dispatchChangeDigest } from "../lib/mailDigestSend.js";
import {
  DEFAULT_DIGEST_COLUMNS,
  DIGEST_COLUMN_CATALOG,
  DIGEST_COLUMN_KEYS,
  parseDigestColumns
} from "../lib/mailDigestColumns.js";

const SETTINGS_ID = "default";
const zEmail = z.string().trim().email().max(200);
const zYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zUuid = z.string().uuid();

function assertCanCompose(req: unknown) {
  assertAnyPermission(req as any, ["mail:send", "admin:mail"]);
}

async function ensureSettings(prisma: any) {
  return prisma.mailDigestSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {}
  });
}

function smtpReadyOf(row: { smtpHost: string | null; smtpPass: string | null }) {
  return Boolean(row.smtpHost?.trim() && row.smtpPass);
}

function serializeVariant(row: {
  id: string;
  name: string;
  subjectTemplate: string;
  description: string | null;
  recipients: unknown;
  periodMode: string;
  periodCustomFrom: string | null;
  periodCustomTo: string | null;
  scheduleMode: string;
  scheduleTime: string;
  scheduleWeekdays: unknown;
  scheduleMonthDay: number;
  isActive: boolean;
  lastAutoSentAt: Date | null;
  columns: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    subjectTemplate: row.subjectTemplate,
    description: row.description ?? "",
    recipients: parseRecipients(row.recipients),
    periodMode: parseDigestPeriodMode(row.periodMode),
    periodCustomFrom: row.periodCustomFrom,
    periodCustomTo: row.periodCustomTo,
    scheduleMode: parseDigestScheduleMode(row.scheduleMode),
    scheduleTime: parseScheduleTime(row.scheduleTime),
    scheduleWeekdays: parseWeekdays(row.scheduleWeekdays),
    scheduleMonthDay: parseMonthDay(row.scheduleMonthDay),
    isActive: row.isActive,
    lastAutoSentAt: row.lastAutoSentAt?.toISOString() ?? null,
    columns: parseDigestColumns(row.columns),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

const zPeriodBody = z.object({
  periodMode: z.enum(DIGEST_PERIOD_MODES).optional(),
  customFrom: zYmd.optional(),
  customTo: zYmd.optional(),
  from: zDateTime.optional(),
  to: zDateTime.optional(),
  columns: z.array(z.enum(DIGEST_COLUMN_KEYS)).min(1).max(DIGEST_COLUMN_KEYS.length).optional()
});

const zVariantWrite = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  subjectTemplate: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  recipients: z.array(zEmail).max(200).optional(),
  periodMode: z.enum(DIGEST_PERIOD_MODES).optional(),
  periodCustomFrom: zYmd.nullable().optional(),
  periodCustomTo: zYmd.nullable().optional(),
  scheduleMode: z.enum(DIGEST_SCHEDULE_MODES).optional(),
  scheduleTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  scheduleWeekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  scheduleMonthDay: z.number().int().min(1).max(28).optional(),
  isActive: z.boolean().optional(),
  columns: z.array(z.enum(DIGEST_COLUMN_KEYS)).min(1).max(DIGEST_COLUMN_KEYS.length).optional()
});

function periodFromBody(
  body: z.infer<typeof zPeriodBody>,
  settings: { periodMode: string; periodCustomFrom: string | null; periodCustomTo: string | null }
) {
  if (body.from && body.to) {
    if (!(body.to > body.from)) throw Object.assign(new Error(UserMsg.END_AFTER_START), { statusCode: 400 });
    return { from: body.from, to: body.to };
  }
  return resolveDigestPeriod({
    periodMode: body.periodMode ?? settings.periodMode,
    customFrom: body.customFrom ?? settings.periodCustomFrom,
    customTo: body.customTo ?? settings.periodCustomTo
  });
}

function serializeLog(row: {
  id: string;
  createdAt: Date;
  variantId: string | null;
  variantName: string | null;
  status: string;
  target: string;
  actorEmail: string | null;
  recipients: unknown;
  subject: string;
  error: string | null;
  stats: unknown;
  periodFrom: Date | null;
  periodTo: Date | null;
}) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    variantId: row.variantId,
    variantName: row.variantName,
    status: row.status,
    target: row.target,
    actorEmail: row.actorEmail,
    recipients: parseRecipients(row.recipients),
    subject: row.subject,
    error: row.error,
    stats: row.stats,
    periodFrom: row.periodFrom?.toISOString() ?? null,
    periodTo: row.periodTo?.toISOString() ?? null
  };
}

async function getVariantOrThrow(app: { prisma: any; httpErrors: { notFound: (m: string) => Error } }, id: string) {
  const row = await app.prisma.mailDigestVariant.findUnique({ where: { id } });
  if (!row) throw app.httpErrors.notFound("Вариант рассылки не найден");
  return row;
}

function defaultVariantName(existingCount: number) {
  return existingCount <= 0 ? "Изменения плана ТО" : `Рассылка ${existingCount + 1}`;
}

export const mailDigestComposeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertCanCompose(req);
    const settings = await ensureSettings(app.prisma);
    const [variants, sentCount] = await Promise.all([
      app.prisma.mailDigestVariant.findMany({
        orderBy: { updatedAt: "desc" },
        include: {
          sendLogs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true, status: true, target: true }
          }
        }
      }),
      app.prisma.mailDigestSendLog.count({ where: { status: "SENT" } })
    ]);

    return {
      smtpReady: smtpReadyOf(settings),
      mailFrom: settings.mailFrom,
      columnCatalog: DIGEST_COLUMN_CATALOG,
      sentCount,
      variants: variants.map((row) => {
        const last = row.sendLogs[0];
        return {
          ...serializeVariant(row),
          lastSendAt: last?.createdAt.toISOString() ?? null,
          lastSendStatus: last?.status ?? null,
          lastSendTarget: last?.target ?? null
        };
      })
    };
  });

  app.post("/", async (req) => {
    assertCanCompose(req);
    const body = zVariantWrite.parse(req.body ?? {});
    const count = await app.prisma.mailDigestVariant.count();
    const scheduleMode = body.scheduleMode ? parseDigestScheduleMode(body.scheduleMode) : "manual";
    const weekdays = body.scheduleWeekdays !== undefined ? parseWeekdays(body.scheduleWeekdays) : [1, 2, 3, 4, 5];
    if (scheduleMode === "weekly" && weekdays.length === 0) {
      throw app.httpErrors.badRequest("Выберите хотя бы один день недели");
    }
    const name = (body.name?.trim() || defaultVariantName(count)).slice(0, 200);
    const created = await app.prisma.mailDigestVariant.create({
      data: {
        name,
        subjectTemplate: (body.subjectTemplate?.trim() || name).slice(0, 300),
        description: body.description?.trim() || null,
        recipients: body.recipients?.map((e) => e.trim().toLowerCase()) ?? [],
        periodMode: scheduleMode !== "manual" && body.periodMode === "custom" ? "last7" : (body.periodMode ?? "last7"),
        periodCustomFrom: body.periodCustomFrom ?? null,
        periodCustomTo: body.periodCustomTo ?? null,
        scheduleMode,
        scheduleTime: body.scheduleTime ?? "09:00",
        scheduleWeekdays: weekdays,
        scheduleMonthDay: body.scheduleMonthDay ?? 1,
        isActive: body.isActive ?? true,
        columns: parseDigestColumns(body.columns ?? DEFAULT_DIGEST_COLUMNS)
      }
    });
    return serializeVariant(created);
  });

  app.get("/history", async (req) => {
    assertCanCompose(req);
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        variantId: zUuid.optional(),
        status: z.enum(["SENT", "FAILED", "EMPTY"]).optional(),
        target: z.enum(["self", "all", "schedule", "manual"]).optional()
      })
      .parse(req.query ?? {});
    const rows = await app.prisma.mailDigestSendLog.findMany({
      where: {
        ...(q.variantId ? { variantId: q.variantId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.target === "manual"
          ? { target: { in: ["self", "all"] } }
          : q.target
            ? { target: q.target }
            : {})
      },
      orderBy: { createdAt: "desc" },
      take: q.limit ?? 80
    });
    return { items: rows.map(serializeLog) };
  });

  app.get("/:id", async (req) => {
    assertCanCompose(req);
    const { id } = z.object({ id: zUuid }).parse(req.params);
    const row = await getVariantOrThrow(app, id);
    const settings = await ensureSettings(app.prisma);
    return {
      ...serializeVariant(row),
      columnCatalog: DIGEST_COLUMN_CATALOG,
      mailFrom: settings.mailFrom,
      smtpReady: smtpReadyOf(settings)
    };
  });

  app.put("/:id", async (req) => {
    assertCanCompose(req);
    const { id } = z.object({ id: zUuid }).parse(req.params);
    const body = zVariantWrite.parse(req.body ?? {});
    const existing = await getVariantOrThrow(app, id);
    const scheduleMode = body.scheduleMode ?? parseDigestScheduleMode(existing.scheduleMode);
    const weekdays =
      body.scheduleWeekdays !== undefined ? parseWeekdays(body.scheduleWeekdays) : parseWeekdays(existing.scheduleWeekdays);
    if (scheduleMode === "weekly" && weekdays.length === 0) {
      throw app.httpErrors.badRequest("Выберите хотя бы один день недели");
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.subjectTemplate !== undefined) data.subjectTemplate = body.subjectTemplate.trim();
    if (body.description !== undefined) data.description = body.description?.trim() || null;
    if (body.recipients !== undefined) data.recipients = body.recipients.map((e) => e.trim().toLowerCase());
    if (body.periodMode !== undefined) {
      data.periodMode = scheduleMode !== "manual" && body.periodMode === "custom" ? "last7" : body.periodMode;
    }
    if (body.periodCustomFrom !== undefined) data.periodCustomFrom = body.periodCustomFrom;
    if (body.periodCustomTo !== undefined) data.periodCustomTo = body.periodCustomTo;
    if (body.scheduleMode !== undefined) data.scheduleMode = body.scheduleMode;
    if (body.scheduleTime !== undefined) data.scheduleTime = body.scheduleTime;
    if (body.scheduleWeekdays !== undefined) data.scheduleWeekdays = weekdays;
    if (body.scheduleMonthDay !== undefined) data.scheduleMonthDay = body.scheduleMonthDay;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.columns !== undefined) data.columns = parseDigestColumns(body.columns);

    const updated = await app.prisma.mailDigestVariant.update({ where: { id: existing.id }, data });
    return serializeVariant(updated);
  });

  app.delete("/:id", async (req) => {
    assertCanCompose(req);
    const { id } = z.object({ id: zUuid }).parse(req.params);
    await getVariantOrThrow(app, id);
    await app.prisma.mailDigestVariant.delete({ where: { id } });
    return { ok: true as const };
  });

  app.post("/:id/preview", async (req) => {
    assertCanCompose(req);
    const { id } = z.object({ id: zUuid }).parse(req.params);
    const body = zPeriodBody.parse(req.body ?? {});
    const variant = await getVariantOrThrow(app, id);
    let period: { from: Date; to: Date };
    try {
      period = periodFromBody(body, variant);
    } catch (e: any) {
      throw app.httpErrors.badRequest(e?.message || UserMsg.VALIDATION);
    }
    return await buildChangeDigest(app.prisma, {
      ...period,
      columns: body.columns ?? variant.columns
    });
  });

  app.post("/:id/send", async (req) => {
    assertCanCompose(req);
    const { id } = z.object({ id: zUuid }).parse(req.params);
    const body = zPeriodBody
      .extend({
        text: z.string().max(200_000).optional(),
        html: z.string().max(500_000).optional(),
        recipients: z.array(zEmail).max(200).optional(),
        subject: z.string().trim().min(1).max(300).optional(),
        target: z.enum(["self", "all"]).optional()
      })
      .parse(req.body ?? {});

    const variant = await getVariantOrThrow(app, id);
    const settings = await ensureSettings(app.prisma);
    let period: { from: Date; to: Date };
    try {
      period = periodFromBody(body, variant);
    } catch (e: any) {
      throw app.httpErrors.badRequest(e?.message || UserMsg.VALIDATION);
    }

    const target = body.target ?? "all";
    const selfEmail = req.auth?.email?.trim().toLowerCase() || "";
    const recipients =
      target === "self"
        ? selfEmail
          ? [selfEmail]
          : []
        : (body.recipients?.length ? body.recipients : parseRecipients(variant.recipients)).map((e) => e.trim().toLowerCase());

    const result = await dispatchChangeDigest(app.prisma, {
      smtp: settings,
      variant,
      from: period.from,
      to: period.to,
      recipients,
      subject: body.subject?.trim() || variant.subjectTemplate || variant.name,
      text: body.text,
      html: body.html,
      columns: body.columns,
      target,
      actorEmail: req.auth?.email ?? null
    });

    if (!result.ok) {
      throw app.httpErrors.badRequest(result.error || "Не удалось отправить письмо");
    }
    return { ok: true as const, messageId: result.messageId, recipients: result.recipients, subject: result.subject };
  });
};
