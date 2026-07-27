import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zDateTime } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";
import { buildChangeDigest } from "../../lib/changeDigest.js";
import { parseRecipients, sendMail, smtpConfigFromSettings } from "../../lib/mailer.js";

const SETTINGS_ID = "default";

const zEmail = z.string().trim().email().max(200);

const zSettingsPut = z.object({
  smtpHost: z.string().trim().max(200).nullable().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(200).nullable().optional(),
  smtpPass: z.string().max(500).nullable().optional(),
  mailFrom: z.string().trim().max(200).nullable().optional(),
  recipients: z.array(zEmail).max(200).optional(),
  subjectTemplate: z.string().trim().min(1).max(300).optional()
});

function serializeSettings(row: {
  id: string;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  mailFrom: string | null;
  recipients: unknown;
  subjectTemplate: string;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    smtpUser: row.smtpUser,
    hasPassword: Boolean(row.smtpPass && row.smtpPass.length > 0),
    mailFrom: row.mailFrom,
    recipients: parseRecipients(row.recipients),
    subjectTemplate: row.subjectTemplate,
    updatedAt: row.updatedAt
  };
}

async function ensureSettings(prisma: any) {
  return prisma.mailDigestSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {}
  });
}

export const mailDigestRoutes: FastifyPluginAsync = async (app) => {
  app.get("/mail-digest/settings", async (req) => {
    assertPermission(req as any, "admin:mail");
    const row = await ensureSettings(app.prisma);
    return serializeSettings(row);
  });

  app.put("/mail-digest/settings", async (req) => {
    assertPermission(req as any, "admin:mail");
    const body = zSettingsPut.parse(req.body ?? {});
    const existing = await ensureSettings(app.prisma);

    const data: Record<string, unknown> = {};
    if (body.smtpHost !== undefined) data.smtpHost = body.smtpHost?.trim() || null;
    if (body.smtpPort !== undefined) data.smtpPort = body.smtpPort;
    if (body.smtpSecure !== undefined) data.smtpSecure = body.smtpSecure;
    if (body.smtpUser !== undefined) data.smtpUser = body.smtpUser?.trim() || null;
    if (body.mailFrom !== undefined) data.mailFrom = body.mailFrom?.trim() || null;
    if (body.recipients !== undefined) data.recipients = body.recipients.map((e) => e.trim().toLowerCase());
    if (body.subjectTemplate !== undefined) data.subjectTemplate = body.subjectTemplate.trim();
    if (body.smtpPass !== undefined) {
      // пустая строка / null — не менять пароль
      if (body.smtpPass !== null && body.smtpPass.length > 0) data.smtpPass = body.smtpPass;
    }

    const updated = await app.prisma.mailDigestSettings.update({
      where: { id: existing.id },
      data
    });
    return serializeSettings(updated);
  });

  app.post("/mail-digest/preview", async (req) => {
    assertPermission(req as any, "admin:mail");
    const body = z
      .object({
        from: zDateTime,
        to: zDateTime
      })
      .refine((v) => v.to > v.from, { message: "Дата окончания периода должна быть позже даты начала" })
      .parse(req.body ?? {});

    return await buildChangeDigest(app.prisma, { from: body.from, to: body.to });
  });

  app.post("/mail-digest/send", async (req) => {
    assertPermission(req as any, "admin:mail");
    const body = z
      .object({
        from: zDateTime,
        to: zDateTime,
        text: z.string().max(200_000).optional(),
        html: z.string().max(500_000).optional()
      })
      .refine((v) => v.to > v.from, { message: "Дата окончания периода должна быть позже даты начала" })
      .parse(req.body ?? {});

    const settings = await ensureSettings(app.prisma);
    const smtp = smtpConfigFromSettings(settings);
    if (!smtp) throw app.httpErrors.badRequest("Не настроен SMTP host");
    if (!settings.smtpPass) throw app.httpErrors.badRequest("Не задан SMTP пароль");

    const recipients = parseRecipients(settings.recipients);
    if (!recipients.length) throw app.httpErrors.badRequest("Список получателей пуст");

    let text = body.text?.trim() ?? "";
    let html = body.html?.trim() ?? "";
    if (!text || !html) {
      const digest = await buildChangeDigest(app.prisma, { from: body.from, to: body.to });
      if (!text) text = digest.text.trim();
      if (!html) html = digest.html.trim();
    }
    if (!text && !html) throw app.httpErrors.badRequest("Нет изменений за выбранный период — письмо не отправлено");

    try {
      const result = await sendMail(smtp, {
        to: recipients,
        subject: settings.subjectTemplate || "Изменения плана ТО",
        text: text || "См. HTML-версию письма",
        html: html || undefined
      });
      return { ok: true, messageId: result.messageId, recipients, subject: settings.subjectTemplate };
    } catch (e: any) {
      throw app.httpErrors.badRequest(`Ошибка отправки: ${e?.message ?? String(e)}`);
    }
  });

  app.post("/mail-digest/test", async (req) => {
    assertPermission(req as any, "admin:mail");
    const body = z
      .object({
        to: zEmail.optional()
      })
      .parse(req.body ?? {});

    const settings = await ensureSettings(app.prisma);
    const smtp = smtpConfigFromSettings(settings);
    if (!smtp) throw app.httpErrors.badRequest("Не настроен SMTP host");
    if (!settings.smtpPass) throw app.httpErrors.badRequest("Не задан SMTP пароль");

    const recipients = parseRecipients(settings.recipients);
    const to =
      body.to?.trim().toLowerCase() ||
      settings.smtpUser?.trim().toLowerCase() ||
      recipients[0] ||
      null;
    if (!to) throw app.httpErrors.badRequest("Укажите адрес для теста или заполните SMTP user / получателей");

    const text = [
      "Тестовое письмо HVP — email-дайджест изменений.",
      "",
      `Время: ${new Date().toISOString()}`,
      `SMTP: ${smtp.smtpHost}:${smtp.smtpPort} (secure=${smtp.smtpSecure})`
    ].join("\n");

    try {
      const result = await sendMail(smtp, {
        to: [to],
        subject: `[тест] ${settings.subjectTemplate || "Изменения плана ТО"}`,
        text
      });
      return { ok: true, messageId: result.messageId, to };
    } catch (e: any) {
      throw app.httpErrors.badRequest(`Ошибка отправки: ${e?.message ?? String(e)}`);
    }
  });
};
