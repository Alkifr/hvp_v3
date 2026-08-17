import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { assertPermission } from "../../lib/rbac.js";
import { sendMail, smtpConfigFromSettings } from "../../lib/mailer.js";

const SETTINGS_ID = "default";

const zEmail = z.string().trim().email().max(200);

const zSettingsPut = z.object({
  smtpHost: z.string().trim().max(200).nullable().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(200).nullable().optional(),
  smtpPass: z.string().max(500).nullable().optional(),
  mailFrom: z.string().trim().max(200).nullable().optional()
});

function serializeSettings(row: {
  id: string;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  mailFrom: string | null;
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

    const to = body.to?.trim().toLowerCase() || settings.smtpUser?.trim().toLowerCase() || null;
    if (!to) throw app.httpErrors.badRequest("Укажите адрес для теста или заполните SMTP user");

    const text = [
      "Тестовое письмо HVP — проверка SMTP для рассылки.",
      "",
      `Время: ${new Date().toISOString()}`,
      `SMTP: ${smtp.smtpHost}:${smtp.smtpPort} (secure=${smtp.smtpSecure})`
    ].join("\n");

    try {
      const result = await sendMail(smtp, {
        to: [to],
        subject: "[тест] SMTP HVP",
        text
      });
      return { ok: true, messageId: result.messageId, to };
    } catch (e: any) {
      throw app.httpErrors.badRequest(`Ошибка отправки: ${e?.message ?? String(e)}`);
    }
  });
};
