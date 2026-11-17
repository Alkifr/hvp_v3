import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, Prisma } from "@prisma/client";

import { EventStatus } from "../../lib/eventStatusCatalog.js";
import { DONE_SCHEDULE_LOCK_MESSAGE, isDoneScheduleLocked } from "../../lib/eventStatus.js";
import { UserMsg } from "../../lib/userErrors.js";
import { isVirtualAircraftPlaceholder, virtualAircraftDisplayLabel } from "../../lib/virtualAircraft.js";
import { buildTowBoardRow, type TowBoardInput } from "../../lib/towBoard.js";
import { buildTowRegistryLetter } from "../../lib/towRegistryMail.js";
import { DEFAULT_TOW_SUBJECT, readTowMailTemplate } from "../../lib/towMailTemplate.js";
import { deliverTowRegistrySend, dispatchTowTriggers } from "../../lib/towRegistryDispatch.js";
import { buildTowPlanRows, type TowPlanEvent, type TowPlanHangar } from "../../lib/towPlan.js";
import { recordTowFieldChanges } from "../../lib/towEdgeCreate.js";
import {
  buildRegistryRows,
  markRegistryRows,
  readRegistrySnapshot,
  registryPeriodLabel,
  readSendRows,
  compareSentRows,
  towChangeRows,
  type RegistryEdgeRole,
  type RegistryEventInput
} from "../../lib/towRegistry.js";
import { formatMskDateTime, buildTowReportRow, TOW_EXPORT_COLUMNS, type TowPlacementInput, type TowReportRow } from "../../lib/towReport.js";
import { ensureTowNorms } from "../../lib/towNorm.js";
import { EDGE_TOW_NORM_CODE } from "../../lib/edgeTows.js";
import { isSmtpReady, smtpConfigFromSettings } from "../../lib/mailer.js";
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

function periodLabel(from: Date, to: Date): string {
  return registryPeriodLabel(from, to);
}

async function collectRegistryItems(prisma: any, req: any, body: z.infer<typeof zRange>): Promise<TowReportRow[]> {
  return (await loadTowReportItems(prisma, req, body.from, body.to))
    .filter((row) => {
      if (body.hangarIds?.length && !body.hangarIds.includes(row.hangarId)) return false;
      if (body.operatorIds?.length && !body.operatorIds.includes(row.operatorId)) return false;
      if (body.aircraftTypeIds?.length && !body.aircraftTypeIds.includes(row.aircraftTypeId)) return false;
      if (body.aircraftIds?.length && !body.aircraftIds.includes(row.aircraftId)) return false;
      return true;
    })
    .map((row, index) => ({ ...row, seq: index + 1 }));
}

function registrySnapshot(items: TowReportRow[]): Array<Record<string, string>> {
  return items.map((row) => {
    const stored: Record<string, string> = {
      id: row.id,
      eventId: row.eventId,
      tailNumber: row.tailNumber,
      eventTitle: row.eventTitle,
      hangarNumber: row.hangarNumber
    };
    for (const column of TOW_EXPORT_COLUMNS) {
      const value = row[column.key];
      stored[column.key] = value == null ? "" : String(value);
    }
    return stored;
  });
}

const SEND_HISTORY_LIMIT = 200;

