import { createHmac, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

import { resolveJwtSecret } from "./bootEnv.js";
import { eventStatusLabel } from "./eventStatusCatalog.js";
import { mskCalendarDate } from "./localDate.js";
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
  tow: "Буксировка",
  operatorId: "Оператор",
  aircraftTypeId: "Тип ВС",
  typeId: "Тип ВС",
  label: "Обозначение",
  origin: "Источник этапа",
  fromLabel: "Откуда",
  toLabel: "Куда",
  placementLabel: "Этап размещения",
  positionComment: "Позиция",
  startChangeReason: "Причина изменения начала"
};

const LEVEL_LABEL: Record<string, string> = {
  STRATEGIC: "Стратегический",
  OPERATIONAL: "Оперативный"
};

const PLANNING_KIND_LABEL: Record<string, string> = {
  PLANNED: "Плановое",
  UNPLANNED: "Внеплановое"
};

const LINE_BASE_LABEL: Record<string, string> = {
  LINE: "L (Line)",
  BASE: "B (Base)"
};

const ORIGIN_LABEL: Record<string, string> = {
  AUTO_GAP: "Создан системой для заполнения разрыва",
  MANUAL: "Добавлен пользователем"
};

const LEGACY_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  PROPOSED: "Предложено",
  APPROVED: "Согласовано"
};

