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

function assertCanWriteEvent(req: any) {
  if (req.sandbox) {
    assertCanWrite(req);
    return;
  }
  assertPermission(req, "events:write");
}

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  const h = req.headers ?? {};
  return String(h["x-actor"] ?? h["x-user"] ?? "browser").slice(0, 80);
}

type StandEntry = { hangarId: string; layoutId: string; standId: string };
type ScheduleMode = "compact" | "sequential" | "fixedCadence";
type PlacementMode = "auto" | "preferredHangars" | "draftOnConflict";

type PlacementPreview = {
  index: number;
  title: string;
  label: string;
  startAt: number;
  endAt: number;
  hangarId: string;
  layoutId: string;
  standId: string;
  scheduledBy: ScheduleMode;
  warnings: string[];
  towBeforeStartAt?: number;
  towBeforeEndAt?: number;
  towAfterStartAt?: number;
  towAfterEndAt?: number;
};

type UnplacedPreview = {
  index: number;
  title: string;
  label: string;
  intendedStartAt: number;
  warnings: string[];
};

type BuildPlacementsParams = {
  count: number;
  titleBase: string;
  virtualLabel: (i: number) => string;
  standOrder: StandEntry[];
  busyByStand: Map<string, Array<{ start: number; end: number }>>;
  startFromMs: number;
  endToMs: number;
  tatMs: number;
  spacingMs: number;
  cadenceMs: number | null;
  scheduleMode: ScheduleMode;
  placementMode: PlacementMode;
  towBeforeMs: number;
  towAfterMs: number;
  towBlocksStand: boolean;
};