async function loadRegistry(prisma: any, req: any, from: Date, to: Date) {
  await ensureTowNorms(prisma);
  const norm = await prisma.towNorm.findUnique({ where: { code: EDGE_TOW_NORM_CODE } });
  const minutes = norm && norm.isActive && norm.minutes > 0 ? norm.minutes : null;
  const events = await prisma.maintenanceEvent.findMany({
    where: {
      ...sandboxFilter(req),
      status: { notIn: [EventStatus.DELETED, EventStatus.CANCELLED] },
      OR: [
        { startAt: { lt: to }, endAt: { gt: from } },
        { actualStartAt: { lt: to }, actualEndAt: { gt: from } },
        { placements: { some: { startAt: { lt: to }, endAt: { gt: from } } } },
        { placements: { some: { actualStartAt: { lt: to }, actualEndAt: { gt: from } } } }
      ]
    },
    include: {
      aircraft: { include: { operator: true, type: true } },
      hangar: true,
      placements: {
        include: { hangar: true, stand: true },
        orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }]
      },
      towSegments: { orderBy: [{ startAt: "asc" }] },
      towWaivers: { select: { role: true } }
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }]
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
    ? await prisma.operator.findMany({
        where: { id: { in: [...operatorIds] } },
        select: { id: true, code: true, name: true }
      })
    : [];
  const types = typeIds.size
    ? await prisma.aircraftType.findMany({
        where: { id: { in: [...typeIds] } },
        select: { id: true, icaoType: true, name: true }
      })
    : [];
  const operatorById = new Map(operators.map((row: { id: string; code: string; name: string }) => [row.id, row.code || row.name]));
  const typeById = new Map(types.map((row: { id: string; icaoType: string | null; name: string }) => [row.id, row.icaoType || row.name]));

  const inputs: RegistryEventInput[] = events.map((event: any) => {
    const virtual = event.virtualAircraft as { operatorId?: string; aircraftTypeId?: string } | null;
    const waivedRoles = (event.towWaivers as Array<{ role: string }>)
      .map((waiver) => waiver.role)
      .filter((role): role is RegistryEdgeRole => role === "event-in" || role === "event-out");
    return {
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
      createdAt: event.createdAt,
      placements: event.placements.map((placement: any) => ({
        id: placement.id,
        origin: placement.origin === "AUTO_GAP" ? "AUTO_GAP" : "MANUAL",
        startAt: placement.startAt,
        endAt: placement.endAt,
        hangarId: placement.hangarId,
        hangarName: placement.hangar?.name ?? null,
        hangarCode: placement.hangar?.code ?? null,
        standCode: placement.stand?.code || placement.stand?.name || null
      })),
      tows: event.towSegments.map((tow: any) => ({
        id: tow.id,
        placementId: tow.placementId,
        startAt: tow.startAt,
        endAt: tow.endAt,
        fromLabel: tow.fromLabel,
        toLabel: tow.toLabel
      })),
      waivedRoles
    };
  });

  const sends = await prisma.towRegistrySend.findMany({
    where: sandboxFilter(req),
    orderBy: { createdAt: "desc" },
    take: SEND_HISTORY_LIMIT
  });
  const history = sends
    .filter((send: any) => Array.isArray(send.rows) && send.rows.some((row: any) => row && typeof row === "object" && "inMark" in row))
    .map((send: any) => ({
      sentAt: send.createdAt.toISOString(),
      fromAt: send.fromAt.toISOString(),
      toAt: send.toAt.toISOString(),
      rows: readRegistrySnapshot(send.rows)
    }));
  const marked = markRegistryRows(buildRegistryRows(inputs, minutes), history, {
    from: from.toISOString(),
    to: to.toISOString()
  });
  return { minutes, ...marked };
}

function hangarLabelOf(hangar: { name?: string | null; code?: string | null } | null | undefined): string {
  return String(hangar?.name ?? hangar?.code ?? "").trim();
}

function hangarNumberOf(hangar: { name?: string | null; code?: string | null } | null | undefined): string {
  const name = String(hangar?.name ?? "").trim();
  const code = String(hangar?.code ?? "").trim();
  const fromName = name.match(/(\d+)/);
  if (/ангар/i.test(name) && fromName) return fromName[1]!;
  const fromCode = code.match(/(\d+)/);
  if (fromCode) return fromCode[1]!;
  return name || code;
}

