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
  DIGEST_COLUMN_CATALOG,
  DIGEST_COLUMN_KEYS,
  parseDigestColumns
} from "../lib/mailDigestColumns.js";

const SETTINGS_ID = "default";
const zEmail = z.string().trim().email().max(200);
const zYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

function serializeCompose(row: {
  recipients: unknown;
  subjectTemplate: string;
  description: string | null;
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
  smtpHost: string | null;
  smtpPass: string | null;
  mailFrom: string | null;
}) {
  return {
    recipients: parseRecipients(row.recipients),
    subjectTemplate: row.subjectTemplate,
    description: row.description ?? "",
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
    columnCatalog: DIGEST_COLUMN_CATALOG,
    mailFrom: row.mailFrom,
    smtpReady: Boolean(row.smtpHost?.trim() && row.smtpPass)
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

function periodFromBody(body: z.infer<typeof zPeriodBody>, settings: { periodMode: string; periodCustomFrom: string | null; periodCustomTo: string | null }) {
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

export const mailDigestComposeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/compose", async (req) => {
    assertCanCompose(req);
    const row = await ensureSettings(app.prisma);
    return serializeCompose(row);
  });

  app.put("/compose", async (req) => {
    assertCanCompose(req);
    const body = z
      .object({
        recipients: z.array(zEmail).max(200).optional(),
        subjectTemplate: z.string().trim().min(1).max(300).optional(),
        description: z.string().max(2000).nullable().optional(),
        periodMode: z.enum(DIGEST_PERIOD_MODES).optional(),
        periodCustomFrom: zYmd.nullable().optional(),
        periodCustomTo: zYmd.nullable().optional(),
        scheduleMode: z.enum(DIGEST_SCHEDULE_MODES).optional(),
        scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        scheduleWeekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
        scheduleMonthDay: z.number().int().min(1).max(28).optional(),
        isActive: z.boolean().optional(),
        columns: z.array(z.enum(DIGEST_COLUMN_KEYS)).min(1).max(DIGEST_COLUMN_KEYS.length).optional()
      })
      .parse(req.body ?? {});

    const existing = await ensureSettings(app.prisma);
    const scheduleMode = body.scheduleMode ?? parseDigestScheduleMode(existing.scheduleMode);
    const weekdays = body.scheduleWeekdays !== undefined ? parseWeekdays(body.scheduleWeekdays) : parseWeekdays(existing.scheduleWeekdays);
    if (scheduleMode === "weekly" && weekdays.length === 0) {
      throw app.httpErrors.badRequest("Выберите хотя бы один день недели");
    }

    const data: Record<string, unknown> = {};
    if (body.recipients !== undefined) data.recipients = body.recipients.map((e) => e.trim().toLowerCase());
    if (body.subjectTemplate !== undefined) data.subjectTemplate = body.subjectTemplate.trim();
    if (body.description !== undefined) data.description = body.description?.trim() || null;
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

    const updated = await app.prisma.mailDigestSettings.update({
      where: { id: existing.id },
      data
    });
    return serializeCompose(updated);
  });

  app.post("/preview", async (req) => {
    assertCanCompose(req);
    const body = zPeriodBody.parse(req.body ?? {});
    const settings = await ensureSettings(app.prisma);
    let period: { from: Date; to: Date };
    try {
      period = periodFromBody(body, settings);
    } catch (e: any) {
      throw app.httpErrors.badRequest(e?.message || UserMsg.VALIDATION);
    }
    return await buildChangeDigest(app.prisma, {
      ...period,
      columns: body.columns ?? settings.columns
    });
  });

  app.post("/send", async (req) => {
    assertCanCompose(req);
    const body = zPeriodBody
      .extend({
        text: z.string().max(200_000).optional(),
        html: z.string().max(500_000).optional(),
        recipients: z.array(zEmail).max(200).optional(),
        subject: z.string().trim().min(1).max(300).optional(),
        target: z.enum(["self", "all"]).optional()
      })
      .parse(req.body ?? {});

    const settings = await ensureSettings(app.prisma);
    let period: { from: Date; to: Date };
    try {
      period = periodFromBody(body, settings);
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
        : (body.recipients?.length ? body.recipients : parseRecipients(settings.recipients)).map((e) =>
            e.trim().toLowerCase()
          );

    const result = await dispatchChangeDigest(app.prisma, {
      settings,
      from: period.from,
      to: period.to,
      recipients,
      subject: body.subject?.trim() || settings.subjectTemplate,
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

  app.get("/history", async (req) => {
    assertCanCompose(req);
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(req.query ?? {});
    const rows = await app.prisma.mailDigestSendLog.findMany({
      orderBy: { createdAt: "desc" },
      take: q.limit ?? 40
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        target: row.target,
        actorEmail: row.actorEmail,
        recipients: parseRecipients(row.recipients),
        subject: row.subject,
        error: row.error,
        stats: row.stats,
        periodFrom: row.periodFrom?.toISOString() ?? null,
        periodTo: row.periodTo?.toISOString() ?? null
      }))
    };
  });
};
