import nodemailer from "nodemailer";
import type { MailDigestSettings } from "@prisma/client";

export type SmtpConfig = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string | null;
  smtpPass?: string | null;
  mailFrom?: string | null;
};

export function smtpConfigFromSettings(s: MailDigestSettings): SmtpConfig | null {
  const host = s.smtpHost?.trim();
  if (!host) return null;
  return {
    smtpHost: host,
    smtpPort: s.smtpPort || 465,
    smtpSecure: s.smtpSecure,
    smtpUser: s.smtpUser,
    smtpPass: s.smtpPass,
    mailFrom: s.mailFrom
  };
}

export function parseRecipients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const email = item.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function resolveFrom(cfg: SmtpConfig): string {
  const from = cfg.mailFrom?.trim();
  if (from) return from;
  const user = cfg.smtpUser?.trim();
  if (user) return user;
  throw new Error("Не указан адрес отправителя (From) и SMTP user");
}

export async function sendMail(
  cfg: SmtpConfig,
  params: { to: string[]; subject: string; text: string; html?: string }
): Promise<{ messageId: string }> {
  if (!params.to.length) throw new Error("Нет получателей");
  // Yandex app passwords часто копируют с пробелами (xxxx xxxx xxxx xxxx).
  const user = cfg.smtpUser?.trim() || "";
  const pass = (cfg.smtpPass ?? "").replace(/\s+/g, "");
  const transport = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: user && pass ? { user, pass } : undefined
  });

  const info = await transport.sendMail({
    from: resolveFrom(cfg),
    to: params.to.join(", "),
    subject: params.subject,
    text: params.text,
    ...(params.html ? { html: params.html } : {})
  });

  return { messageId: String(info.messageId ?? "") };
}
