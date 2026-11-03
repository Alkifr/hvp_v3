import type { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

import { isSmtpReady, sendMail, smtpConfigFromSettings } from "./mailer.js";

export type AuditNote = {
  eventId: string;
  sandboxId: string | null;
  action: string;
  actor: string;
  reason: string | null;
  changes: unknown;
};

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Событие создано",
  UPDATE: "Данные изменены",
  RESERVE: "Назначено место",
  UNRESERVE: "Резерв места снят"
};

const FIELD_LABEL: Record<string, string> = {
  title: "Название",
  status: "Статус",
  level: "Уровень",
  planningKind: "Вид планирования",
  startAt: "Начало",
  endAt: "Окончание",
  budgetStartAt: "Бюджетное начало",
  budgetEndAt: "Бюджетное окончание",
  actualStartAt: "Фактическое начало",
  actualEndAt: "Фактическое окончание",
  notes: "Примечание",
  comment: "Комментарий",
  hangarId: "Ангар",
  layoutId: "Вариант размещения",
  standId: "Место",
  workshopId: "Цех",
  lineBase: "L/B",
  deadlineAt: "DeadLine",
  aircraftId: "Борт",
  eventTypeId: "Тип события",
  allowOverlap: "Нахлёст",
  reservation: "Резерв места",
  placements: "Этапы размещения",
  tow: "Буксировка"
};

export type WatchEventSection = {
  title: string;
  aircraft: string;
  contour: string;
  lines: string[];
  link: string | null;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function formatVal(v: unknown, depth = 0): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = dayjs(v);
      if (d.isValid()) return d.format("DD.MM.YYYY HH:mm");
    }
    return v.length > 180 ? `${v.slice(0, 177)}…` : v;
  }
  if (Array.isArray(v)) return v.length ? `${v.length} шт.` : "—";
  if (depth >= 2 || !isObj(v)) return "изменено";
  if ("from" in v || "to" in v) return `${formatVal(v.from, depth + 1)} → ${formatVal(v.to, depth + 1)}`;
  return "изменено";
}

export function summarizeChanges(changes: unknown): string[] {
  if (!isObj(changes)) return [];
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(changes)) {
    const label = FIELD_LABEL[key] ?? key;
    if (isObj(raw) && ("from" in raw || "to" in raw)) {
      lines.push(`${label}: ${formatVal(raw.from)} → ${formatVal(raw.to)}`);
    } else {
      lines.push(`${label}: ${formatVal(raw)}`);
    }
    if (lines.length >= 12) break;
  }
  return lines;
}

export function describeAudit(note: AuditNote): string[] {
  const action = ACTION_LABEL[note.action] ?? note.action;
  const head = note.reason?.trim() ? `${action}. ${note.reason.trim()}` : action;
  return [head, ...summarizeChanges(note.changes)];
}

function noteFrom(raw: unknown): AuditNote | null {
  if (!isObj(raw)) return null;
  const eventId = typeof raw.eventId === "string" ? raw.eventId.trim() : "";
  if (!eventId) return null;
  const sandboxId = typeof raw.sandboxId === "string" && raw.sandboxId.trim() ? raw.sandboxId : null;
  return {
    eventId,
    sandboxId,
    action: typeof raw.action === "string" ? raw.action : "UPDATE",
    actor: typeof raw.actor === "string" ? raw.actor : "",
    reason: typeof raw.reason === "string" ? raw.reason : null,
    changes: raw.changes ?? null
  };
}

/** Строки аудита из аргументов Prisma create / createMany. */
export function notesFromAuditWrite(operation: string, args: { data?: unknown } | undefined, result: unknown): AuditNote[] {
  if (operation === "create") {
    const data = noteFrom(args?.data) ?? noteFrom(result);
    return data ? [data] : [];
  }
  if (operation !== "createMany") return [];
  const data = args?.data;
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.map(noteFrom).filter((row): row is AuditNote => row != null);
}