const REF_KEYS = new Set([
  "hangarId",
  "layoutId",
  "standId",
  "aircraftId",
  "eventTypeId",
  "workshopId",
  "aircraftTypeId",
  "typeId",
  "operatorId"
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WatchLabels = {
  hangars: Map<string, string>;
  layouts: Map<string, string>;
  stands: Map<string, string>;
  aircraft: Map<string, string>;
  eventTypes: Map<string, string>;
  workshops: Map<string, string>;
  statuses: Map<string, string>;
  aircraftTypes: Map<string, string>;
  operators: Map<string, string>;
};

export type WatchChangeRow = {
  field: string;
  previous: string;
  current: string;
};

export type WatchChangeBlock = {
  actor: string;
  action: string;
  rows: WatchChangeRow[];
};

export type WatchEventSection = {
  title: string;
  aircraft: string;
  blocks: WatchChangeBlock[];
  link: string | null;
  unsubscribeLink: string | null;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

function isRefKey(key: string | undefined): boolean {
  return !!key && (REF_KEYS.has(key) || /Id$/.test(key));
}

function clip(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function refValue(key: string | undefined, value: string, labels?: WatchLabels): string | null {
  if (!labels || !key) return null;
  switch (key) {
    case "hangarId":
      return labels.hangars.get(value) ?? null;
    case "layoutId":
      return labels.layouts.get(value) ?? null;
    case "standId":
      return labels.stands.get(value) ?? null;
    case "aircraftId":
      return labels.aircraft.get(value) ?? null;
    case "eventTypeId":
      return labels.eventTypes.get(value) ?? null;
    case "workshopId":
      return labels.workshops.get(value) ?? null;
    case "aircraftTypeId":
    case "typeId":
      return labels.aircraftTypes.get(value) ?? null;
    case "operatorId":
      return labels.operators.get(value) ?? null;
    default:
      return null;
  }
}

function formatDeadline(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}.${month}.${year}`;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  const [year, month, day] = mskCalendarDate(parsed).split("-");
  return `${day}.${month}.${year}`;
}

function formatScalar(key: string | undefined, value: string, labels?: WatchLabels): string {
  if (key === "deadlineAt" || key === "deadlineAtLocal") return formatDeadline(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = dayjs(value);
    if (d.isValid()) return d.format("DD.MM.YYYY HH:mm");
  }
  if (key === "status") return labels?.statuses.get(value) ?? LEGACY_STATUS_LABEL[value] ?? eventStatusLabel(value);
  if (key === "level") return LEVEL_LABEL[value] ?? value;
  if (key === "planningKind") return PLANNING_KIND_LABEL[value] ?? value;
  if (key === "lineBase") return LINE_BASE_LABEL[value] ?? value;
  if (key === "origin") return ORIGIN_LABEL[value] ?? value;
  const named = refValue(key, value, labels);
  if (named) return named;
  if (isRefKey(key) && isUuid(value)) return "не найдено";
  return clip(value, 180);
}

function formatPeriod(start: unknown, end: unknown, labels?: WatchLabels): string {
  const left = start == null || start === "" ? "" : formatVal(start, undefined, labels, 1);
  const right = end == null || end === "" ? "" : formatVal(end, undefined, labels, 1);
  if (left && right) return `${left} — ${right}`;
  if (left) return `с ${left}`;
  if (right) return `до ${right}`;
  return "";
}

function isPlace(key: string | undefined, value: Record<string, unknown>): boolean {
  if (key === "reservation" || key === "placements") return true;
  return ("layoutId" in value || "standId" in value || "hangarId" in value) && ("startAt" in value || "endAt" in value || "origin" in value);
}

function formatPlace(value: Record<string, unknown>, labels?: WatchLabels): string {
  const period = formatPeriod(value.startAt, value.endAt, labels);
  const budget = formatPeriod(value.budgetStartAt, value.budgetEndAt, labels);
  const actual = formatPeriod(value.actualStartAt, value.actualEndAt, labels);
  const layout = typeof value.layoutId === "string" ? formatScalar("layoutId", value.layoutId, labels) : "";
  const hangar = typeof value.hangarId === "string" ? formatScalar("hangarId", value.hangarId, labels) : "";
  const stand = typeof value.standId === "string" ? formatScalar("standId", value.standId, labels) : "";
  const location =
    value.origin === "AUTO_GAP"
      ? "Без ангара"
      : [layout || hangar, stand ? `место ${stand}` : ""].filter(Boolean).join(", ");
  const extras = [budget ? `бюджет ${budget}` : "", actual ? `факт ${actual}` : ""].filter(Boolean);
  return [period, location, ...extras].filter(Boolean).join(" · ") || "—";
}

function formatVal(v: unknown, key: string | undefined, labels?: WatchLabels, depth = 0): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return formatScalar(key, v, labels);
  if (Array.isArray(v)) {
    if (!v.length) return "—";
    return clip(v.map((item, index) => formatListItem(item, key, labels, depth + 1, index)).join("; "));
  }
  if (depth >= 3 || !isObj(v)) return "изменено";
  return clip(formatObject(v, key, labels, depth));
}

function formatListItem(item: unknown, key: string | undefined, labels: WatchLabels | undefined, depth: number, index: number): string {
  if (isObj(item) && isPlace(key, item)) return `${index + 1}. ${formatPlace(item, labels)}`;
  return formatVal(item, key, labels, depth);
}

function formatObject(value: Record<string, unknown>, key: string | undefined, labels: WatchLabels | undefined, depth: number): string {
  if (isPlace(key, value)) return formatPlace(value, labels);
  const keys = Object.keys(value);
  if (("from" in value || "to" in value) && keys.every((child) => child === "from" || child === "to")) {
    return `${formatVal(value.from, key, labels, depth + 1)} → ${formatVal(value.to, key, labels, depth + 1)}`;
  }
  const skip = new Set<string>();
  if ("aircraftTypeId" in value || "typeId" in value) {
    skip.add("aircraftTypeName");
    skip.add("aircraftTypeCode");
  }
  const parts: string[] = [];
  for (const [childKey, child] of Object.entries(value)) {
    if (skip.has(childKey) || child == null || child === "") continue;
    const label = FIELD_LABEL[childKey] ?? childKey;
    parts.push(`${label}: ${formatVal(child, childKey, labels, depth + 1)}`);
  }
  return parts.join(", ") || "—";
}

/** Строки как в истории карточки: реквизит, предыдущая версия, текущая. */
export function changeRows(changes: unknown, labels?: WatchLabels): WatchChangeRow[] {
  if (!isObj(changes)) return [];
  const rows: WatchChangeRow[] = [];
  for (const [key, raw] of Object.entries(changes)) {
    const field = FIELD_LABEL[key] ?? key;
    if (isObj(raw) && ("from" in raw || "to" in raw) && Object.keys(raw).every((child) => child === "from" || child === "to")) {
      rows.push({ field, previous: formatVal(raw.from, key, labels), current: formatVal(raw.to, key, labels) });
    } else {
      rows.push({ field, previous: "—", current: formatVal(raw, key, labels) });
    }
    if (rows.length >= 12) break;
  }
  return rows;
}

export function summarizeChanges(changes: unknown, labels?: WatchLabels): string[] {
  return changeRows(changes, labels).map((row) => `${row.field}: ${row.previous} → ${row.current}`);
}

export function formatWatchActor(actor: string, names?: Map<string, string>): string {
  const raw = actor.trim();
  if (!raw || raw === "system") return "Система";
  if (raw === "browser") return "Браузер";
  return names?.get(raw.toLowerCase())?.trim() || raw;
}

export function watchBlocks(notes: AuditNote[], labels?: WatchLabels, actorNames?: Map<string, string>): WatchChangeBlock[] {
  const blocks: WatchChangeBlock[] = [];
  for (const note of notes) {
    const rows = changeRows(note.changes, labels);
    const reason = note.reason?.trim();
    if (reason) rows.push({ field: "Комментарий", previous: "", current: clip(reason) });
    blocks.push({
      actor: formatWatchActor(note.actor, actorNames),
      action: ACTION_LABEL[note.action] ?? note.action,
      rows
    });
    if (blocks.length >= 8) break;
  }
  return blocks;
}

export async function loadActorNames(prisma: PrismaClient, actors: string[]): Promise<Map<string, string>> {
  const emails = [...new Set(actors.map((actor) => actor.trim()).filter((actor) => actor.includes("@")))];
  if (!emails.length) return new Map();
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, displayName: true }
  });
  const names = new Map<string, string>();
  for (const user of users) {
    const name = user.displayName?.trim();
    if (name) names.set(user.email.trim().toLowerCase(), name);
  }
  return names;
}

export function describeAudit(note: AuditNote, labels?: WatchLabels): string[] {
  const action = ACTION_LABEL[note.action] ?? note.action;
  const head = note.reason?.trim() ? `${action}. ${note.reason.trim()}` : action;
  return [head, ...summarizeChanges(note.changes, labels)];
}

type RefBag = {
  hangarId: Set<string>;
  layoutId: Set<string>;
  standId: Set<string>;
  aircraftId: Set<string>;
  eventTypeId: Set<string>;
  workshopId: Set<string>;
  aircraftTypeId: Set<string>;
  operatorId: Set<string>;
  status: Set<string>;
};

function emptyRefBag(): RefBag {
  return {
    hangarId: new Set(),
    layoutId: new Set(),
    standId: new Set(),
    aircraftId: new Set(),
    eventTypeId: new Set(),
    workshopId: new Set(),
    aircraftTypeId: new Set(),
    operatorId: new Set(),
    status: new Set()
  };
}

function refBucket(key: string): keyof Omit<RefBag, "status"> | null {
  if (key === "typeId" || key === "aircraftTypeId") return "aircraftTypeId";
  if (key === "hangarId" || key === "layoutId" || key === "standId" || key === "aircraftId" || key === "eventTypeId" || key === "workshopId" || key === "operatorId") {
    return key;
  }
  return null;
}

function collectRefs(value: unknown, key: string | undefined, bag: RefBag) {
  if (typeof value === "string") {
    if (key === "status" && value.trim()) bag.status.add(value);
    const bucket = key ? refBucket(key) : null;
    if (bucket && isUuid(value)) bag[bucket].add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, key, bag);
    return;
  }
  if (!isObj(value)) return;
  if ("from" in value || "to" in value) {
    collectRefs(value.from, key, bag);
    collectRefs(value.to, key, bag);
  }
  for (const [childKey, child] of Object.entries(value)) {
    if (childKey === "from" || childKey === "to") continue;
    collectRefs(child, childKey, bag);
  }
}

function idsOf(values: Set<string>): string[] {
  return [...values];
}

/** Названия справочников для текста письма: вместо id борта, ангара, места, статуса. */
export async function loadWatchLabels(prisma: PrismaClient, notes: Array<{ changes: unknown }>): Promise<WatchLabels> {
  const bag = emptyRefBag();
  for (const note of notes) collectRefs(note.changes, undefined, bag);

  const [hangars, layouts, stands, aircraft, eventTypes, workshops, statuses, aircraftTypes, operators] = await Promise.all([
    bag.hangarId.size
      ? prisma.hangar.findMany({ where: { id: { in: idsOf(bag.hangarId) } }, select: { id: true, name: true } })
      : [],
    bag.layoutId.size
      ? prisma.hangarLayout.findMany({
          where: { id: { in: idsOf(bag.layoutId) } },
          select: { id: true, name: true, hangar: { select: { name: true } } }
        })
      : [],
    bag.standId.size
      ? prisma.hangarStand.findMany({
          where: { id: { in: idsOf(bag.standId) } },
          select: { id: true, code: true, name: true }
        })
      : [],
    bag.aircraftId.size
      ? prisma.aircraft.findMany({ where: { id: { in: idsOf(bag.aircraftId) } }, select: { id: true, tailNumber: true } })
      : [],
    bag.eventTypeId.size
      ? prisma.eventType.findMany({ where: { id: { in: idsOf(bag.eventTypeId) } }, select: { id: true, name: true } })
      : [],
    bag.workshopId.size
      ? prisma.workshop.findMany({ where: { id: { in: idsOf(bag.workshopId) } }, select: { id: true, name: true } })
      : [],
    bag.status.size
      ? prisma.eventStatusCatalog.findMany({ where: { code: { in: idsOf(bag.status) } }, select: { code: true, name: true } })
      : [],
    bag.aircraftTypeId.size
      ? prisma.aircraftType.findMany({
          where: { id: { in: idsOf(bag.aircraftTypeId) } },
          select: { id: true, name: true, icaoType: true }
        })
      : [],
    bag.operatorId.size
      ? prisma.operator.findMany({ where: { id: { in: idsOf(bag.operatorId) } }, select: { id: true, name: true } })
      : []
  ]);

  return {
    hangars: new Map(hangars.map((row) => [row.id, row.name])),
    layouts: new Map(layouts.map((row) => [row.id, row.hangar?.name ? `${row.hangar.name} / ${row.name}` : row.name])),
    stands: new Map(stands.map((row) => [row.id, row.code?.trim() || row.name])),
    aircraft: new Map(aircraft.map((row) => [row.id, row.tailNumber])),
    eventTypes: new Map(eventTypes.map((row) => [row.id, row.name])),
    workshops: new Map(workshops.map((row) => [row.id, row.name])),
    statuses: new Map(statuses.map((row) => [row.code, row.name])),
    aircraftTypes: new Map(aircraftTypes.map((row) => [row.id, row.icaoType ? `${row.icaoType} · ${row.name}` : row.name])),
    operators: new Map(operators.map((row) => [row.id, row.name]))
  };
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

/** Массовая очистка пишет аудит на каждое событие, но не рассылает письмо подписчикам. */
export function isCleanupAuditNote(note: AuditNote): boolean {
  const changes = note.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return false;
  const cleanup = (changes as { cleanup?: unknown }).cleanup;
  return cleanup != null && typeof cleanup === "object";
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

function publicBase(): string | null {
  const base = process.env.HVP_PUBLIC_URL?.trim().replace(/\/$/, "");
  return base || null;
}

function unsubscribeSecret(): string {
  return resolveJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV ?? "development");
}

const UNSUB_PURPOSE = "event-watch-unsub:v1";

export function signEventUnsubscribe(userId: string, eventId: string, secret: string): string {
  const payload = `${userId}.${eventId}`;
  const sig = createHmac("sha256", secret).update(`${UNSUB_PURPOSE}:${payload}`).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

export function readEventUnsubscribe(token: string, secret: string): { userId: string; eventId: string } | null {
  const raw = token.trim();
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  let payload = "";
  try {
    payload = Buffer.from(raw.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret).update(`${UNSUB_PURPOSE}:${payload}`).digest("base64url");
  const sig = raw.slice(dot + 1);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  const sep = payload.indexOf(".");
  if (sep <= 0) return null;
  const userId = payload.slice(0, sep);
  const eventId = payload.slice(sep + 1);
  if (!UUID_RE.test(userId) || !UUID_RE.test(eventId)) return null;
  return { userId, eventId };
}

export function eventWatchLink(eventId: string, sandboxId: string | null): string | null {
  const base = publicBase();
  if (!base) return null;
  const q = new URLSearchParams();
  q.set("event", eventId);
  if (sandboxId) q.set("sandbox", sandboxId);
  return `${base}#gantt?${q.toString()}`;
}

export function eventUnsubscribeLink(userId: string, eventId: string): string | null {
  const base = publicBase();
  if (!base) return null;
  const token = signEventUnsubscribe(userId, eventId, unsubscribeSecret());
  return `${base}/api/unsubscribe/event?token=${encodeURIComponent(token)}`;
}

function cellText(value: string): string {
  return value.trim() ? value : "—";
}

const TH_STYLE = "text-align:left;padding:6px 8px;border:1px solid #e2e8f0;color:#64748b;font-weight:600";
const TD_STYLE = "padding:6px 8px;border:1px solid #e2e8f0;vertical-align:top";

function blockText(block: WatchChangeBlock): string {
  const head = `Изменил: ${block.actor}\n${block.action}`;
  if (!block.rows.length) return head;
  const table = [
    "Реквизит | Предыдущая версия | Текущая версия",
    ...block.rows.map((row) => `${row.field} | ${cellText(row.previous)} | ${cellText(row.current)}`)
  ].join("\n");
  return `${head}\n${table}`;
}

function blockHtml(block: WatchChangeBlock): string {
  const rows = block.rows
    .map(
      (row) =>
        `<tr><td style="${TD_STYLE}">${escapeHtml(row.field)}</td><td style="${TD_STYLE}">${escapeHtml(cellText(row.previous))}</td><td style="${TD_STYLE}">${escapeHtml(cellText(row.current))}</td></tr>`
    )
    .join("");
  const table = rows
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:8px;font-size:13px"><thead><tr><th style="${TH_STYLE}">Реквизит</th><th style="${TH_STYLE}">Предыдущая версия</th><th style="${TH_STYLE}">Текущая версия</th></tr></thead><tbody>${rows}</tbody></table>`
    : "";
  return `<div style="margin-top:10px"><div>Изменил: <strong>${escapeHtml(block.actor)}</strong></div><div style="color:#475569">${escapeHtml(block.action)}</div>${table}</div>`;
}

export function formatWatchLetter(sections: WatchEventSection[]): { subject: string; text: string; html: string } {
  const subject =
    sections.length === 1
      ? `HVP: изменение «${sections[0]!.title}»`
      : `HVP: изменения ${sections.length} событий`;
  const profileHint = "Отписаться можно в профиле, вкладка «Подписки».";
  const textParts = sections.map((section) => {
    const head = [section.aircraft, section.title].filter(Boolean).join(" · ");
    const body = section.blocks.map(blockText).join("\n\n");
    const link = section.link ? `\nОткрыть событие: ${section.link}` : "";
    const unsub = section.unsubscribeLink
      ? `\nОтписаться от изменений этого события: ${section.unsubscribeLink}`
      : "";
    return `${head}\n${body}${link}${unsub}`;
  });
  const needsProfileHint = sections.every((section) => !section.unsubscribeLink);
  const text = `${textParts.join("\n\n")}${needsProfileHint ? `\n\n${profileHint}` : ""}`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;color:#0f172a">${sections
    .map((section) => {
      const head = escapeHtml([section.aircraft, section.title].filter(Boolean).join(" · "));
      const link = section.link
        ? `<div style="margin-top:8px"><a href="${escapeHtml(section.link)}">Открыть событие</a></div>`
        : "";
      const unsub = section.unsubscribeLink
        ? `<div style="margin-top:12px;font-size:12px"><a href="${escapeHtml(section.unsubscribeLink)}">Отписаться от изменений этого события</a></div>`
        : "";
      return `<div style="margin:0 0 18px"><strong>${head}</strong>${section.blocks.map(blockHtml).join("")}${link}${unsub}</div>`;
    })
    .join("")}${needsProfileHint ? `<div style="color:#64748b;font-size:12px">${profileHint}</div>` : ""}</div>`;
  return { subject, text, html };
}

export function unsubscribeNoticeHtml(input: { title: string; text: string }): string {
  const base = publicBase();
  const profile = base ? `${base}/#profile` : "/#profile";
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Segoe UI,Arial,sans-serif">
<main style="max-width:520px;margin:12vh auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 8px">${escapeHtml(input.title)}</h1>
<p style="line-height:1.5;margin:0 0 16px">${escapeHtml(input.text)}</p>
<p style="margin:0"><a href="${escapeHtml(profile)}">Открыть подписки</a></p>
</main>
</body>
</html>`;
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
      userId: true,
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

  const batchNotes = [...batch.values()].flat();
  const [events, labels, actorNames] = await Promise.all([
    client.prisma.maintenanceEvent.findMany({
      where: { id: { in: eventIds } },
      select: {
        id: true,
        title: true,
        sandboxId: true,
        aircraft: { select: { tailNumber: true } }
      }
    }),
    loadWatchLabels(client.prisma, batchNotes),
    loadActorNames(
      client.prisma,
      batchNotes.map((note) => note.actor)
    )
  ]);
  const byId = new Map(events.map((ev) => [ev.id, ev]));

  const byRecipient = new Map<string, WatchEventSection[]>();
  for (const sub of active) {
    const email = sub.user.email.trim().toLowerCase();
    const notes = auditsForRecipient(batch.get(sub.eventId) ?? [], email);
    if (!notes.length) continue;
    const ev = byId.get(sub.eventId);
    const blocks = watchBlocks(notes, labels, actorNames);
    if (!blocks.length) continue;
    const section: WatchEventSection = {
      title: ev?.title?.trim() || "Событие",
      aircraft: ev?.aircraft?.tailNumber?.trim() || "",
      blocks,
      link: eventWatchLink(sub.eventId, ev?.sandboxId ?? null),
      unsubscribeLink: eventUnsubscribeLink(sub.userId, sub.eventId)
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
