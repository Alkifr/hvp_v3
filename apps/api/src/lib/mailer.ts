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

export function smtpConfigFromSettings(s: Pick<MailDigestSettings, "smtpHost" | "smtpPort" | "smtpSecure" | "smtpUser" | "smtpPass" | "mailFrom">): SmtpConfig | null {
  const host = s.smtpHost?.trim();
  if (!host) return null;
  return {
    smtpHost: host,
    smtpPort: s.smtpPort || 25,
    smtpSecure: s.smtpSecure,
    smtpUser: s.smtpUser,
    smtpPass: s.smtpPass,
    mailFrom: s.mailFrom
  };
}

/** Host + From (или SMTP user как запасной From). Пароль не обязателен: корпоративный релей часто без AUTH. */
export function isSmtpReady(s: Pick<MailDigestSettings, "smtpHost" | "smtpPort" | "smtpSecure" | "smtpUser" | "smtpPass" | "mailFrom">): boolean {
  const cfg = smtpConfigFromSettings(s);
  if (!cfg) return false;
  try {
    resolveFrom(cfg);
    return true;
  } catch {
    return false;
  }
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

export function resolveFrom(cfg: SmtpConfig): string {
  const from = cfg.mailFrom?.trim();
  if (from) return from;
  const user = cfg.smtpUser?.trim();
  if (user) return user;
  throw new Error("Не указан адрес отправителя (From) и SMTP user");
}

export function formatSmtpError(e: unknown, cfg: SmtpConfig): string {
  const err = e as { code?: string; command?: string; response?: string; message?: string };
  const code = err.code ?? "";
  const msg = err.message ?? String(e);
  const target = `${cfg.smtpHost}:${cfg.smtpPort}`;
  const timedOut = code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || /timeout/i.test(msg);
  if (timedOut) {
    return `Таймаут SMTP ${target} (SSL=${cfg.smtpSecure}). С сервера приложения нет ответа на этот порт — обычно исходящий TCP закрыт файрволом (DROP), а не ошибка логина.`;
  }
  if (code === "ECONNREFUSED") {
    return `SMTP ${target} отказал в соединении (ECONNREFUSED).`;
  }
  if (code === "ENOTFOUND" || code === "EDNS") {
    return `Не резолвится хост ${cfg.smtpHost}.`;
  }
  const extra = [code && `[${code}]`, err.command && `cmd=${err.command}`, err.response]
    .filter(Boolean)
    .join(" ");
  return `SMTP ${target}: ${msg}${extra ? ` ${extra}` : ""}`;
}

export async function sendMail(
  cfg: SmtpConfig,
  params: { to: string[]; subject: string; text: string; html?: string }
): Promise<{ messageId: string }> {
  if (!params.to.length) throw new Error("Нет получателей");
  // Yandex app passwords часто копируют с пробелами (xxxx xxxx xxxx xxxx).
  const user = cfg.smtpUser?.trim() || "";
  const pass = (cfg.smtpPass ?? "").replace(/\s+/g, "");
  const plainRelay = !cfg.smtpSecure && cfg.smtpPort === 25;
  const transport = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    // Порт 25 / STARTTLS на внутреннем реле часто с корпоративным сертификатом.
    ...(!cfg.smtpSecure ? { tls: { rejectUnauthorized: false } } : {}),
    // Внутренний релей :25 без AUTH: не ждать STARTTLS, который может висеть до таймаута.
    ...(plainRelay ? { ignoreTLS: true } : {})
  });

  try {
    const info = await transport.sendMail({
      from: resolveFrom(cfg),
      to: params.to.join(", "),
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {})
    });
    return { messageId: String(info.messageId ?? "") };
  } catch (e) {
    throw new Error(formatSmtpError(e, cfg));
  } finally {
    transport.close();
  }
}
