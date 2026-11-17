import type { PrismaClient } from "@prisma/client";

import { isSmtpReady, parseRecipients, sendMail, smtpConfigFromSettings } from "./mailer.js";
import { readMailSources } from "./mailVariantSource.js";
import { registryPeriodLabel, readSendRows } from "./towRegistry.js";
import { buildTowRegistryLetter, describeTowSendDiff } from "./towRegistryMail.js";
import { buildTowRegistryXlsx } from "./towReportXlsx.js";
import { formatMskDateTime, type TowReportRow } from "./towReport.js";
import { readTowMailTemplate } from "./towMailTemplate.js";

type SmtpRow = {
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  mailFrom: string | null;
};

function rowsFromSnapshot(value: unknown): TowReportRow[] {
  return readSendRows(value).map(
    (row) => ({ ...(row as unknown as TowReportRow), seq: Number(row.seq) || 0, hangarNumber: row.hangarNumber ?? "" }) as TowReportRow
  );
}

async function writeSendLog(
  prisma: PrismaClient,
  row: {
    variantId?: string | null;
    variantName?: string | null;
    status: "SENT" | "FAILED" | "EMPTY";
    target: string;
    actorEmail?: string | null;
    recipients: string[];
    subject: string;
    error?: string | null;
    periodFrom: Date;
    periodTo: Date;
    towSendId?: string | null;
    rows?: number;
  }
) {
  await prisma.mailDigestSendLog.create({
    data: {
      variantId: row.variantId ?? null,
      variantName: row.variantName ?? "Буксировки",
      status: row.status,
      target: row.target,
      actorEmail: row.actorEmail ?? null,
      recipients: row.recipients,
      subject: row.subject,
      error: row.error ?? null,
      stats: { towSendId: row.towSendId ?? null, rows: row.rows ?? 0 },
      periodFrom: row.periodFrom,
      periodTo: row.periodTo
    }
  });
}

