import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { EventAuditAction, EventStatus, PlanningLevel } from "@prisma/client";

import { zDateTime, zUuid } from "../../lib/zod.js";
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

type StandEntry = { hangarId: string; layoutId: string; standId: string; priorityScore?: number; priorityRuleIds?: string[] };
type ScheduleMode = "compact" | "sequential" | "fixedCadence";
type PlacementMode = "auto" | "preferredHangars" | "draftOnConflict";

const MASS_PLAN_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 15_000 };

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
  score?: number;
  scoreDetails?: string[];
  priorityRuleIds?: string[];
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
      const priorityScore = entry.priorityScore ?? 0;
      const bestPriorityScore = bestEntry?.priorityScore ?? 0;
      if (bestStart == null || slot < bestStart || (slot === bestStart && priorityScore > bestPriorityScore)) {
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
    const scoreDetails: string[] = [];
    const priorityScore = bestEntry.priorityScore ?? 0;
    if (priorityScore > 0) scoreDetails.push(`Приоритет размещения: +${priorityScore}`);
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
        warnings,
        score: priorityScore,
        scoreDetails,
        priorityRuleIds: bestEntry.priorityRuleIds
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
        budgetStartAt: zDateTime.nullable().optional(),
        budgetEndAt: zDateTime.nullable().optional(),
        actualStartAt: zDateTime.nullable().optional(),
        actualEndAt: zDateTime.nullable().optional(),
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
      .refine((v) => Boolean(v.budgetStartAt) === Boolean(v.budgetEndAt), { message: "budget period must have both dates" })
      .refine((v) => !v.budgetStartAt || !v.budgetEndAt || v.budgetEndAt > v.budgetStartAt, {
        message: "budgetEndAt must be after budgetStartAt"
      })
      .refine((v) => Boolean(v.actualStartAt) === Boolean(v.actualEndAt), { message: "actual period must have both dates" })
      .refine((v) => !v.actualStartAt || !v.actualEndAt || v.actualEndAt > v.actualStartAt, {
        message: "actualEndAt must be after actualStartAt"
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
              select: { id: true, bodyType: true, code: true, allowedAircraftTypes: { select: { aircraftTypeId: true } } },
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
          event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
        },
        select: {
          standId: true,
          startAt: true,
          endAt: true,
          event: { select: { towSegments: { select: { startAt: true, endAt: true } } } }
        }
      })
    ]);

    const hangarIdSet = new Set(hangarsOrdered.map((h) => h.id));
    const priorityRules = await app.prisma.placementPriorityRule.findMany({
      where: {
        isActive: true,
        hangarId: { in: hangarsOrdered.map((h) => h.id) },
        OR: [
          { eventTypes: { none: {} } },
          { eventTypes: { some: { eventTypeId: body.eventTypeId } } }
        ],
        AND: [
          {
            OR: [
              { aircraftTypes: { none: {} } },
              { aircraftTypes: { some: { aircraftTypeId: body.aircraftTypeId } } }
            ]
          }
        ]
      },
      select: { id: true, hangarId: true, layoutId: true, standId: true, priorityScore: true }
    });
    const priorityByTarget = new Map<string, { score: number; ruleIds: string[] }>();
    for (const rule of priorityRules) {
      const key = `stand:${rule.standId}`;
      const current = priorityByTarget.get(key) ?? { score: 0, ruleIds: [] };
      current.score += rule.priorityScore;
      current.ruleIds.push(rule.id);
      priorityByTarget.set(key, current);
    }

    const priorityFor = (entry: Omit<StandEntry, "priorityScore" | "priorityRuleIds">) => {
      const keys = [`stand:${entry.standId}`];
      const matched = keys.map((key) => priorityByTarget.get(key)).filter((x): x is { score: number; ruleIds: string[] } => x != null);
      return {
        score: matched.reduce((sum, item) => sum + item.score, 0),
        ruleIds: matched.flatMap((item) => item.ruleIds).filter((id, pos, arr) => arr.indexOf(id) === pos)
      };
    };

    const standOrder: StandEntry[] = [];
    for (const lay of layoutsWithStands) {
      if (!hangarIdSet.has(lay.hangarId)) continue;
      for (const s of lay.stands) {
        const allowedAircraftTypeIds = s.allowedAircraftTypes.map((link) => link.aircraftTypeId);
        if (allowedAircraftTypeIds.length > 0 && !allowedAircraftTypeIds.includes(aircraftType.id)) continue;
        const baseEntry = { hangarId: lay.hangarId, layoutId: lay.id, standId: s.id };
        const priority = priorityFor(baseEntry);
        standOrder.push({ ...baseEntry, priorityScore: priority.score, priorityRuleIds: priority.ruleIds });
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
      if (ai !== bi) return ai - bi;
      return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
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
          budgetStartAt: body.budgetStartAt?.toISOString() ?? null,
          budgetEndAt: body.budgetEndAt?.toISOString() ?? null,
          actualStartAt: body.actualStartAt?.toISOString() ?? null,
          actualEndAt: body.actualEndAt?.toISOString() ?? null,
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

    const result = await app.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const created: Array<{
          eventId: string;
          label: string;
          title: string;
          startAt: Date;
          endAt: Date;
          budgetStartAt: Date | null;
          budgetEndAt: Date | null;
          actualStartAt: Date | null;
          actualEndAt: Date | null;
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
              planningKind: body.budgetStartAt && body.budgetEndAt ? "PLANNED" : "UNPLANNED",
              title,
              sandboxId: sbId,
              eventTypeId: body.eventTypeId,
              startAt,
              endAt,
              budgetStartAt: body.budgetStartAt ?? null,
              budgetEndAt: body.budgetEndAt ?? null,
              actualStartAt: body.actualStartAt ?? null,
              actualEndAt: body.actualEndAt ?? null,
              hangarId: p.hangarId,
              layoutId: p.layoutId,
              virtualAircraft: virtualAircraft as Prisma.InputJsonValue
            }
          });
          const placement = await tx.eventPlacement.create({
            data: {
              eventId: ev.id,
              sandboxId: sbId,
              startAt,
              endAt,
              budgetStartAt: body.budgetStartAt ?? null,
              budgetEndAt: body.budgetEndAt ?? null,
              actualStartAt: body.actualStartAt ?? null,
              actualEndAt: body.actualEndAt ?? null,
              hangarId: p.hangarId,
              layoutId: p.layoutId,
              standId: p.standId,
              sortOrder: 0
            }
          });
          await tx.standReservation.create({
            data: { eventId: ev.id, placementId: placement.id, sandboxId: sbId, layoutId: p.layoutId, standId: p.standId, startAt, endAt }
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
                  budgetStartAt: body.budgetStartAt?.toISOString() ?? null,
                  budgetEndAt: body.budgetEndAt?.toISOString() ?? null,
                  actualStartAt: body.actualStartAt?.toISOString() ?? null,
                  actualEndAt: body.actualEndAt?.toISOString() ?? null,
                  score: p.score ?? 0,
                  scoreDetails: p.scoreDetails ?? [],
                  priorityRuleIds: p.priorityRuleIds ?? [],
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
            budgetStartAt: body.budgetStartAt ?? null,
            budgetEndAt: body.budgetEndAt ?? null,
            actualStartAt: body.actualStartAt ?? null,
            actualEndAt: body.actualEndAt ?? null,
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
              planningKind: body.budgetStartAt && body.budgetEndAt ? "PLANNED" : "UNPLANNED",
              title,
              sandboxId: sbId,
              eventTypeId: body.eventTypeId,
              startAt,
              endAt,
              budgetStartAt: body.budgetStartAt ?? null,
              budgetEndAt: body.budgetEndAt ?? null,
              actualStartAt: body.actualStartAt ?? null,
              actualEndAt: body.actualEndAt ?? null,
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
                  budgetStartAt: body.budgetStartAt?.toISOString() ?? null,
                  budgetEndAt: body.budgetEndAt?.toISOString() ?? null,
                  actualStartAt: body.actualStartAt?.toISOString() ?? null,
                  actualEndAt: body.actualEndAt?.toISOString() ?? null,
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
            budgetStartAt: body.budgetStartAt ?? null,
            budgetEndAt: body.budgetEndAt ?? null,
            actualStartAt: body.actualStartAt ?? null,
            actualEndAt: body.actualEndAt ?? null,
            hangarId: null,
            layoutId: null,
            standId: null,
            status: EventStatus.DRAFT
          });
        }
      }

      return created;
      },
      MASS_PLAN_TRANSACTION_OPTIONS
    );

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
        budgetStartAt: r.budgetStartAt?.toISOString() ?? null,
        budgetEndAt: r.budgetEndAt?.toISOString() ?? null,
        actualStartAt: r.actualStartAt?.toISOString() ?? null,
        actualEndAt: r.actualEndAt?.toISOString() ?? null,
        towBeforeStartAt: r.towBeforeStartAt?.toISOString(),
        towBeforeEndAt: r.towBeforeEndAt?.toISOString(),
        towAfterStartAt: r.towAfterStartAt?.toISOString(),
        towAfterEndAt: r.towAfterEndAt?.toISOString()
      }))
    };
  });

  app.post("/batch", async (req) => {
    assertCanWriteEvent(req);

    const zBatchItem = z
      .object({
        tatHours: z.number().positive().max(8760),
        operatorId: zUuid,
        aircraftTypeId: zUuid,
        eventTypeId: zUuid,
        count: z.number().int().min(1).max(200),
        startFrom: z.string().transform((s) => new Date(s)),
        endTo: z.string().transform((s) => new Date(s)),
        titleTemplate: z.string().trim().min(1).max(200).optional(),
        spacingHours: z.number().min(0).max(8760).optional().default(0),
        scheduleMode: z.enum(["compact", "sequential", "fixedCadence"]).optional().default("compact"),
        cadenceHours: z.number().positive().max(8760).optional()
      })
      .refine((v) => Number.isFinite(v.startFrom.getTime()), { message: "item.startFrom must be a valid date" })
      .refine((v) => Number.isFinite(v.endTo.getTime()), { message: "item.endTo must be a valid date" })
      .refine((v) => v.endTo >= v.startFrom, { message: "item.endTo must be >= item.startFrom" })
      .refine((v) => v.scheduleMode !== "fixedCadence" || (v.cadenceHours ?? 0) > 0, {
        message: "item.cadenceHours is required for fixedCadence"
      });

    const body = z
      .object({
        items: z.array(zBatchItem).min(1).max(100),
        hangarIds: z.array(zUuid).optional(),
        placementMode: z.enum(["auto", "preferredHangars", "draftOnConflict"]).optional().default("auto"),
        budgetStartAt: zDateTime.nullable().optional(),
        budgetEndAt: zDateTime.nullable().optional(),
        actualStartAt: zDateTime.nullable().optional(),
        actualEndAt: zDateTime.nullable().optional(),
        towBeforeMinutes: z.number().int().min(0).max(24 * 60).optional().default(0),
        towAfterMinutes: z.number().int().min(0).max(24 * 60).optional().default(0),
        towBlocksStand: z.boolean().optional().default(false),
        dryRun: z.boolean().optional()
      })
      .refine((v) => Boolean(v.budgetStartAt) === Boolean(v.budgetEndAt), { message: "budget period must have both dates" })
      .refine((v) => !v.budgetStartAt || !v.budgetEndAt || v.budgetEndAt > v.budgetStartAt, {
        message: "budgetEndAt must be after budgetStartAt"
      })
      .refine((v) => Boolean(v.actualStartAt) === Boolean(v.actualEndAt), { message: "actual period must have both dates" })
      .refine((v) => !v.actualStartAt || !v.actualEndAt || v.actualEndAt > v.actualStartAt, {
        message: "actualEndAt must be after actualStartAt"
      })
      .parse(req.body);

    const dryRun = Boolean(body.dryRun);
    const towBeforeMs = body.towBeforeMinutes * 60 * 1000;
    const towAfterMs = body.towAfterMinutes * 60 * 1000;
    const blockBefore = body.towBlocksStand ? towBeforeMs : 0;
    const blockAfter = body.towBlocksStand ? towAfterMs : 0;
    const minStart = new Date(Math.min(...body.items.map((item) => item.startFrom.getTime())));
    const maxEnd = new Date(Math.max(...body.items.map((item) => item.endTo.getTime() + towAfterMs)));
    const aircraftTypeIds = Array.from(new Set(body.items.map((item) => item.aircraftTypeId)));
    const eventTypeIds = Array.from(new Set(body.items.map((item) => item.eventTypeId)));

    const [eventTypes, aircraftTypes, hangarsOrdered, layoutsWithStands, reservations, priorityRules] = await Promise.all([
      app.prisma.eventType.findMany({ where: { id: { in: eventTypeIds } } }),
      app.prisma.aircraftType.findMany({ where: { id: { in: aircraftTypeIds } } }),
      body.hangarIds?.length
        ? app.prisma.hangar
            .findMany({
              where: { id: { in: body.hangarIds }, isActive: true },
              orderBy: []
            })
            .then((list) => {
              const byId = new Map(list.map((h) => [h.id, h]));
              return body.hangarIds!.map((id) => byId.get(id)).filter(Boolean) as typeof list;
            })
        : app.prisma.hangar.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }] }),
      (async () => {
        const hid = body.hangarIds?.length
          ? body.hangarIds
          : (await app.prisma.hangar.findMany({ where: { isActive: true }, select: { id: true }, orderBy: [{ name: "asc" }] })).map((h) => h.id);
        const layouts = await app.prisma.hangarLayout.findMany({
          where: { hangarId: { in: hid }, isActive: true },
          include: {
            stands: {
              where: { isActive: true },
              select: { id: true, code: true, allowedAircraftTypes: { select: { aircraftTypeId: true } } },
              orderBy: [{ code: "asc" }]
            }
          }
        });
        const orderIdx = (id: string) => hid.indexOf(id);
        layouts.sort((a, b) => orderIdx(a.hangarId) - orderIdx(b.hangarId));
        return layouts;
      })(),
      app.prisma.standReservation.findMany({
        where: {
          ...sandboxFilter(req),
          startAt: { lt: maxEnd },
          endAt: { gt: minStart },
          event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
        },
        select: {
          standId: true,
          startAt: true,
          endAt: true,
          event: { select: { towSegments: { select: { startAt: true, endAt: true } } } }
        }
      }),
      app.prisma.placementPriorityRule.findMany({
        where: { isActive: true },
        include: {
          eventTypes: { select: { eventTypeId: true } },
          aircraftTypes: { select: { aircraftTypeId: true } }
        }
      })
    ]);

    const eventTypeById = new Map(eventTypes.map((eventType) => [eventType.id, eventType]));
    const aircraftTypeById = new Map(aircraftTypes.map((aircraftType) => [aircraftType.id, aircraftType]));
    for (const item of body.items) {
      if (!eventTypeById.has(item.eventTypeId)) throw app.httpErrors.badRequest(`Не найден тип события: ${item.eventTypeId}`);
      if (!aircraftTypeById.has(item.aircraftTypeId)) throw app.httpErrors.badRequest(`Не найден тип ВС: ${item.aircraftTypeId}`);
    }

    const hangarOrder = hangarsOrdered.map((h) => h.id);
    const hangarIdSet = new Set(hangarOrder);
    const allStands: StandEntry[] = [];
    for (const lay of layoutsWithStands) {
      if (!hangarIdSet.has(lay.hangarId)) continue;
      for (const stand of lay.stands) allStands.push({ hangarId: lay.hangarId, layoutId: lay.id, standId: stand.id });
    }

    const busyByStand = new Map<string, Array<{ start: number; end: number }>>();
    for (const reservation of reservations) {
      const arr = busyByStand.get(reservation.standId) ?? [];
      const towStarts = body.towBlocksStand ? reservation.event.towSegments.map((t) => t.startAt.getTime()) : [];
      const towEnds = body.towBlocksStand ? reservation.event.towSegments.map((t) => t.endAt.getTime()) : [];
      arr.push({
        start: Math.min(reservation.startAt.getTime(), ...towStarts),
        end: Math.max(reservation.endAt.getTime(), ...towEnds)
      });
      busyByStand.set(reservation.standId, arr);
    }
    for (const arr of busyByStand.values()) arr.sort((a, b) => a.start - b.start);

    const standMeta = new Map<string, { aircraftTypeIds: string[] }>();
    for (const layout of layoutsWithStands) {
      for (const stand of layout.stands) {
        standMeta.set(stand.id, { aircraftTypeIds: stand.allowedAircraftTypes.map((link) => link.aircraftTypeId) });
      }
    }

    const priorityFor = (entry: StandEntry, eventTypeId: string, aircraftTypeId: string) => {
      const matched = priorityRules.filter((rule) => {
        if (rule.standId !== entry.standId) return false;
        const eventOk = rule.eventTypes.length === 0 || rule.eventTypes.some((link) => link.eventTypeId === eventTypeId);
        const aircraftOk = rule.aircraftTypes.length === 0 || rule.aircraftTypes.some((link) => link.aircraftTypeId === aircraftTypeId);
        return eventOk && aircraftOk;
      });
      return {
        score: matched.reduce((sum, rule) => sum + rule.priorityScore, 0),
        ruleIds: matched.map((rule) => rule.id)
      };
    };

    const busyWork = new Map<string, Array<{ start: number; end: number }>>();
    for (const [standId, busy] of busyByStand.entries()) busyWork.set(standId, [...busy]);
    const addBusy = (standId: string, start: number, end: number) => {
      const arr = busyWork.get(standId) ?? [];
      arr.push({ start: body.towBlocksStand ? start - towBeforeMs : start, end: body.towBlocksStand ? end + towAfterMs : end });
      arr.sort((a, b) => a.start - b.start);
      busyWork.set(standId, arr);
    };

    const placementsPreview: Array<PlacementPreview & { rowIndex: number; itemIndex: number; operatorId: string; aircraftTypeId: string; eventTypeId: string }> = [];
    const unplacedPreview: Array<UnplacedPreview & { rowIndex: number; itemIndex: number; operatorId: string; aircraftTypeId: string; eventTypeId: string }> = [];
    const nextStartByItem = new Map<number, number>();

    for (const [itemIndex, item] of body.items.entries()) {
      const eventType = eventTypeById.get(item.eventTypeId)!;
      const tatMs = item.tatHours * 60 * 60 * 1000;
      const spacingMs = item.spacingHours * 60 * 60 * 1000;
      const cadenceMs = item.cadenceHours ? item.cadenceHours * 60 * 60 * 1000 : null;
      const titleBase = item.titleTemplate ?? eventType.name;
      nextStartByItem.set(itemIndex, item.startFrom.getTime());

      for (let i = 0; i < item.count; i++) {
        const intendedStart =
          item.scheduleMode === "fixedCadence"
            ? item.startFrom.getTime() + i * (cadenceMs ?? tatMs + spacingMs)
            : item.scheduleMode === "sequential"
              ? (nextStartByItem.get(itemIndex) ?? item.startFrom.getTime())
              : Math.max(item.startFrom.getTime(), nextStartByItem.get(itemIndex) ?? item.startFrom.getTime());
        const title = titleBase.includes("%") ? titleBase.replace("%", String(i + 1)) : `${titleBase} #${i + 1}`;
        const label = `— Стр. ${itemIndex + 1}.${i + 1}`;
        const compatible = allStands
          .filter((entry) => {
            const allowed = standMeta.get(entry.standId)?.aircraftTypeIds ?? [];
            return allowed.length === 0 || allowed.includes(item.aircraftTypeId);
          })
          .map((entry) => {
            const priority = priorityFor(entry, item.eventTypeId, item.aircraftTypeId);
            return { ...entry, priorityScore: priority.score, priorityRuleIds: priority.ruleIds };
          })
          .sort((a, b) => {
            const ai = hangarOrder.indexOf(a.hangarId);
            const bi = hangarOrder.indexOf(b.hangarId);
            if (ai !== bi) return ai - bi;
            return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
          });

        let bestStart: number | null = null;
        let bestEntry: StandEntry | null = null;
        for (const entry of compatible) {
          const busy = busyWork.get(entry.standId) ?? [];
          const slot =
            body.placementMode === "draftOnConflict"
              ? isEventStartFree(busy, intendedStart, tatMs, blockBefore, blockAfter)
                ? intendedStart
                : null
              : findFirstEventStart(busy, intendedStart, tatMs, item.endTo.getTime(), blockBefore, blockAfter);
          if (slot == null || slot + tatMs > item.endTo.getTime()) continue;
          const bestPriorityScore = bestEntry?.priorityScore ?? 0;
          const priorityScore = entry.priorityScore ?? 0;
          if (bestStart == null || slot < bestStart || (slot === bestStart && priorityScore > bestPriorityScore)) {
            bestStart = slot;
            bestEntry = entry;
          }
        }

        if (bestStart == null || bestEntry == null) {
          unplacedPreview.push({
            index: placementsPreview.length + unplacedPreview.length,
            rowIndex: itemIndex,
            itemIndex: i,
            operatorId: item.operatorId,
            aircraftTypeId: item.aircraftTypeId,
            eventTypeId: item.eventTypeId,
            title,
            label,
            intendedStartAt: intendedStart,
            warnings: [
              body.placementMode === "draftOnConflict"
                ? "Целевой слот занят, событие будет создано черновиком"
                : "Не найден свободный слот в выбранном периоде"
            ]
          });
          if (item.scheduleMode !== "fixedCadence") nextStartByItem.set(itemIndex, intendedStart + tatMs + spacingMs);
          continue;
        }

        const endAt = bestStart + tatMs;
        const warnings: string[] = [];
        if (bestStart > intendedStart && item.scheduleMode === "fixedCadence") warnings.push("Сдвинуто относительно фиксированного шага из-за занятости");
        const priorityScore = bestEntry.priorityScore ?? 0;
        const placement = addTowFields(
          {
            index: placementsPreview.length,
            rowIndex: itemIndex,
            itemIndex: i,
            operatorId: item.operatorId,
            aircraftTypeId: item.aircraftTypeId,
            eventTypeId: item.eventTypeId,
            title,
            label,
            startAt: bestStart,
            endAt,
            hangarId: bestEntry.hangarId,
            layoutId: bestEntry.layoutId,
            standId: bestEntry.standId,
            scheduledBy: item.scheduleMode,
            warnings,
            score: priorityScore,
            scoreDetails: priorityScore > 0 ? [`Приоритет размещения: +${priorityScore}`] : [],
            priorityRuleIds: bestEntry.priorityRuleIds
          } as any,
          towBeforeMs,
          towAfterMs,
          item.startFrom.getTime(),
          item.endTo.getTime()
        ) as PlacementPreview & { rowIndex: number; itemIndex: number; operatorId: string; aircraftTypeId: string; eventTypeId: string };
        placementsPreview.push(placement);
        addBusy(bestEntry.standId, bestStart, endAt);
        if (item.scheduleMode !== "fixedCadence") nextStartByItem.set(itemIndex, endAt + spacingMs);
      }
    }

    const serializePlacement = (p: typeof placementsPreview[number]) => ({
      ...p,
      startAt: new Date(p.startAt).toISOString(),
      endAt: new Date(p.endAt).toISOString(),
      budgetStartAt: body.budgetStartAt?.toISOString() ?? null,
      budgetEndAt: body.budgetEndAt?.toISOString() ?? null,
      actualStartAt: body.actualStartAt?.toISOString() ?? null,
      actualEndAt: body.actualEndAt?.toISOString() ?? null,
      towBeforeStartAt: p.towBeforeStartAt ? new Date(p.towBeforeStartAt).toISOString() : undefined,
      towBeforeEndAt: p.towBeforeEndAt ? new Date(p.towBeforeEndAt).toISOString() : undefined,
      towAfterStartAt: p.towAfterStartAt ? new Date(p.towAfterStartAt).toISOString() : undefined,
      towAfterEndAt: p.towAfterEndAt ? new Date(p.towAfterEndAt).toISOString() : undefined
    });

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        batch: true,
        placements: placementsPreview.map(serializePlacement),
        unplaced: unplacedPreview.map((u) => ({ ...u, intendedStartAt: new Date(u.intendedStartAt).toISOString() })),
        summary: {
          total: body.items.reduce((sum, item) => sum + item.count, 0),
          rows: body.items.length,
          placed: placementsPreview.length,
          unplaced: unplacedPreview.length,
          createdTowsBefore: placementsPreview.filter((p) => p.towBeforeStartAt != null).length,
          createdTowsAfter: placementsPreview.filter((p) => p.towAfterStartAt != null).length,
          draftOnConflict: body.placementMode === "draftOnConflict"
        }
      };
    }

    const sbId = sandboxIdFor(req);
    const result = await app.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
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
      const eventRows: Prisma.MaintenanceEventCreateManyInput[] = [];
      const placementRows: Prisma.EventPlacementCreateManyInput[] = [];
      const reservationRows: Prisma.StandReservationCreateManyInput[] = [];

      for (const p of placementsPreview) {
        const eventId = randomUUID();
        const placementId = randomUUID();
        const startAt = new Date(p.startAt);
        const endAt = new Date(p.endAt);
        eventRows.push({
          id: eventId,
          level: PlanningLevel.OPERATIONAL,
          status: EventStatus.PLANNED,
          planningKind: body.budgetStartAt && body.budgetEndAt ? "PLANNED" : "UNPLANNED",
          title: p.title,
          sandboxId: sbId,
          eventTypeId: p.eventTypeId,
          startAt,
          endAt,
          budgetStartAt: body.budgetStartAt ?? null,
          budgetEndAt: body.budgetEndAt ?? null,
          actualStartAt: body.actualStartAt ?? null,
          actualEndAt: body.actualEndAt ?? null,
          hangarId: p.hangarId,
          layoutId: p.layoutId,
          virtualAircraft: { operatorId: p.operatorId, aircraftTypeId: p.aircraftTypeId, label: p.label } as Prisma.InputJsonValue
        });
        placementRows.push({
          id: placementId,
          eventId,
          sandboxId: sbId,
          startAt,
          endAt,
          budgetStartAt: body.budgetStartAt ?? null,
          budgetEndAt: body.budgetEndAt ?? null,
          actualStartAt: body.actualStartAt ?? null,
          actualEndAt: body.actualEndAt ?? null,
          hangarId: p.hangarId,
          layoutId: p.layoutId,
          standId: p.standId,
          sortOrder: 0
        });
        reservationRows.push({
          eventId,
          placementId,
          sandboxId: sbId,
          layoutId: p.layoutId,
          standId: p.standId,
          startAt,
          endAt
        });
        created.push({ eventId, label: p.label, title: p.title, startAt, endAt, hangarId: p.hangarId, layoutId: p.layoutId, standId: p.standId, status: EventStatus.PLANNED });
      }

      for (const u of unplacedPreview) {
        const eventId = randomUUID();
        const item = body.items[u.rowIndex]!;
        const tatMs = item.tatHours * 60 * 60 * 1000;
        const startAt = new Date(item.endTo.getTime());
        const endAt = new Date(item.endTo.getTime() + tatMs);
        eventRows.push({
          id: eventId,
          level: PlanningLevel.OPERATIONAL,
          status: EventStatus.DRAFT,
          planningKind: body.budgetStartAt && body.budgetEndAt ? "PLANNED" : "UNPLANNED",
          title: u.title,
          sandboxId: sbId,
          eventTypeId: u.eventTypeId,
          startAt,
          endAt,
          budgetStartAt: body.budgetStartAt ?? null,
          budgetEndAt: body.budgetEndAt ?? null,
          actualStartAt: body.actualStartAt ?? null,
          actualEndAt: body.actualEndAt ?? null,
          hangarId: null,
          layoutId: null,
          virtualAircraft: { operatorId: u.operatorId, aircraftTypeId: u.aircraftTypeId, label: u.label } as Prisma.InputJsonValue
        });
        created.push({ eventId, label: u.label, title: u.title, startAt, endAt, hangarId: null, layoutId: null, standId: null, status: EventStatus.DRAFT });
      }

      if (eventRows.length > 0) await tx.maintenanceEvent.createMany({ data: eventRows });
      if (placementRows.length > 0) await tx.eventPlacement.createMany({ data: placementRows });
      if (reservationRows.length > 0) await tx.standReservation.createMany({ data: reservationRows });

        return created;
      },
      MASS_PLAN_TRANSACTION_OPTIONS
    );

    return {
      ok: true,
      dryRun: false,
      batch: true,
      created: result.length,
      placed: result.filter((r) => r.status === EventStatus.PLANNED).length,
      unplaced: result.filter((r) => r.status === EventStatus.DRAFT).length,
      events: result.map((r) => ({ ...r, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString() }))
    };
  });
};
