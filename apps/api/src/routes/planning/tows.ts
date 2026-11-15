import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, Prisma } from "@prisma/client";

import { EventStatus } from "../../lib/eventStatusCatalog.js";
import { DONE_SCHEDULE_LOCK_MESSAGE, isDoneScheduleLocked } from "../../lib/eventStatus.js";
import { UserMsg } from "../../lib/userErrors.js";
import { virtualAircraftDisplayLabel } from "../../lib/virtualAircraft.js";
import { buildTowBoardRow, type TowBoardInput } from "../../lib/towBoard.js";
import { buildTowRegistryLetter } from "../../lib/towRegistryMail.js";
import { formatMskDateTime, buildTowReportRow, type TowPlacementInput, type TowReportRow } from "../../lib/towReport.js";
import { ensureTowNorms } from "../../lib/towNorm.js";
import { EDGE_TOW_NORM_CODE } from "../../lib/edgeTows.js";
import { isSmtpReady, sendMail, smtpConfigFromSettings } from "../../lib/mailer.js";
import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertAnyPermission, assertPermission } from "../../lib/rbac.js";
import {
  assertChangeReasonIfNeeded,
  canWriteInContext,
  sandboxFilter,
  sandboxIdFor
} from "../../plugins/sandbox.js";

export const towInclude = {
  fromStand: true,
  toStand: true,
  placement: { include: { hangar: true, stand: true } },
  event: {
    include: {
      aircraft: { include: { operator: true, type: true } },
      hangar: true,
      eventType: true,
      customerSlot: true,
      reservations: { include: { stand: true }, orderBy: [{ startAt: "asc" }] },
      placements: {
        include: { hangar: true, stand: true },
        orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }]
      }
    }
  }
} satisfies Prisma.EventTowInclude;

type TowLoaded = Prisma.EventTowGetPayload<{ include: typeof towInclude }>;

