import type { PrismaClient } from "@prisma/client";

import { buildChangeDigest, type ChangeDigestStats } from "./changeDigest.js";
import { isScheduledDigestDue, parseDigestPeriodMode, resolveDigestPeriod } from "./mailDigestPeriod.js";
import { parseRecipients, sendMail, smtpConfigFromSettings } from "./mailer.js";

export type DigestSendTarget = "self" | "all" | "schedule";
export type DigestSendStatus = "SENT" | "FAILED" | "EMPTY";

type DigestSettingsRow = {
  id: string;
  recipients: unknown;
  subjectTemplate: string;
  periodMode: string;
  periodCustomFrom: string | null;
  periodCustomTo: string | null;
  scheduleMode: string;
  scheduleTime: string;
  scheduleWeekdays: unknown;
  scheduleMonthDay: number;
  isActive: boolean;
  lastAutoSentAt: Date | null;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  mailFrom: string | null;
  columns?: unknown;
};

export type DigestDispatchResult = {
  ok: boolean;
  status: DigestSendStatus;
  messageId: string | null;
  recipients: string[];
  subject: string;
  error: string | null;
};

async function writeLog(
  prisma: PrismaClient,
  row: {
    status: DigestSendStatus;
    target: DigestSendTarget;
    actorEmail?: string | null;
    recipients: string[];
    subject: string;
    error?: string | null;
    stats?: ChangeDigestStats | null;
    periodFrom: Date;
    periodTo: Date;
  }
) {
  await prisma.mailDigestSendLog.create({
    data: {
      status: row.status,
      target: row.target,
      actorEmail: row.actorEmail ?? null,
      recipients: row.recipients,
      subject: row.subject,
      error: row.error ?? null,
      stats: row.stats ?? undefined,
      periodFrom: row.periodFrom,
      periodTo: row.periodTo
    }
  });
}

export async function dispatchChangeDigest(
  prisma: PrismaClient,
  params: {
    settings: DigestSettingsRow;
    from: Date;
    to: Date;
    recipients: string[];
    subject: string;
    text?: string;
    html?: string;
    columns?: unknown;
    target: DigestSendTarget;
    actorEmail?: string | null;
  }
): Promise<DigestDispatchResult> {
  const subject = params.subject.trim() || params.settings.subjectTemplate || "Изменения плана ТО";
  const recipients = params.recipients.map((e) => e.trim().toLowerCase()).filter(Boolean);

  if (!recipients.length) {
    await writeLog(prisma, {
      status: "FAILED",
      target: params.target,
      actorEmail: params.actorEmail,
      recipients,
      subject,
      error: "Список получателей пуст",
      periodFrom: params.from,
      periodTo: params.to
    });
    return { ok: false, status: "FAILED", messageId: null, recipients, subject, error: "Список получателей пуст" };
  }

  const smtp = smtpConfigFromSettings(params.settings);
  if (!smtp || !params.settings.smtpPass) {
    const error = "Почта не настроена. Обратитесь к администратору.";
    await writeLog(prisma, {
      status: "FAILED",
      target: params.target,
      actorEmail: params.actorEmail,
      recipients,
      subject,
      error,
      periodFrom: params.from,
      periodTo: params.to
    });
    return { ok: false, status: "FAILED", messageId: null, recipients, subject, error };
  }

  let text = params.text?.trim() ?? "";
  let html = params.html?.trim() ?? "";
  let stats: ChangeDigestStats | null = null;
  if (!text || !html) {
    const digest = await buildChangeDigest(prisma, {
      from: params.from,
      to: params.to,
      columns: params.columns ?? params.settings.columns
    });
    stats = digest.stats;
    if (!text) text = digest.text.trim();
    if (!html) html = digest.html.trim();
  }
  if (!text && !html) {
    await writeLog(prisma, {
      status: "EMPTY",
      target: params.target,
      actorEmail: params.actorEmail,
      recipients,
      subject,
      error: "Нет изменений за выбранный период — письмо не отправлено",
      stats,
      periodFrom: params.from,
      periodTo: params.to
    });
    return {
      ok: false,
      status: "EMPTY",
      messageId: null,
      recipients,
      subject,
      error: "Нет изменений за выбранный период — письмо не отправлено"
    };
  }

  try {
    const result = await sendMail(smtp, {
      to: recipients,
      subject,
      text: text || "См. HTML-версию письма",
      html: html || undefined
    });
    await writeLog(prisma, {
      status: "SENT",
      target: params.target,
      actorEmail: params.actorEmail,
      recipients,
      subject,
      stats,
      periodFrom: params.from,
      periodTo: params.to
    });
    return { ok: true, status: "SENT", messageId: result.messageId, recipients, subject, error: null };
  } catch (e: any) {
    const error = `Ошибка отправки: ${e?.message ?? String(e)}`;
    await writeLog(prisma, {
      status: "FAILED",
      target: params.target,
      actorEmail: params.actorEmail,
      recipients,
      subject,
      error,
      stats,
      periodFrom: params.from,
      periodTo: params.to
    });
    return { ok: false, status: "FAILED", messageId: null, recipients, subject, error };
  }
}

export async function runScheduledMailDigest(app: {
  prisma: PrismaClient;
  log: { info: (o: unknown, msg?: string) => void; warn: (o: unknown, msg?: string) => void };
}): Promise<{ sent: boolean; skipped: boolean; status?: DigestSendStatus }> {
  const settings = await app.prisma.mailDigestSettings.findUnique({ where: { id: "default" } });
  if (!settings) return { sent: false, skipped: true };
  if (!isScheduledDigestDue(settings)) return { sent: false, skipped: true };

  const periodMode = parseDigestPeriodMode(settings.periodMode);
  const period = resolveDigestPeriod({
    periodMode: periodMode === "custom" ? "last7" : periodMode,
    customFrom: settings.periodCustomFrom,
    customTo: settings.periodCustomTo
  });
  const recipients = parseRecipients(settings.recipients);
  const result = await dispatchChangeDigest(app.prisma, {
    settings,
    from: period.from,
    to: period.to,
    recipients,
    subject: settings.subjectTemplate,
    target: "schedule",
    actorEmail: null
  });

  if (result.status === "SENT" || result.status === "EMPTY") {
    await app.prisma.mailDigestSettings.update({
      where: { id: settings.id },
      data: { lastAutoSentAt: new Date() }
    });
  }

  if (result.status === "SENT") {
    app.log.info({ recipients: result.recipients.length, subject: result.subject }, "mail digest scheduled send");
    return { sent: true, skipped: false, status: result.status };
  }
  if (result.status === "EMPTY") {
    app.log.info({ subject: result.subject }, "mail digest scheduled skip empty");
    return { sent: false, skipped: false, status: result.status };
  }
  app.log.warn({ error: result.error }, "mail digest scheduled send failed");
  return { sent: false, skipped: false, status: result.status };
}