function overlapsMs(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function findFirstEventStart(
  busy: Array<{ start: number; end: number }>,
  minEventStart: number,
  eventDurationMs: number,
  maxEventEnd: number,
  towBeforeMs: number,
  towAfterMs: number
): number | null {
  if (minEventStart + eventDurationMs > maxEventEnd) return null;
  let cursor = minEventStart;
  for (const b of busy) {
    const blockStart = cursor - towBeforeMs;
    const blockEnd = cursor + eventDurationMs + towAfterMs;
    if (b.end <= blockStart) continue;
    if (blockEnd <= b.start) return cursor;
    cursor = Math.max(cursor, b.end + towBeforeMs);
    if (cursor + eventDurationMs > maxEventEnd) return null;
  }
  return cursor;
}

function isEventStartFree(
  busy: Array<{ start: number; end: number }>,
  eventStart: number,
  eventDurationMs: number,
  towBeforeMs: number,
  towAfterMs: number
): boolean {
  const blockStart = eventStart - towBeforeMs;
  const blockEnd = eventStart + eventDurationMs + towAfterMs;
  return !busy.some((b) => overlapsMs(blockStart, blockEnd, b.start, b.end));
}

function addTowFields(
  placement: Omit<PlacementPreview, "towBeforeStartAt" | "towBeforeEndAt" | "towAfterStartAt" | "towAfterEndAt">,
  towBeforeMs: number,
  towAfterMs: number,
  startFromMs: number,
  endToMs: number
): PlacementPreview {
  const next: PlacementPreview = { ...placement };
  if (towBeforeMs > 0) {
    next.towBeforeStartAt = next.startAt - towBeforeMs;
    next.towBeforeEndAt = next.startAt;
    if (next.towBeforeStartAt < startFromMs) next.warnings.push("Буксировка до события выходит за начало периода");
  }
  if (towAfterMs > 0) {
    next.towAfterStartAt = next.endAt;
    next.towAfterEndAt = next.endAt + towAfterMs;
    if (next.towAfterEndAt > endToMs) next.warnings.push("Буксировка после события выходит за конец периода");
  }
  return next;
}

function buildMassPlanPlacements(params: BuildPlacementsParams): {
  placements: PlacementPreview[];
  unplaced: UnplacedPreview[];
} {
  const {
    count,
    titleBase,
    virtualLabel,
    standOrder,
    busyByStand,
    startFromMs,
    endToMs,
    tatMs,
    spacingMs,
    cadenceMs,
    scheduleMode,
    placementMode,
    towBeforeMs,
    towAfterMs,
    towBlocksStand
  } = params;

  const placements: PlacementPreview[] = [];
  const unplaced: UnplacedPreview[] = [];
  const busyByStandWork = new Map<string, Array<{ start: number; end: number }>>();
  for (const [standId, busy] of busyByStand.entries()) {
    busyByStandWork.set(standId, [...busy].sort((a, b) => a.start - b.start));
  }

  const blockBefore = towBlocksStand ? towBeforeMs : 0;
  const blockAfter = towBlocksStand ? towAfterMs : 0;
  let nextSequentialStart = startFromMs;

  const addBusy = (standId: string, start: number, end: number) => {
    const arr = busyByStandWork.get(standId) ?? [];
    arr.push({
      start: towBlocksStand ? start - towBeforeMs : start,
      end: towBlocksStand ? end + towAfterMs : end
    });
    arr.sort((a, b) => a.start - b.start);
    busyByStandWork.set(standId, arr);
  };

  for (let i = 0; i < count; i++) {
    const title = titleBase.includes("%") ? titleBase.replace("%", String(i + 1)) : `${titleBase} #${i + 1}`;
    const label = virtualLabel(i);
    const intendedStart =
      scheduleMode === "fixedCadence"
        ? startFromMs + i * (cadenceMs ?? tatMs + spacingMs)
        : scheduleMode === "sequential"
          ? nextSequentialStart
          : Math.max(startFromMs, nextSequentialStart);

    let bestStart: number | null = null;
    let bestEntry: StandEntry | null = null;

    for (const entry of standOrder) {
      const busy = busyByStandWork.get(entry.standId) ?? [];
      const slot =
        placementMode === "draftOnConflict"
          ? isEventStartFree(busy, intendedStart, tatMs, blockBefore, blockAfter)
            ? intendedStart
            : null
          : findFirstEventStart(busy, intendedStart, tatMs, endToMs, blockBefore, blockAfter);
      if (slot == null || slot + tatMs > endToMs) continue;
      if (bestStart == null || slot < bestStart) {
        bestStart = slot;
        bestEntry = entry;
      }
    }

    if (bestEntry == null || bestStart == null) {
      unplaced.push({
        index: i,
        title,
        label,
        intendedStartAt: intendedStart,
        warnings: [
          placementMode === "draftOnConflict"
            ? "Целевой слот занят, событие будет создано черновиком"
            : "Не найден свободный слот в выбранном периоде"
        ]
      });
      if (scheduleMode !== "fixedCadence") nextSequentialStart = intendedStart + tatMs + spacingMs;
      continue;
    }

    const endAt = bestStart + tatMs;
    const warnings: string[] = [];
    if (bestStart > intendedStart && scheduleMode === "fixedCadence") {
      warnings.push("Сдвинуто относительно фиксированного шага из-за занятости");
    }
    const placement = addTowFields(
      {
        index: i,
        title,
        label,
        startAt: bestStart,
        endAt,
        hangarId: bestEntry.hangarId,
        layoutId: bestEntry.layoutId,
        standId: bestEntry.standId,
        scheduledBy: scheduleMode,
        warnings
      },
      towBeforeMs,
      towAfterMs,
      startFromMs,
      endToMs
    );
    placements.push(placement);
    addBusy(bestEntry.standId, bestStart, endAt);
    if (scheduleMode !== "fixedCadence") nextSequentialStart = endAt + spacingMs;
  }

  return { placements, unplaced };
}

export const massPlanningRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Массовое планирование: виртуальные борта (без реального Aircraft), период [startFrom, endTo].
   * dryRun: true — предпросмотр (placements + unplaced). dryRun: false — создание событий.
   * Непоместившиеся создаются в статусе DRAFT без ангара/места.
   */
  app.post("/", async (req) => {
    assertCanWriteEvent(req);

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
        spacingHours: z.number().min(0).max(8760).optional().default(0),
        scheduleMode: z.enum(["compact", "sequential", "fixedCadence"]).optional().default("compact"),
        cadenceHours: z.number().positive().max(8760).optional(),
        placementMode: z.enum(["auto", "preferredHangars", "draftOnConflict"]).optional().default("auto"),
        towBeforeMinutes: z.number().int().min(0).max(24 * 60).optional().default(0),
        towAfterMinutes: z.number().int().min(0).max(24 * 60).optional().default(0),
        towBlocksStand: z.boolean().optional().default(false),
        dryRun: z.boolean().optional()
      })
      .refine((v) => Number.isFinite(v.startFrom.getTime()), { message: "startFrom must be a valid date" })
      .refine((v) => Number.isFinite(v.endTo.getTime()), { message: "endTo must be a valid date" })
      .refine((v) => v.endTo >= v.startFrom, { message: "endTo must be >= startFrom" })
      .refine((v) => v.scheduleMode !== "fixedCadence" || (v.cadenceHours ?? 0) > 0, {
        message: "cadenceHours is required for fixedCadence"
      })
      .parse(req.body);

    const dryRun = Boolean(body.dryRun);
    const tatMs = body.tatHours * 60 * 60 * 1000;
    const spacingMs = body.spacingHours * 60 * 60 * 1000;
    const cadenceMs = body.cadenceHours ? body.cadenceHours * 60 * 60 * 1000 : null;
    const towBeforeMs = body.towBeforeMinutes * 60 * 1000;
    const towAfterMs = body.towAfterMinutes * 60 * 1000;
    const startFromMs = body.startFrom.getTime();
    const endToMs = body.endTo.getTime();
    const windowEnd = new Date(Math.max(endToMs + towAfterMs, startFromMs + body.count * (tatMs + spacingMs)));

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
        select: {
          standId: true,
          startAt: true,
          endAt: true,
          event: { select: { towSegments: { select: { startAt: true, endAt: true } } } }
        }
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
      const towStarts = body.towBlocksStand ? r.event.towSegments.map((t) => t.startAt.getTime()) : [];
      const towEnds = body.towBlocksStand ? r.event.towSegments.map((t) => t.endAt.getTime()) : [];
      arr.push({
        start: Math.min(r.startAt.getTime(), ...towStarts),
        end: Math.max(r.endAt.getTime(), ...towEnds)
      });
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

    const { placements: placementsPreview, unplaced: unplacedPreview } = buildMassPlanPlacements({
      count: body.count,
      titleBase,
      virtualLabel,
      standOrder,
      busyByStand,
      startFromMs,
      endToMs,
      tatMs,
      spacingMs,
      cadenceMs,
      scheduleMode: body.scheduleMode,
      placementMode: body.placementMode,
      towBeforeMs,
      towAfterMs,
      towBlocksStand: body.towBlocksStand
    });

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        placements: placementsPreview.map((p) => ({
          ...p,
          startAt: new Date(p.startAt).toISOString(),
          endAt: new Date(p.endAt).toISOString(),
          towBeforeStartAt: p.towBeforeStartAt ? new Date(p.towBeforeStartAt).toISOString() : undefined,
          towBeforeEndAt: p.towBeforeEndAt ? new Date(p.towBeforeEndAt).toISOString() : undefined,
          towAfterStartAt: p.towAfterStartAt ? new Date(p.towAfterStartAt).toISOString() : undefined,
          towAfterEndAt: p.towAfterEndAt ? new Date(p.towAfterEndAt).toISOString() : undefined
        })),
        unplaced: unplacedPreview.map((u) => ({
          ...u,
          intendedStartAt: new Date(u.intendedStartAt).toISOString()
        })),
        summary: {
          total: body.count,
          placed: placementsPreview.length,
          unplaced: unplacedPreview.length,
          createdTowsBefore: placementsPreview.filter((p) => p.towBeforeStartAt != null).length,
          createdTowsAfter: placementsPreview.filter((p) => p.towAfterStartAt != null).length,
          draftOnConflict: body.placementMode === "draftOnConflict"
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
        towBeforeStartAt?: Date;
        towBeforeEndAt?: Date;
        towAfterStartAt?: Date;
        towAfterEndAt?: Date;
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
          const towRows = [
            p.towBeforeStartAt != null && p.towBeforeEndAt != null
              ? { eventId: ev.id, sandboxId: sbId, startAt: new Date(p.towBeforeStartAt), endAt: new Date(p.towBeforeEndAt) }
              : null,
            p.towAfterStartAt != null && p.towAfterEndAt != null
              ? { eventId: ev.id, sandboxId: sbId, startAt: new Date(p.towAfterStartAt), endAt: new Date(p.towAfterEndAt) }
              : null
          ].filter((row): row is { eventId: string; sandboxId: string | null; startAt: Date; endAt: Date } => row != null);
          if (towRows.length > 0) await tx.eventTow.createMany({ data: towRows });
          await tx.maintenanceEventAudit.create({
            data: {
              eventId: ev.id,
              sandboxId: sbId,
              action: EventAuditAction.CREATE,
              actor: getActor(req),
              reason: "Массовое планирование",
              changes: {
                massPlan: {
                  placed: true,
                  hangarId: p.hangarId,
                  layoutId: p.layoutId,
                  standId: p.standId,
                  scheduleMode: body.scheduleMode,
                  spacingHours: body.spacingHours,
                  cadenceHours: body.cadenceHours ?? null,
                  placementMode: body.placementMode,
                  towBeforeMinutes: body.towBeforeMinutes,
                  towAfterMinutes: body.towAfterMinutes,
                  towBlocksStand: body.towBlocksStand,
                  warnings: p.warnings
                }
              }
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
            status: EventStatus.PLANNED,
            towBeforeStartAt: p.towBeforeStartAt != null ? new Date(p.towBeforeStartAt) : undefined,
            towBeforeEndAt: p.towBeforeEndAt != null ? new Date(p.towBeforeEndAt) : undefined,
            towAfterStartAt: p.towAfterStartAt != null ? new Date(p.towAfterStartAt) : undefined,
            towAfterEndAt: p.towAfterEndAt != null ? new Date(p.towAfterEndAt) : undefined
          });
        } else {
          const u = unplacedPreview.find((x) => x.index === i);
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
              changes: {
                massPlan: {
                  placed: false,
                  draft: true,
                  scheduleMode: body.scheduleMode,
                  spacingHours: body.spacingHours,
                  cadenceHours: body.cadenceHours ?? null,
                  placementMode: body.placementMode,
                  towBeforeMinutes: body.towBeforeMinutes,
                  towAfterMinutes: body.towAfterMinutes,
                  towBlocksStand: body.towBlocksStand,
                  warnings: u?.warnings ?? []
                }
              }
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
      createdTowsBefore: result.filter((r) => r.towBeforeStartAt != null).length,
      createdTowsAfter: result.filter((r) => r.towAfterStartAt != null).length,
      events: result.map((r) => ({
        ...r,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        towBeforeStartAt: r.towBeforeStartAt?.toISOString(),
        towBeforeEndAt: r.towBeforeEndAt?.toISOString(),
        towAfterStartAt: r.towAfterStartAt?.toISOString(),
        towAfterEndAt: r.towAfterEndAt?.toISOString()
      }))
    };
  });
};