export function auditsForRecipient(notes: AuditNote[], recipientEmail: string): AuditNote[] {
  const me = recipientEmail.trim().toLowerCase();
  if (!me) return notes;
  return notes.filter((note) => note.actor.trim().toLowerCase() !== me);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function eventWatchLink(eventId: string, sandboxId: string | null): string | null {
  const base = process.env.HVP_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (!base) return null;
  const q = new URLSearchParams();
  q.set("event", eventId);
  if (sandboxId) q.set("sandbox", sandboxId);
  return `${base}#gantt?${q.toString()}`;
}

export function formatWatchLetter(sections: WatchEventSection[]): { subject: string; text: string; html: string } {
  const subject =
    sections.length === 1
      ? `HVP: изменение «${sections[0]!.title}»`
      : `HVP: изменения ${sections.length} событий`;
  const textParts = sections.map((section) => {
    const head = [section.aircraft, section.title, section.contour].filter(Boolean).join(" · ");
    const body = section.lines.map((line) => `• ${line}`).join("\n");
    const link = section.link ? `\n${section.link}` : "";
    return `${head}\n${body}${link}`;
  });
  const text = `${textParts.join("\n\n")}\n\nОтписаться можно в профиле, вкладка «Подписки».`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;color:#0f172a">${sections
    .map((section) => {
      const head = escapeHtml([section.aircraft, section.title, section.contour].filter(Boolean).join(" · "));
      const items = section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
      const link = section.link
        ? `<div style="margin-top:6px"><a href="${escapeHtml(section.link)}">Открыть событие</a></div>`
        : "";
      return `<div style="margin:0 0 16px"><strong>${head}</strong><ul style="margin:6px 0 0;padding-left:18px">${items}</ul>${link}</div>`;
    })
    .join("")}<div style="color:#64748b;font-size:12px">Отписаться можно в профиле, вкладка «Подписки».</div></div>`;
  return { subject, text, html };
}

type Bound = {
  prisma: PrismaClient;
  log: { warn: (obj: unknown, msg?: string) => void };
};

let bound: Bound | null = null;
let buffer = new Map<string, AuditNote[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function bindEventWatchMail(next: Bound) {
  bound = next;
}

export function enqueueEventAuditMails(notes: AuditNote[]) {
  if (!notes.length || !bound) return;
  for (const note of notes) {
    const list = buffer.get(note.eventId) ?? [];
    list.push(note);
    buffer.set(note.eventId, list);
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const batch = buffer;
    buffer = new Map();
    const client = bound;
    if (!client) return;
    void flushEventWatchMails(client, batch).catch((err) => {
      client.log.warn({ err }, "event watch mail failed");
    });
  }, 2000);
}

export async function flushEventWatchMails(client: Bound, batch: Map<string, AuditNote[]>) {
  const eventIds = [...batch.keys()];
  if (!eventIds.length) return;

  const subs = await client.prisma.eventChangeSubscription.findMany({
    where: { eventId: { in: eventIds } },
    select: {
      eventId: true,
      user: { select: { email: true, isActive: true } }
    }
  });
  const active = subs.filter((row) => row.user.isActive && row.user.email.includes("@"));
  if (!active.length) return;

  const smtpRow = await client.prisma.mailDigestSettings.findUnique({ where: { id: "default" } });
  if (!smtpRow || !isSmtpReady(smtpRow)) return;
  const smtp = smtpConfigFromSettings(smtpRow);
  if (!smtp) return;

  const events = await client.prisma.maintenanceEvent.findMany({
    where: { id: { in: eventIds } },
    select: {
      id: true,
      title: true,
      sandboxId: true,
      aircraft: { select: { tailNumber: true } },
      sandbox: { select: { name: true } }
    }
  });
  const byId = new Map(events.map((ev) => [ev.id, ev]));

  const byRecipient = new Map<string, WatchEventSection[]>();
  for (const sub of active) {
    const email = sub.user.email.trim().toLowerCase();
    const notes = auditsForRecipient(batch.get(sub.eventId) ?? [], email);
    if (!notes.length) continue;
    const ev = byId.get(sub.eventId);
    const lines = notes.flatMap(describeAudit).slice(0, 20);
    if (!lines.length) continue;
    const section: WatchEventSection = {
      title: ev?.title?.trim() || "Событие",
      aircraft: ev?.aircraft?.tailNumber?.trim() || "",
      contour: ev?.sandboxId ? `Песочница${ev.sandbox?.name ? `: ${ev.sandbox.name}` : ""}` : "Рабочий контур",
      lines,
      link: eventWatchLink(sub.eventId, ev?.sandboxId ?? null)
    };
    const list = byRecipient.get(email) ?? [];
    list.push(section);
    byRecipient.set(email, list);
  }

  for (const [email, sections] of byRecipient) {
    const letter = formatWatchLetter(sections);
    try {
      await sendMail(smtp, { to: [email], subject: letter.subject, text: letter.text, html: letter.html });
    } catch (err) {
      client.log.warn({ err, email }, "event watch mail send failed");
    }
  }
}
