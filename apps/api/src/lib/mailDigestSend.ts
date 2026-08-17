import type { PrismaClient } from "@prisma/client";

import { buildChangeDigest, type ChangeDigestStats } from "./changeDigest.js";
import { isScheduledDigestDue, parseDigestPeriodMode, resolveDigestPeriod } from "./mailDigestPeriod.js";
import { parseRecipients, sendMail, smtpConfigFromSettings } from "./mailer.js";
import { claimScheduledDigestSlot } from "./digestClaim.js";

export type DigestSendTarget = "self" | "all" | "schedule";
export type DigestSendStatus = "SENT" | "FAILED" | "EMPTY";

type DigestSmtpRow = {
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  mailFrom: string | null;
};

type DigestVariantRow = {
  id: string;
  name: string;
  subjectTemplate: string;
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
    variantId?: string | null;
    variantName?: string | null;
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
      variantId: row.variantId ?? null,
      variantName: row.variantName ?? null,
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
    smtp: DigestSmtpRow;
    variant?: DigestVariantRow | null;
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
  const variantName = params.variant?.name?.trim() || null;
  const subject =
    params.subject.trim() ||
    params.variant?.subjectTemplate?.trim() ||
    variantName ||
    "Изменения плана ТО";
  const recipients = params.recipients.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const logBase = {
    variantId: params.variant?.id ?? null,
    variantName,
    target: params.target,
    actorEmail: params.actorEmail,
    recipients,
    subject,
    periodFrom: params.from,
    periodTo: params.to
  };

  if (!recipients.length) {
    await writeLog(prisma, {
      ...logBase,
      status: "FAILED",
      error: "Список получателей пуст"
    });
    return { ok: false, status: "FAILED", messageId: null, recipients, subject, error: "Список получателей пуст" };
  }

  const smtp = smtpConfigFromSettings(params.smtp);
  if (!smtp || !params.smtp.smtpPass) {
    const error = "Почта не настроена. Обратитесь к администратору.";
    await writeLog(prisma, { ...logBase, status: "FAILED", error });
    return { ok: false, status: "FAILED", messageId: null, recipients, subject, error };
  }

  let text = params.text?.trim() ?? "";
  let html = params.html?.trim() ?? "";
  let stats: ChangeDigestStats | null = null;
  if (!text || !html) {
    const digest = await buildChangeDigest(prisma, {
      from: params.from,
      to: params.to,
      columns: params.columns ?? params.variant?.columns
    });
    stats = digest.stats;
    if (!text) text = digest.text.trim();
    if (!html) html = digest.html.trim();
  }
  if (!text && !html) {
    await writeLog(prisma, {
      ...logBase,
      status: "EMPTY",
      error: "Нет изменений за выбранный период — письмо не отправлено",
      stats
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
    await writeLog(prisma, { ...logBase, status: "SENT", stats });
    return { ok: true, status: "SENT", messageId: result.messageId, recipients, subject, error: null };
  } catch (e: any) {
    const error = `Ошибка отправки: ${e?.message ?? String(e)}`;
    await writeLog(prisma, { ...logBase, status: "FAILED", error, stats });
    return { ok: false, status: "FAILED", messageId: null, recipients, subject, error };
  }
}

export async function runScheduledMailDigest(app: {
  prisma: PrismaClient;
  log: { info: (o: unknown, msg?: string) => void; warn: (o: unknown, msg?: string) => void };
}): Promise<{ sent: number; empty: number; failed: number; skipped: boolean }> {
  const smtp = await app.prisma.mailDigestSettings.findUnique({ where: { id: "default" } });
  if (!smtp || !smtpConfigFromSettings(smtp) || !smtp.smtpPass) {
    return { sent: 0, empty: 0, failed: 0, skipped: true };
  }

  const variants = await app.prisma.mailDigestVariant.findMany({
    where: { isActive: true, NOT: { scheduleMode: "manual" } }
  });
  if (!variants.length) return { sent: 0, empty: 0, failed: 0, skipped: true };

  let sent = 0;
  let empty = 0;
  let failed = 0;
  let anyDue = false;

  for (const variant of variants) {
    if (!isScheduledDigestDue(variant)) continue;
    anyDue = true;
    const claimed = await claimScheduledDigestSlot(app.prisma, variant.id);
    if (!claimed) continue;

    const periodMode = parseDigestPeriodMode(variant.periodMode);
    const period = resolveDigestPeriod({
      periodMode: periodMode === "custom" ? "last7" : periodMode,
      customFrom: variant.periodCustomFrom,
      customTo: variant.periodCustomTo
    });
    const recipients = parseRecipients(variant.recipients);
    const result = await dispatchChangeDigest(app.prisma, {
      smtp,
      variant,
      from: period.from,
      to: period.to,
      recipients,
      subject: variant.subjectTemplate || variant.name,
      target: "schedule",
      actorEmail: null
    });

    if (result.status === "SENT") {
      sent += 1;
      app.log.info(
        { variantId: variant.id, recipients: result.recipients.length, subject: result.subject },
        "mail digest scheduled send"
      );
    } else if (result.status === "EMPTY") {
      empty += 1;
      app.log.info({ variantId: variant.id, subject: result.subject }, "mail digest scheduled skip empty");
    } else {
      failed += 1;
      app.log.warn({ variantId: variant.id, error: result.error }, "mail digest scheduled send failed");
    }
  }

  return { sent, empty, failed, skipped: !anyDue && sent === 0 && empty === 0 && failed === 0 };
}
