import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { EventAuditAction, EventStatus, PlanningLevel } from "@prisma/client";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";
import { canWriteInContext, sandboxFilter, sandboxIdFor } from "../../plugins/sandbox.js";

function assertCanWrite(req: any) {
  if (!canWriteInContext(req)) {
    const err: any = new Error("SANDBOX_READ_ONLY");
    err.statusCode = 403;
    throw err;
  }
}

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  const h = req.headers ?? {};
  return String(h["x-actor"] ?? h["x-user"] ?? "browser").slice(0, 80);
}

/** Первый свободный слот на стенде длиной durationMs, начиная с minStart, не выходя за maxEnd */
function findFirstSlot(
  busy: Array<{ start: number; end: number }>,
  minStart: number,
  durationMs: number,
  maxEnd: number
): number | null {
  if (minStart + durationMs > maxEnd) return null;
  let cursor = minStart;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start - cursor >= durationMs) return cursor;
    cursor = Math.max(cursor, b.end);
    if (cursor + durationMs > maxEnd) return null;
  }
  return cursor;
}

type StandEntry = { hangarId: string; layoutId: string; standId: string };

export const massPlanningRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Массовое планирование: виртуальные борта (без реального Aircraft), период [startFrom, endTo].
   * dryRun: true — предпросмотр (placements + unplaced). dryRun: false — создание событий.
   * Непоместившиеся создаются в статусе DRAFT без ангара/места.
   */
  app.post("/", async (req) => {
    assertPermission(req, "events:write");
    assertCanWrite(req);

    const body = z
      .object({
        tatHours: z.number().positive().max(8760),
        operatorId: zUuid,
        aircraftTypeId: zUuid,
        eventTypeId: zUuid,
        count: z.number().int().min(1).max(200),
        startFrom: z.string().transform((s) => new Date(s)),
        endTo: z.string().transform((s) => new Date(s)),
        hangarIds: z.array(zUuid).optional(),
        titleTemplate: z.string().trim().min(1).max(200).optional(),
        dryRun: z.boolean().optional()
      })
      .refine((v) => Number.isFinite(v.startFrom.getTime()), { message: "startFrom must be a valid date" })
      .refine((v) => Number.isFinite(v.endTo.getTime()), { message: "endTo must be a valid date" })
      .refine((v) => v.endTo >= v.startFrom, { message: "endTo must be >= startFrom" })
      .parse(req.body);

    const dryRun = Boolean(body.dryRun);
    const tatMs = body.tatHours * 60 * 60 * 1000;
    const startFromMs = body.startFrom.getTime();
    const endToMs = body.endTo.getTime();
    const windowEnd = new Date(Math.max(endToMs, startFromMs + body.count * tatMs));

    const [eventType, aircraftType, hangarsOrdered, layoutsWithStands, reservations] = await Promise.all([
      app.prisma.eventType.findUniqueOrThrow({ where: { id: body.eventTypeId } }),
      app.prisma.aircraftType.findUniqueOrThrow({ where: { id: body.aircraftTypeId } }),
      body.hangarIds?.length
        ? app.prisma.hangar.findMany({
            where: { id: { in: body.hangarIds }, isActive: true },
            orderBy: []
          }).then((list) => {
            const byId = new Map(list.map((h) => [h.id, h]));
            return body.hangarIds!.map((id) => byId.get(id)).filter(Boolean) as typeof list;
          })
        : app.prisma.hangar.findMany({
            where: { isActive: true },
            orderBy: [{ name: "asc" }]
          }),
      (async () => {
        const hid = body.hangarIds?.length
          ? body.hangarIds
          : (await app.prisma.hangar.findMany({ where: { isActive: true }, select: { id: true }, orderBy: [{ name: "asc" }] })).map((h) => h.id);
        const layouts = await app.prisma.hangarLayout.findMany({
          where: { hangarId: { in: hid }, isActive: true },
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
          include: {
            stands: {
              where: { isActive: true },
              select: { id: true, bodyType: true, code: true },
              orderBy: [{ code: "asc" }]
            },
            hangar: { select: { id: true } }
          }
        });
        const orderIdx = (id: string) => hid.indexOf(id);
        layouts.sort((a, b) => orderIdx(a.hangarId) - orderIdx(b.hangarId));
        return layouts;
      })(),
      app.prisma.standReservation.findMany({
        where: {
          ...sandboxFilter(req),
          startAt: { lt: windowEnd },
          endAt: { gt: body.startFrom },
          event: { status: { not: EventStatus.CANCELLED } }
        },
        select: { standId: true, startAt: true, endAt: true }
      })
    ]);

    const bodyType = aircraftType.bodyType ?? null;
    const standOrder: StandEntry[] = [];
    const hangarIdSet = new Set(hangarsOrdered.map((h) => h.id));
    for (const lay of layoutsWithStands) {
      if (!hangarIdSet.has(lay.hangarId)) continue;
      for (const s of lay.stands) {
        if (bodyType && s.bodyType != null && s.bodyType !== bodyType) continue;
        standOrder.push({ hangarId: lay.hangarId, layoutId: lay.id, standId: s.id });
      }
    }

    const busyByStand = new Map<string, Array<{ start: number; end: number }>>();
    for (const r of reservations) {
      const arr = busyByStand.get(r.standId) ?? [];
      arr.push({ start: r.startAt.getTime(), end: r.endAt.getTime() });
      busyByStand.set(r.standId, arr);
    }
    for (const arr of busyByStand.values()) {
      arr.sort((a, b) => a.start - b.start);
    }

    const hangarOrder = hangarsOrdered.map((h) => h.id);
    standOrder.sort((a, b) => {
      const ai = hangarOrder.indexOf(a.hangarId);
      const bi = hangarOrder.indexOf(b.hangarId);
      return ai - bi;
    });

    const titleBase = body.titleTemplate ?? eventType.name;
    const virtualLabel = (i: number) => `— Масс. ${i + 1}`;

    type PlacementPreview = {
      index: number;
      title: string;
      label: string;
      startAt: number;
      endAt: number;
      hangarId: string;
      layoutId: string;
      standId: string;
    };
    type UnplacedPreview = { index: number; title: string; label: string };

    const placementsPreview: PlacementPreview[] = [];
    const unplacedPreview: UnplacedPreview[] = [];
    const busyByStandWork = new Map(busyByStand);
    const cloneBusy = (standId: string) => [...(busyByStandWork.get(standId) ?? [])];
    const addBusy = (standId: string, start: number, end: number) => {
      const arr = busyByStandWork.get(standId) ?? [];
      arr.push({ start, end });
      arr.sort((a, b) => a.start - b.start);
      busyByStandWork.set(standId, arr);
    };

    for (let i = 0; i < body.count; i++) {
      const title = titleBase.includes("%") ? titleBase.replace("%", String(i + 1)) : `${titleBase} #${i + 1}`;
      const label = virtualLabel(i);
      let bestStart: number | null = null;
      let bestEntry: StandEntry | null = null;

      for (const entry of standOrder) {
        const busy = cloneBusy(entry.standId);
        const minStart = bestStart != null ? bestStart : startFromMs;
        const slot = findFirstSlot(busy, minStart, tatMs, endToMs);
        if (slot == null) continue;
        if (bestStart == null || slot < bestStart) {
          bestStart = slot;
          bestEntry = entry;
        }
      }

      if (bestEntry == null || bestStart == null) {
        unplacedPreview.push({ index: i, title, label });
        continue;
      }

      const endAt = bestStart + tatMs;
      addBusy(bestEntry.standId, bestStart, endAt);
      placementsPreview.push({
        index: i,
        title,
        label,
        startAt: bestStart,
        endAt,
        hangarId: bestEntry.hangarId,
        layoutId: bestEntry.layoutId,
        standId: bestEntry.standId
      });
    }

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        placements: placementsPreview.map((p) => ({
          ...p,
          startAt: new Date(p.startAt).toISOString(),
          endAt: new Date(p.endAt).toISOString()
        })),
        unplaced: unplacedPreview,
        summary: {
          total: body.count,
          placed: placementsPreview.length,
          unplaced: unplacedPreview.length
        }
      };
    }

    const virtualAircraftBase = {
      operatorId: body.operatorId,
      aircraftTypeId: body.aircraftTypeId
    };
    const sbId = sandboxIdFor(req);

    const result = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created: Array<{
        eventId: string;
        label: string;
        title: string;
        startAt: Date;
        endAt: Date;
        hangarId: string | null;
        layoutId: string | null;
        standId: string | null;
        status: EventStatus;
      }> = [];

      for (let i = 0; i < body.count; i++) {
        const title = titleBase.includes("%") ? titleBase.replace("%", String(i + 1)) : `${titleBase} #${i + 1}`;
        const label = virtualLabel(i);
        const virtualAircraft = { ...virtualAircraftBase, label } as object;

        const p = placementsPreview.find((x) => x.index === i);
        if (p) {
          const startAt = new Date(p.startAt);
          const endAt = new Date(p.endAt);
          const ev = await tx.maintenanceEvent.create({
            data: {
              level: PlanningLevel.OPERATIONAL,
              status: EventStatus.PLANNED,
              title,
              sandboxId: sbId,
              eventTypeId: body.eventTypeId,
              startAt,
              endAt,
              hangarId: p.hangarId,
              layoutId: p.layoutId,
              virtualAircraft: virtualAircraft as Prisma.InputJsonValue
            }
          });
          await tx.standReservation.create({
            data: { eventId: ev.id, sandboxId: sbId, layoutId: p.layoutId, standId: p.standId, startAt, endAt }
          });
          await tx.maintenanceEventAudit.create({
            data: {
              eventId: ev.id,
              sandboxId: sbId,
              action: EventAuditAction.CREATE,
              actor: getActor(req),
              reason: "Массовое планирование",
              changes: { massPlan: { placed: true, hangarId: p.hangarId, layoutId: p.layoutId, standId: p.standId } }
            }
          });
          created.push({
            eventId: ev.id,
            label,
            title: ev.title,
            startAt,
            endAt,
            hangarId: p.hangarId,
            layoutId: p.layoutId,
            standId: p.standId,
            status: EventStatus.PLANNED
          });
        } else {
          const startAt = new Date(endToMs);
          const endAt = new Date(endToMs + tatMs);
          const ev = await tx.maintenanceEvent.create({
            data: {
              level: PlanningLevel.OPERATIONAL,
              status: EventStatus.DRAFT,
              title,
              sandboxId: sbId,
              eventTypeId: body.eventTypeId,
              startAt,
              endAt,
              hangarId: null,
              layoutId: null,
              virtualAircraft: virtualAircraft as Prisma.InputJsonValue
            }
          });
          await tx.maintenanceEventAudit.create({
            data: {
              eventId: ev.id,
              sandboxId: sbId,
              action: EventAuditAction.CREATE,
              actor: getActor(req),
              reason: "Массовое планирование (черновик — не поместилось в период)",
              changes: { massPlan: { placed: false, draft: true } }
            }
          });
          created.push({
            eventId: ev.id,
            label,
            title: ev.title,
            startAt,
            endAt,
            hangarId: null,
            layoutId: null,
            standId: null,
            status: EventStatus.DRAFT
          });
        }
      }

      return created;
    });

    return {
      ok: true,
      dryRun: false,
      created: result.length,
      placed: result.filter((r) => r.status === EventStatus.PLANNED).length,
      unplaced: result.filter((r) => r.status === EventStatus.DRAFT).length,
      events: result.map((r) => ({
        ...r,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString()
      }))
    };
  });
};