function assertCanWriteTow(req: any) {
  if (req.sandbox) {
    if (!canWriteInContext(req)) {
      const err: any = new Error("SANDBOX_READ_ONLY");
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  assertAnyPermission(req, ["tows:write", "events:write"]);
}

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  const h = req.headers ?? {};
  return String(h["x-actor"] ?? h["x-user"] ?? "browser").slice(0, 80);
}

function standCode(stand?: { code?: string | null; name?: string | null } | null): string | null {
  const code = String(stand?.code ?? "").trim();
  if (code) return code;
  const name = String(stand?.name ?? "").trim();
  return name || null;
}

function placementsOf(event: TowLoaded["event"]): TowPlacementInput[] {
  return (event.placements ?? []).map((p) => ({
    id: p.id,
    startAt: p.startAt,
    endAt: p.endAt,
    hangarId: p.hangarId ?? p.hangar?.id ?? null,
    hangarCode: p.hangar?.code ?? null,
    hangarName: p.hangar?.name ?? null,
    standCode: standCode(p.stand)
  }));
}

export function serializeTowReportRow(
  tow: TowLoaded,
  virtualNames?: { operator?: string | null; aircraftType?: string | null }
): TowReportRow {
  const event = tow.event;
  const virtual = event.virtualAircraft as { operatorId?: string; aircraftTypeId?: string; label?: string } | null;
  const tailNumber = event.aircraft?.tailNumber ?? (virtual ? virtualAircraftDisplayLabel() : null);
  const hangar = tow.placement?.hangar ?? event.hangar;
  return buildTowReportRow({
    id: tow.id,
    eventId: event.id,
    startAt: tow.startAt,
    endAt: tow.endAt,
    fromLabel: tow.fromLabel,
    toLabel: tow.toLabel,
    notes: tow.notes,
    positionComment: tow.positionComment,
    startChangeReason: tow.startChangeReason,
    occupancyEndAt: tow.occupancyEndAt,
    fromStandCode: standCode(tow.fromStand),
    toStandCode: standCode(tow.toStand),
    placementId: tow.placementId,
    eventTitle: event.title,
    eventStatus: event.status,
    eventTypeId: event.eventType?.id ?? event.eventTypeId ?? null,
    eventType: event.eventType?.name ?? null,
    eventNotes: event.notes,
    eventStartAt: event.startAt,
    eventEndAt: event.endAt,
    hangarId: hangar?.id ?? event.hangarId ?? null,
    hangarCode: hangar?.code ?? null,
    hangarName: hangar?.name ?? null,
    reservationStandCode: standCode(event.reservations[0]?.stand ?? null) || standCode(tow.placement?.stand ?? null),
    tailNumber,
    aircraftId: event.aircraftId ?? (virtual ? `virt:${event.id}` : null),
    aircraftType: event.aircraft?.type?.icaoType || event.aircraft?.type?.name || virtualNames?.aircraftType || null,
    aircraftTypeId: event.aircraft?.typeId ?? virtual?.aircraftTypeId ?? null,
    operator: event.aircraft?.operator?.code || event.aircraft?.operator?.name || virtualNames?.operator || null,
    operatorId: event.aircraft?.operatorId ?? virtual?.operatorId ?? null,
    customerSlotStartAt: event.customerSlot?.startAt ?? null,
    customerSlotEndAt: event.customerSlot?.endAt ?? null,
    placements: placementsOf(event)
  });
}

export async function resolveVirtualNames(
  prisma: Prisma.TransactionClient | any,
  tows: TowLoaded[]
): Promise<Map<string, { operator: string | null; aircraftType: string | null }>> {
  const operatorIds = new Set<string>();
  const typeIds = new Set<string>();
  for (const tow of tows) {
    if (tow.event.aircraftId) continue;
    const virtual = tow.event.virtualAircraft as { operatorId?: string; aircraftTypeId?: string } | null;
    if (virtual?.operatorId) operatorIds.add(virtual.operatorId);
    if (virtual?.aircraftTypeId) typeIds.add(virtual.aircraftTypeId);
  }
  const operators = operatorIds.size
    ? await prisma.operator.findMany({ where: { id: { in: [...operatorIds] } }, select: { id: true, code: true, name: true } })
    : ([] as Array<{ id: string; code: string; name: string }>);
  const types = typeIds.size
    ? await prisma.aircraftType.findMany({
        where: { id: { in: [...typeIds] } },
        select: { id: true, icaoType: true, name: true }
      })
    : ([] as Array<{ id: string; icaoType: string | null; name: string }>);
  const opById = new Map<string, string>();
  for (const o of operators as Array<{ id: string; code: string; name: string }>) {
    opById.set(o.id, o.code || o.name);
  }
  const typeById = new Map<string, string>();
  for (const t of types as Array<{ id: string; icaoType: string | null; name: string }>) {
    typeById.set(t.id, t.icaoType || t.name);
  }
  const out = new Map<string, { operator: string | null; aircraftType: string | null }>();
  for (const tow of tows) {
    const virtual = tow.event.virtualAircraft as { operatorId?: string; aircraftTypeId?: string } | null;
    out.set(tow.id, {
      operator: virtual?.operatorId ? (opById.get(virtual.operatorId) ?? null) : null,
      aircraftType: virtual?.aircraftTypeId ? (typeById.get(virtual.aircraftTypeId) ?? null) : null
    });
  }
  return out;
}

const zIdList = z.array(z.string().trim().min(1).max(80)).max(200);

const zRange = z
  .object({
    from: zDateTime,
    to: zDateTime,
    q: z.string().trim().max(200).optional(),
    hangarIds: zIdList.optional(),
    operatorIds: zIdList.optional(),
    aircraftTypeIds: zIdList.optional(),
    aircraftIds: zIdList.optional(),
    recipients: z.array(z.string().trim().email().max(200)).max(50).optional(),
    target: z.enum(["self", "list"]).optional(),
    note: z.string().trim().max(2000).optional()
  })
  .refine((v) => v.to > v.from, { message: UserMsg.END_AFTER_START });

async function loadTowReportItems(prisma: any, req: any, from: Date, to: Date): Promise<TowReportRow[]> {
  const rows = await prisma.eventTow.findMany({
    where: {
      ...sandboxFilter(req),
      startAt: { lt: to },
      endAt: { gt: from },
      event: { status: { not: EventStatus.DELETED } }
    },
    include: towInclude,
    orderBy: [{ startAt: "asc" }, { id: "asc" }]
  });
  const virtualNames = await resolveVirtualNames(prisma, rows);
  return rows.map((row: TowLoaded) => serializeTowReportRow(row, virtualNames.get(row.id)));
}

function rowMatchesSendFilters(
  row: TowReportRow,
  filters: { hangarIds?: string[]; operatorIds?: string[]; aircraftTypeIds?: string[]; aircraftIds?: string[] }
): boolean {
  if (filters.hangarIds?.length && !filters.hangarIds.includes(row.hangarId)) return false;
  if (filters.operatorIds?.length && !filters.operatorIds.includes(row.operatorId)) return false;
  if (filters.aircraftTypeIds?.length && !filters.aircraftTypeIds.includes(row.aircraftTypeId)) return false;
  if (filters.aircraftIds?.length && !filters.aircraftIds.includes(row.aircraftId)) return false;
  return true;
}

function periodLabel(from: Date, to: Date): string {
  const end = new Date(to.getTime() - 60_000);
  return `${formatMskDateTime(from).slice(0, 10)}–${formatMskDateTime(end).slice(0, 10)}`;
}

export const towsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req, "tows:read");
    const query = zRange.parse((req.query ?? {}) as any);

    const q = query.q?.toLowerCase() ?? "";
    const items = (await loadTowReportItems(app.prisma, req, query.from, query.to))
      .filter((row) => {
        if (!q) return true;
        const hay = [
          row.hangarNumber,
          row.aircraftType,
          row.tailNumber,
          row.operator,
          row.fromStand,
          row.toStand,
          row.notes,
          row.eventTitle,
          row.positionComment
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .map((row, idx) => ({ ...row, seq: idx + 1 }));

    return { items };
  });

  app.get("/board", async (req) => {
    assertPermission(req, "tows:read");
    const query = zRange.parse((req.query ?? {}) as any);
    await ensureTowNorms(app.prisma);
    const norm = await app.prisma.towNorm.findUnique({ where: { code: EDGE_TOW_NORM_CODE } });
    const minutes = norm && norm.isActive && norm.minutes > 0 ? norm.minutes : null;

    const events = await app.prisma.maintenanceEvent.findMany({
      where: {
        ...sandboxFilter(req),
        status: { notIn: [EventStatus.DELETED, EventStatus.CANCELLED] },
        OR: [
          { startAt: { lt: query.to }, endAt: { gt: query.from } },
          { actualStartAt: { lt: query.to }, actualEndAt: { gt: query.from } },
          { placements: { some: { startAt: { lt: query.to }, endAt: { gt: query.from } } } },
          { placements: { some: { actualStartAt: { lt: query.to }, actualEndAt: { gt: query.from } } } }
        ]
      },
      include: {
        aircraft: { include: { operator: true, type: true } },
        hangar: true,
        placements: {
          include: { hangar: true, stand: true },
          orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }]
        },
        towSegments: { orderBy: [{ startAt: "asc" }] }
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }]
    });

    const operatorIds = new Set<string>();
    const typeIds = new Set<string>();
    for (const event of events) {
      if (event.aircraftId) continue;
      const virtual = event.virtualAircraft as { operatorId?: string; aircraftTypeId?: string } | null;
      if (virtual?.operatorId) operatorIds.add(virtual.operatorId);
      if (virtual?.aircraftTypeId) typeIds.add(virtual.aircraftTypeId);
    }
    const operators = operatorIds.size
      ? await app.prisma.operator.findMany({
          where: { id: { in: [...operatorIds] } },
          select: { id: true, code: true, name: true }
        })
      : [];
    const types = typeIds.size
      ? await app.prisma.aircraftType.findMany({
          where: { id: { in: [...typeIds] } },
          select: { id: true, icaoType: true, name: true }
        })
      : [];
    const operatorById = new Map(operators.map((row) => [row.id, row.code || row.name]));
    const typeById = new Map(types.map((row) => [row.id, row.icaoType || row.name]));

    const items = events.map((event) => {
      const virtual = event.virtualAircraft as { operatorId?: string; aircraftTypeId?: string } | null;
      const input: TowBoardInput = {
        id: event.id,
        title: event.title,
        status: event.status,
        startAt: event.startAt,
        endAt: event.endAt,
        hangarId: event.hangarId,
        hangarName: event.hangar?.name ?? null,
        hangarCode: event.hangar?.code ?? null,
        tailNumber: event.aircraft?.tailNumber ?? null,
        aircraftId: event.aircraftId,
        virtual: !event.aircraftId && virtual != null,
        aircraftTypeId: event.aircraft?.typeId ?? virtual?.aircraftTypeId ?? null,
        aircraftType:
          event.aircraft?.type?.icaoType ||
          event.aircraft?.type?.name ||
          (virtual?.aircraftTypeId ? (typeById.get(virtual.aircraftTypeId) ?? null) : null),
        operatorId: event.aircraft?.operatorId ?? virtual?.operatorId ?? null,
        operator:
          event.aircraft?.operator?.code ||
          event.aircraft?.operator?.name ||
          (virtual?.operatorId ? (operatorById.get(virtual.operatorId) ?? null) : null),
        placements: event.placements.map((placement) => ({
          id: placement.id,
          origin: placement.origin === "AUTO_GAP" ? "AUTO_GAP" : "MANUAL",
          startAt: placement.startAt,
          endAt: placement.endAt,
          hangarId: placement.hangarId,
          hangarName: placement.hangar?.name ?? null,
          hangarCode: placement.hangar?.code ?? null,
          standCode: placement.stand?.code || placement.stand?.name || null
        })),
        tows: event.towSegments.map((tow) => ({
          id: tow.id,
          placementId: tow.placementId,
          occupancyEndAt: tow.occupancyEndAt,
          startChangeReason: tow.startChangeReason,
          startAt: tow.startAt,
          endAt: tow.endAt,
          fromLabel: tow.fromLabel,
          toLabel: tow.toLabel
        }))
      };
      return buildTowBoardRow(input, minutes);
    });

    return { minutes, items };
  });

  app.post("/send", async (req) => {
    assertCanWriteTow(req);
    const body = zRange.parse(req.body ?? {});

    const target = body.target ?? "list";
    const selfEmail = String((req as any).auth?.email ?? "")
      .trim()
      .toLowerCase();
    const recipients =
      target === "self"
        ? selfEmail
          ? [selfEmail]
          : []
        : [...new Set((body.recipients ?? []).map((email) => email.trim().toLowerCase()))];
    if (!recipients.length) {
      throw app.httpErrors.badRequest(target === "self" ? "У учётной записи нет адреса почты" : "Укажите получателей");
    }

    const settings = await app.prisma.mailDigestSettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {}
    });
    if (!isSmtpReady(settings)) {
      throw app.httpErrors.badRequest("Почта не настроена. SMTP задаёт администратор в разделе «Рассылка».");
    }
    const smtp = smtpConfigFromSettings(settings);
    if (!smtp) {
      throw app.httpErrors.badRequest("Почта не настроена. SMTP задаёт администратор в разделе «Рассылка».");
    }

    const items = (await loadTowReportItems(app.prisma, req, body.from, body.to))
      .filter((row) => rowMatchesSendFilters(row, body))
      .map((row, idx) => ({ ...row, seq: idx + 1 }));
    if (!items.length) {
      throw app.httpErrors.badRequest("В выбранном периоде нет буксировок для отправки");
    }

    const contour = (req as any).sandbox?.name ? `Песочница «${(req as any).sandbox.name}»` : "Рабочий контур";
    const letter = buildTowRegistryLetter({
      rows: items,
      periodLabel: periodLabel(body.from, body.to),
      contour,
      note: body.note
    });

    try {
      const sent = await sendMail(smtp, {
        to: recipients,
        subject: letter.subject,
        text: letter.text,
        html: letter.html
      });
      return { ok: true as const, messageId: sent.messageId, recipients, subject: letter.subject, rows: items.length };
    } catch (e) {
      throw app.httpErrors.badRequest(e instanceof Error ? e.message : "Не удалось отправить письмо");
    }
  });

  app.patch("/:id", async (req) => {
    assertCanWriteTow(req);
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        startAt: zDateTime.optional(),
        endAt: zDateTime.optional(),
        fromStandId: zUuid.nullable().optional(),
        toStandId: zUuid.nullable().optional(),
        fromLabel: z.string().trim().max(120).nullable().optional(),
        toLabel: z.string().trim().max(120).nullable().optional(),
        placementId: zUuid.nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
        positionComment: z.string().trim().max(2000).nullable().optional(),
        occupancyEndAt: zDateTime.nullable().optional(),
        startChangeReason: z.string().trim().max(1000).nullable().optional(),
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .parse(req.body);

    const existing = await app.prisma.eventTow.findFirst({
      where: { id, ...sandboxFilter(req) },
      include: { event: { select: { id: true, status: true, startAt: true, endAt: true } } }
    });
    if (!existing) throw app.httpErrors.notFound(UserMsg.RECORD_NOT_FOUND);
    if (isDoneScheduleLocked(existing.event.status)) {
      throw app.httpErrors.badRequest(DONE_SCHEDULE_LOCK_MESSAGE);
    }

    const nextStart = body.startAt ?? existing.startAt;
    const nextTowEnd = body.endAt ?? existing.endAt;
    if (nextTowEnd <= nextStart) throw app.httpErrors.badRequest(UserMsg.END_AFTER_START);
    if (nextStart < existing.event.startAt || nextTowEnd > existing.event.endAt) {
      throw app.httpErrors.badRequest(UserMsg.TOW_WITHIN_EVENT);
    }
    const nextOccupancyEnd = body.occupancyEndAt === undefined ? existing.occupancyEndAt : body.occupancyEndAt;
    if (nextOccupancyEnd && nextOccupancyEnd.getTime() <= nextStart.getTime()) {
      throw app.httpErrors.badRequest("Окончание занятия МС должно быть позже начала буксировки");
    }

    const startChanged = body.startAt != null && body.startAt.getTime() !== existing.startAt.getTime();
    const endChanged = body.endAt != null && body.endAt.getTime() !== existing.endAt.getTime();
    const scheduleChanged = startChanged || endChanged;
    if (startChanged && !String(body.startChangeReason ?? "").trim()) {
      throw app.httpErrors.badRequest("Укажите причину изменения времени начала буксировки");
    }
    assertChangeReasonIfNeeded(req, true, body.changeReason ?? body.startChangeReason ?? "Буксировка");

    if (body.placementId) {
      const placement = await app.prisma.eventPlacement.findFirst({
        where: { id: body.placementId, eventId: existing.eventId, ...sandboxFilter(req) },
        select: { id: true }
      });
      if (!placement) throw app.httpErrors.badRequest("Этап размещения не найден у этого события");
    }

    const updated = await app.prisma.eventTow.update({
      where: { id },
      data: {
        startAt: nextStart,
        endAt: nextTowEnd,
        occupancyEndAt: body.occupancyEndAt === undefined ? undefined : body.occupancyEndAt,
        placementId: body.placementId === undefined ? undefined : body.placementId,
        fromStandId: body.fromStandId === undefined ? undefined : body.fromStandId,
        toStandId: body.toStandId === undefined ? undefined : body.toStandId,
        fromLabel: body.fromLabel === undefined ? undefined : body.fromLabel,
        toLabel: body.toLabel === undefined ? undefined : body.toLabel,
        notes: body.notes === undefined ? undefined : body.notes,
        positionComment: body.positionComment === undefined ? undefined : body.positionComment,
        startChangeReason: body.startChangeReason === undefined ? undefined : body.startChangeReason
      },
      include: towInclude
    });

    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId: existing.eventId,
        sandboxId: sandboxIdFor(req),
        action: EventAuditAction.UPDATE,
        actor: getActor(req),
        reason: body.changeReason ?? body.startChangeReason ?? "Буксировка",
        changes: {
          tow: {
            id,
            startAt: scheduleChanged ? { from: existing.startAt.toISOString(), to: nextStart.toISOString() } : undefined,
            endAt: endChanged ? { from: existing.endAt.toISOString(), to: nextTowEnd.toISOString() } : undefined,
            occupancyEndAt: body.occupancyEndAt === undefined ? undefined : body.occupancyEndAt,
            fromLabel: body.fromLabel,
            toLabel: body.toLabel,
            notes: body.notes,
            positionComment: body.positionComment,
            startChangeReason: body.startChangeReason
          }
        }
      }
    });

    const virtualNames = await resolveVirtualNames(app.prisma, [updated]);
    return serializeTowReportRow(updated, virtualNames.get(updated.id));
  });
};