export async function deliverTowRegistrySend(
  prisma: PrismaClient,
  params: {
    sendId: string;
    recipients: string[];
    smtp: SmtpRow;
    target: "self" | "all" | "schedule" | "trigger";
    actorEmail?: string | null;
    variantId?: string | null;
    variantName?: string | null;
    subjectTemplate?: string | null;
    bodyTemplate?: string | null;
  }
): Promise<{ ok: boolean; status: "SENT" | "FAILED" | "EMPTY"; subject: string; recipients: string[]; error: string | null; rows: number }> {
  const existing = await prisma.towRegistrySend.findUnique({ where: { id: params.sendId } });
  const recipients = params.recipients.map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!existing) {
    return { ok: false, status: "FAILED", subject: "Реестр буксировок", recipients, error: "Версия реестра не найдена", rows: 0 };
  }
  const subjectBase = params.subjectTemplate?.trim() || existing.subject || "Реестр буксировок";
  const logBase = {
    variantId: params.variantId,
    variantName: params.variantName || "Буксировки",
    target: params.target,
    actorEmail: params.actorEmail,
    recipients,
    subject: subjectBase,
    periodFrom: existing.fromAt,
    periodTo: existing.toAt,
    towSendId: existing.id
  };
  if (!recipients.length) {
    await writeSendLog(prisma, { ...logBase, status: "FAILED", error: "Список получателей пуст" });
    return { ok: false, status: "FAILED", subject: subjectBase, recipients, error: "Список получателей пуст", rows: 0 };
  }
  const smtp = smtpConfigFromSettings(params.smtp);
  if (!smtp || !isSmtpReady(params.smtp)) {
    const error = "Почта не настроена. Обратитесь к администратору.";
    await writeSendLog(prisma, { ...logBase, status: "FAILED", error });
    return { ok: false, status: "FAILED", subject: subjectBase, recipients, error, rows: 0 };
  }
  const items = rowsFromSnapshot(existing.rows);
  if (!items.length) {
    await writeSendLog(prisma, { ...logBase, status: "EMPTY", error: "В зафиксированной версии нет строк" });
    return { ok: false, status: "EMPTY", subject: subjectBase, recipients, error: "В зафиксированной версии нет строк", rows: 0 };
  }
  const previous = await prisma.towRegistrySend.findFirst({
    where: {
      id: { not: existing.id },
      sandboxId: existing.sandboxId,
      fromAt: existing.fromAt,
      toAt: existing.toAt,
      messageId: { not: null }
    },
    orderBy: { createdAt: "desc" }
  });
  const template = await readTowMailTemplate(prisma).catch(() => ({ subjectTemplate: "", bodyTemplate: "" }));
  const letter = buildTowRegistryLetter({
    rows: items,
    periodLabel: registryPeriodLabel(existing.fromAt, existing.toAt),
    contour: "Рабочий контур",
    subjectTemplate: params.subjectTemplate || template.subjectTemplate,
    bodyTemplate: params.bodyTemplate ?? template.bodyTemplate,
    diffLines: describeTowSendDiff(previous ? readSendRows(previous.rows) : null, items)
  });
  const fileStamp = formatMskDateTime(existing.fromAt).slice(0, 10).split(".").reverse().join("") || "registry";
  try {
    const xlsx = await buildTowRegistryXlsx(items);
    const sent = await sendMail(smtp, {
      to: recipients,
      subject: letter.subject,
      text: letter.text,
      html: letter.html,
      attachments: [
        {
          filename: `buksirovki-${fileStamp}.xlsx`,
          content: xlsx,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
      ]
    });
    await prisma.towRegistrySend.update({
      where: { id: existing.id },
      data: { messageId: sent.messageId ?? null, recipients, subject: letter.subject }
    });
    await writeSendLog(prisma, { ...logBase, status: "SENT", subject: letter.subject, rows: items.length });
    return { ok: true, status: "SENT", subject: letter.subject, recipients, error: null, rows: items.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить письмо";
    await writeSendLog(prisma, { ...logBase, status: "FAILED", error: message });
    return { ok: false, status: "FAILED", subject: letter.subject, recipients, error: message, rows: items.length };
  }
}

export async function dispatchTowVariant(
  prisma: PrismaClient,
  params: {
    variant: { id: string; name: string; subjectTemplate: string; description?: string | null; recipients: unknown; periodMode: string; periodCustomFrom: string | null; periodCustomTo: string | null };
    smtp: SmtpRow;
    from: Date;
    to: Date;
    recipients: string[];
    target: "self" | "all" | "schedule" | "trigger";
    actorEmail?: string | null;
    sendId?: string | null;
  }
) {
  let sendId = params.sendId ?? null;
  if (!sendId) {
    const found = await prisma.towRegistrySend.findFirst({
      where: { fromAt: { lt: params.to }, toAt: { gt: params.from } },
      orderBy: { createdAt: "desc" }
    });
    sendId = found?.id ?? null;
  }
  if (!sendId) {
    await writeSendLog(prisma, {
      variantId: params.variant.id,
      variantName: params.variant.name,
      status: "EMPTY",
      target: params.target,
      actorEmail: params.actorEmail,
      recipients: params.recipients,
      subject: params.variant.subjectTemplate || params.variant.name,
      error: "Нет зафиксированного реестра за выбранный период",
      periodFrom: params.from,
      periodTo: params.to
    });
    return {
      ok: false,
      status: "EMPTY" as const,
      messageId: null,
      recipients: params.recipients,
      subject: params.variant.subjectTemplate || params.variant.name,
      error: "Нет зафиксированного реестра за выбранный период"
    };
  }
  const result = await deliverTowRegistrySend(prisma, {
    sendId,
    recipients: params.recipients,
    smtp: params.smtp,
    target: params.target,
    actorEmail: params.actorEmail,
    variantId: params.variant.id,
    variantName: params.variant.name,
    subjectTemplate: params.variant.subjectTemplate
  });
  return { ...result, messageId: null };
}

export async function dispatchTowTriggers(prisma: PrismaClient, sendId: string): Promise<void> {
  const settings = await prisma.mailDigestSettings.findUnique({ where: { id: "default" } });
  if (!settings || !isSmtpReady(settings)) return;
  const variants = await prisma.mailDigestVariant.findMany({ where: { isActive: true, scheduleMode: "trigger" } });
  if (!variants.length) return;
  const sources = await readMailSources(prisma, variants.map((variant) => variant.id));
  const snapshot = await prisma.towRegistrySend.findUnique({ where: { id: sendId } });
  if (!snapshot) return;
  for (const variant of variants) {
    if ((sources.get(variant.id) ?? "plan") !== "tows") continue;
    await deliverTowRegistrySend(prisma, {
      sendId,
      recipients: parseRecipients(variant.recipients),
      smtp: settings,
      target: "trigger",
      variantId: variant.id,
      variantName: variant.name,
      subjectTemplate: variant.subjectTemplate
    });
  }
}