async function loadTowPlan(prisma: any, req: any, from: Date, to: Date) {
  const events = await prisma.maintenanceEvent.findMany({
    where: {
      ...sandboxFilter(req),
      status: { notIn: [EventStatus.DELETED, EventStatus.CANCELLED] },
      OR: [
        { startAt: { lt: to }, endAt: { gt: from } },
        { actualStartAt: { lt: to }, actualEndAt: { gt: from } },
        { placements: { some: { startAt: { lt: to }, endAt: { gt: from } } } },
        { placements: { some: { actualStartAt: { lt: to }, actualEndAt: { gt: from } } } }
      ]
    },
    include: {
      aircraft: { include: { operator: true, type: true } },
      eventType: true,
      hangar: true,
      placements: { include: { hangar: true, layout: true, stand: true }, orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }] },
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
    ? await prisma.operator.findMany({ where: { id: { in: [...operatorIds] } }, select: { id: true, code: true, name: true } })
    : [];
  const types = typeIds.size
    ? await prisma.aircraftType.findMany({
        where: { id: { in: [...typeIds] } },
        select: { id: true, icaoType: true, name: true }
      })
    : [];
  const operatorById = new Map(operators.map((row: { id: string; code: string; name: string }) => [row.id, row.code || row.name]));
  const typeById = new Map(types.map((row: { id: string; icaoType: string | null; name: string }) => [row.id, row.icaoType || row.name]));
  const inputs: TowPlanEvent[] = events.map((event: any) => {
    const virtual = event.virtualAircraft as { operatorId?: string; aircraftTypeId?: string } | null;
    const hangars = new Map<string, string>();
    const eventHangar = hangarLabelOf(event.hangar);
    if (event.hangarId && eventHangar) hangars.set(event.hangarId, eventHangar);
    for (const placement of event.placements) {
      const label = hangarLabelOf(placement.hangar);
      if (placement.hangarId && label) hangars.set(placement.hangarId, label);
    }
    const hangarList: TowPlanHangar[] = [...hangars.entries()].map(([id, label]) => ({ id, label }));
    return {
      id: event.id,
      status: event.status,
      startAt: event.startAt,
      endAt: event.endAt,
      createdAt: event.createdAt,
      locked: isDoneScheduleLocked(event.status),
      hangarId: event.hangarId,
      hangars: hangarList,
      aircraftTypeId: event.aircraft?.typeId ?? virtual?.aircraftTypeId ?? "",
      aircraftType:
        event.aircraft?.type?.icaoType ||
        event.aircraft?.type?.name ||
        (virtual?.aircraftTypeId ? (typeById.get(virtual.aircraftTypeId) ?? "") : ""),
      aircraftId: event.aircraftId ?? "",
      tailNumber: event.aircraft?.tailNumber || (isVirtualAircraftPlaceholder(event) ? virtualAircraftDisplayLabel() : ""),
      operatorId: event.aircraft?.operatorId ?? virtual?.operatorId ?? "",
      operator:
        event.aircraft?.operator?.code ||
        event.aircraft?.operator?.name ||
        (virtual?.operatorId ? (operatorById.get(virtual.operatorId) ?? "") : ""),
      eventTitle: event.title ?? "",
      eventType: event.eventType?.name || event.eventType?.code || "",
      placements: event.placements.map((placement: any) => ({
        id: placement.id,
        origin: placement.origin === "AUTO_GAP" ? "AUTO_GAP" : "MANUAL",
        startAt: placement.startAt,
        endAt: placement.endAt,
        hangarId: placement.hangarId,
        hangarLabel: hangarLabelOf(placement.hangar),
        hangarNumber: hangarNumberOf(placement.hangar),
        layoutName: placement.layout?.name || placement.layout?.code || null,
        standCode: placement.stand?.code || placement.stand?.name || null
      })),
      tows: event.towSegments.map((tow: any) => ({
        id: tow.id,
        startAt: tow.startAt,
        endAt: tow.endAt,
        fromLabel: tow.fromLabel,
        toLabel: tow.toLabel,
        placementId: tow.placementId,
        occupancyEndAt: tow.occupancyEndAt
      }))
    };
  });
  const rows = buildTowPlanRows(inputs, from, to);
  const previous = await prisma.towRegistrySend.findFirst({
    where: { sandboxId: sandboxIdFor(req), fromAt: from, toAt: to },
    orderBy: { createdAt: "desc" }
  });
  const known = new Set(
    previous ? readSendRows(previous.rows).map((row) => row.eventId).filter(Boolean) : []
  );
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return rows.map((row) => ({
    ...row,
    isNew: previous ? !known.has(row.eventId) : row.createdAt >= fromIso && row.createdAt < toIso
  }));
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

  app.get("/plan", async (req) => {
    assertPermission(req, "tows:read");
    const query = zRange.parse((req.query ?? {}) as any);
    return { items: await loadTowPlan(app.prisma, req, query.from, query.to) };
  });

  app.get("/registry", async (req) => {
    assertPermission(req, "tows:read");
    const query = zRange.parse((req.query ?? {}) as any);
    return loadRegistry(app.prisma, req, query.from, query.to);
  });

  app.get("/sends", async (req) => {
    assertAnyPermission(req, ["tows:read", "mail:send", "admin:mail"]);
    const sends = await app.prisma.towRegistrySend.findMany({
      where: sandboxFilter(req),
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return {
      items: sends.map((send) => ({
        id: send.id,
        fromAt: send.fromAt.toISOString(),
        toAt: send.toAt.toISOString(),
        fromMsk: formatMskDateTime(send.fromAt),
        toMsk: formatMskDateTime(send.toAt),
        actor: send.actor,
        subject: send.subject,
        note: send.note ?? "",
        recipients: Array.isArray(send.recipients) ? send.recipients.map(String) : [],
        messageId: send.messageId ?? "",
        sentAt: send.createdAt.toISOString(),
        sentMsk: formatMskDateTime(send.createdAt),
        rowCount: readSendRows(send.rows).length
      }))
    };
  });

  app.get("/sends/compare", async (req) => {
    assertPermission(req, "tows:read");
    const query = z
      .object({ left: zUuid, right: zUuid })
      .parse((req.query ?? {}) as any);
    const [left, right] = await Promise.all([
      app.prisma.towRegistrySend.findFirst({ where: { id: query.left, ...sandboxFilter(req) } }),
      app.prisma.towRegistrySend.findFirst({ where: { id: query.right, ...sandboxFilter(req) } })
    ]);
    if (!left || !right) throw app.httpErrors.notFound(UserMsg.RECORD_NOT_FOUND);
    return compareSentRows(left.rows, right.rows);
  });

  app.get("/changes", async (req) => {
    assertPermission(req, "tows:read");
    const query = z.object({ eventId: zUuid }).parse((req.query ?? {}) as any);
    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: query.eventId, ...sandboxFilter(req) },
      select: { id: true }
    });
    if (!event) throw app.httpErrors.notFound(UserMsg.EVENT_NOT_FOUND);
    const items = await app.prisma.towFieldChange.findMany({
      where: { eventId: query.eventId },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        towId: item.towId ?? "",
        actor: item.actor,
        field: item.field,
        before: item.before,
        after: item.after,
        reason: item.reason ?? "",
        createdAt: item.createdAt.toISOString(),
        createdMsk: formatMskDateTime(item.createdAt)
      }))
    };
  });

  app.post("/waiver", async (req) => {
    assertCanWriteTow(req);
    const body = z
      .object({
        eventId: zUuid,
        role: z.enum(["event-in", "event-out"]),
        waived: z.boolean()
      })
      .parse(req.body ?? {});
    const event = await app.prisma.maintenanceEvent.findFirst({
      where: { id: body.eventId, ...sandboxFilter(req) },
      include: {
        placements: { orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }] },
        towSegments: true,
        towWaivers: { select: { role: true } }
      }
    });
    if (!event) throw app.httpErrors.notFound(UserMsg.EVENT_NOT_FOUND);
    if (isDoneScheduleLocked(event.status)) throw app.httpErrors.badRequest(DONE_SCHEDULE_LOCK_MESSAGE);
    const input: RegistryEventInput = {
      id: event.id,
      title: event.title,
      status: event.status,
      startAt: event.startAt,
      endAt: event.endAt,
      hangarId: event.hangarId,
      hangarName: null,
      hangarCode: null,
      tailNumber: null,
      aircraftId: event.aircraftId,
      virtual: false,
      aircraftTypeId: null,
      aircraftType: null,
      operatorId: null,
      operator: null,
      placements: event.placements.map((placement) => ({
        id: placement.id,
        origin: placement.origin === "AUTO_GAP" ? "AUTO_GAP" : "MANUAL",
        startAt: placement.startAt,
        endAt: placement.endAt,
        hangarId: placement.hangarId,
        hangarName: null,
        hangarCode: null,
        standCode: null
      })),
      tows: event.towSegments.map((tow) => ({
        id: tow.id,
        placementId: tow.placementId,
        startAt: tow.startAt,
        endAt: tow.endAt,
        fromLabel: tow.fromLabel,
        toLabel: tow.toLabel
      })),
      waivedRoles: event.towWaivers
        .map((waiver) => waiver.role)
        .filter((role): role is RegistryEdgeRole => role === "event-in" || role === "event-out")
    };
    const [row] = buildRegistryRows([input], null);
    const edge = body.role === "event-in" ? row?.inEdge : row?.outEdge;
    if (body.waived && edge?.state === "assigned") {
      throw app.httpErrors.badRequest("На этом крае уже есть буксировка");
    }
    const label = body.role === "event-in" ? "Закатка" : "Выкатка";
    const sbId = sandboxIdFor(req);
    if (body.waived) {
      await app.prisma.eventTowWaiver.upsert({
        where: { eventId_role: { eventId: body.eventId, role: body.role } },
        create: { eventId: body.eventId, sandboxId: sbId, role: body.role, actor: getActor(req) },
        update: { actor: getActor(req) }
      });
    } else {
      await app.prisma.eventTowWaiver.deleteMany({ where: { eventId: body.eventId, role: body.role } });
    }
    await recordTowFieldChanges(
      app.prisma,
      towChangeRows({
        eventId: body.eventId,
        sandboxId: sbId,
        actor: getActor(req),
        reason: body.waived ? "Буксировка не требуется" : "Край снова ожидает буксировку",
        pairs: [
          {
            field: label,
            before: body.waived ? edge?.state === "waived" ? "не требуется" : "не назначена" : "не требуется",
            after: body.waived ? "не требуется" : "не назначена"
          }
        ]
      })
    );
    return { ok: true as const };
  });

  app.post("/fix", async (req) => {
    assertCanWriteTow(req);
    const body = zRange.parse(req.body ?? {});
    const items = await collectRegistryItems(app.prisma, req, body);
    if (!items.length) {
      throw app.httpErrors.badRequest("В выбранном периоде нет назначенных буксировок");
    }
    const template = await readTowMailTemplate(app.prisma).catch(() => ({
      subjectTemplate: DEFAULT_TOW_SUBJECT,
      bodyTemplate: ""
    }));
    const contour = (req as any).sandbox?.name ? `Песочница «${(req as any).sandbox.name}»` : "Рабочий контур";
    const letter = buildTowRegistryLetter({
      rows: items,
      periodLabel: periodLabel(body.from, body.to),
      contour,
      subjectTemplate: template.subjectTemplate
    });
    const saved = await app.prisma.towRegistrySend.create({
      data: {
        sandboxId: sandboxIdFor(req),
        fromAt: body.from,
        toAt: body.to,
        actor: getActor(req),
        recipients: [],
        note: null,
        subject: letter.subject,
        rows: registrySnapshot(items)
      }
    });
    await dispatchTowTriggers(app.prisma, saved.id).catch((err) => app.log.warn({ err }, "tow trigger mail failed"));
    return { ok: true as const, sendId: saved.id, subject: letter.subject, rows: items.length };
  });

  app.post("/dispatch", async (req) => {
    assertAnyPermission(req, ["mail:send", "admin:mail"]);
    const body = z
      .object({
        sendId: zUuid,
        recipients: z.array(z.string().trim().email().max(200)).max(50).optional(),
        target: z.enum(["self", "list"]).optional()
      })
      .parse(req.body ?? {});
    const target = body.target ?? "list";
    const selfEmail = String((req as any).auth?.email ?? "").trim().toLowerCase();
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
    const existing = await app.prisma.towRegistrySend.findFirst({ where: { id: body.sendId, ...sandboxFilter(req) } });
    if (!existing) throw app.httpErrors.notFound(UserMsg.RECORD_NOT_FOUND);
    const result = await deliverTowRegistrySend(app.prisma, {
      sendId: existing.id,
      recipients,
      smtp: settings,
      target: target === "self" ? "self" : "all",
      actorEmail: getActor(req),
      variantName: "Буксировки"
    });
    if (!result.ok) throw app.httpErrors.badRequest(result.error || "Не удалось отправить письмо");
    return { ok: true as const, recipients: result.recipients, subject: result.subject, rows: result.rows, sendId: existing.id };
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
    const shortShift = startChanged && Math.abs(nextStart.getTime() - existing.startAt.getTime()) < 60 * 60_000;
    if (shortShift && !String(body.startChangeReason ?? "").trim()) {
      throw app.httpErrors.badRequest("Укажите причину изменения времени начала буксировки меньше чем на 60 минут");
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

    const textOr = (value: string | null | undefined) => String(value ?? "");
    await recordTowFieldChanges(
      app.prisma,
      towChangeRows({
        eventId: existing.eventId,
        towId: id,
        sandboxId: sandboxIdFor(req),
        actor: getActor(req),
        reason: body.changeReason ?? body.startChangeReason ?? "Буксировка",
        pairs: [
          { field: "Начало буксировки (мск)", before: formatMskDateTime(existing.startAt), after: formatMskDateTime(nextStart) },
          { field: "Окончание буксировки (мск)", before: formatMskDateTime(existing.endAt), after: formatMskDateTime(nextTowEnd) },
          { field: "Откуда", before: textOr(existing.fromLabel), after: textOr(updated.fromLabel) },
          { field: "Куда", before: textOr(existing.toLabel), after: textOr(updated.toLabel) },
          { field: "Примечание", before: textOr(existing.notes), after: textOr(updated.notes) },
          { field: "Позиция", before: textOr(existing.positionComment), after: textOr(updated.positionComment) },
          {
            field: "Окончание занятия МС (мск)",
            before: existing.occupancyEndAt ? formatMskDateTime(existing.occupancyEndAt) : "",
            after: updated.occupancyEndAt ? formatMskDateTime(updated.occupancyEndAt) : ""
          },
          { field: "Причина сдвига начала", before: textOr(existing.startChangeReason), after: textOr(updated.startChangeReason) }
        ]
      })
    );

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
