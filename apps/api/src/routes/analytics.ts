import type { FastifyPluginAsync } from "fastify";
import { EventStatus } from "../lib/eventStatusCatalog.js";
import { z } from "zod";

import { assertPermission, isSystemAdmin } from "../lib/rbac.js";
import { zDateTime, zUuid } from "../lib/zod.js";
import { sandboxFilter } from "../plugins/sandbox.js";
import {
  MONTHLY_BASE_PLAN_MAX_DAYS,
  buildMonthlyBasePlan,
  type MonthlyBasePlanEventInput
} from "../lib/monthlyBasePlan.js";
import { serializeTowReportRow, resolveVirtualNames, towInclude } from "./planning/tows.js";
import {
  buildExclusiveLayoutSegments,
  buildUtilizationBuckets,
  clipHangarWindow,
  type EfficiencyGrain
} from "../lib/utilizationSeries.js";

const MS_HOUR = 60 * 60 * 1000;

function hoursBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / MS_HOUR);
}

function overlapHours(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  return Math.max(0, Math.min(aEnd.getTime(), bEnd.getTime()) - Math.max(aStart.getTime(), bStart.getTime())) / MS_HOUR;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pickTimelineGrain(from: Date, to: Date): Exclude<EfficiencyGrain, "period"> {
  const days = hoursBetween(from, to) / 24;
  if (days <= 45) return "day";
  if (days <= 180) return "week";
  return "month";
}

type EffEvent = {
  startAt: Date;
  endAt: Date;
  layoutId: string | null;
};

function computeHangarEfficiency(params: {
  from: Date;
  to: Date;
  standCountByLayoutId: Map<string, number>;
  hangarLayoutIds: string[];
  events: EffEvent[];
}) {
  const { from, to } = params;
  const periodMs = Math.max(1, to.getTime() - from.getTime());
  const { segments } = buildExclusiveLayoutSegments(params);
  const clip = clipHangarWindow(segments, [], from.getTime(), to.getTime());

  return {
    timeUtilizationPct: round1(Math.min(100, (clip.occupiedMs / periodMs) * 100)),
    capacityUtilizationPct: round1(clip.capacityHours > 0 ? (clip.aircraftHours / clip.capacityHours) * 100 : 0),
    aircraftHours: round2(clip.aircraftHours),
    capacityHours: round2(clip.capacityHours),
    conflictPct: round1(Math.min(100, (clip.conflictMs / periodMs) * 100)),
    conflictSegments: clip.conflictSegments
  };
}

/** Stand/place-hour utilization with exclusive-layout capacity (blocked layouts excluded). */
function computeHangarPlaceUtilization(params: {
  from: Date;
  to: Date;
  standCountByLayoutId: Map<string, number>;
  hangarLayoutIds: string[];
  events: EffEvent[];
  reservations: Array<{ layoutId: string; standId: string; startAt: Date; endAt: Date }>;
  stands: Array<{ standId: string; layoutId: string }>;
}) {
  const { from, to, reservations, stands } = params;
  const { segments, referenceLayoutId, referenceStandCount } = buildExclusiveLayoutSegments(params);
  const hangarLayoutSet = new Set(params.hangarLayoutIds);

  let capacityH = 0;
  const availableHByLayoutId = new Map<string, number>();
  for (const id of params.hangarLayoutIds) availableHByLayoutId.set(id, 0);

  for (const seg of segments) {
    const durationHours = (seg.endMs - seg.startMs) / MS_HOUR;
    if (seg.conflict) continue;
    capacityH += seg.capacity * durationHours;
    if (seg.layoutId) {
      availableHByLayoutId.set(seg.layoutId, (availableHByLayoutId.get(seg.layoutId) ?? 0) + durationHours);
    } else if (referenceLayoutId) {
      // Empty hangar: only nominal (max) layout contributes available stand-hours.
      availableHByLayoutId.set(
        referenceLayoutId,
        (availableHByLayoutId.get(referenceLayoutId) ?? 0) + durationHours
      );
    }
  }

  let occupiedH = 0;
  const occupiedHByStandId = new Map<string, number>();
  for (const r of reservations) {
    if (!hangarLayoutSet.has(r.layoutId)) continue;
    const h = overlapHours(r.startAt, r.endAt, from, to);
    if (h <= 0) continue;
    occupiedH += h;
    occupiedHByStandId.set(r.standId, (occupiedHByStandId.get(r.standId) ?? 0) + h);
  }

  const cappedOccupied = Math.min(occupiedH, capacityH);
  const idleH = Math.max(0, capacityH - cappedOccupied);
  const utilizationPct = capacityH > 0 ? (cappedOccupied / capacityH) * 100 : 0;

  const standMetrics = stands.map((stand) => {
    const availableH = availableHByLayoutId.get(stand.layoutId) ?? 0;
    const rawOcc = occupiedHByStandId.get(stand.standId) ?? 0;
    const standIdleH = availableH > 0 ? Math.max(0, availableH - Math.min(rawOcc, availableH)) : 0;
    const utilPct = availableH > 0 ? Math.min(100, (Math.min(rawOcc, availableH) / availableH) * 100) : 0;
    return {
      standId: stand.standId,
      layoutId: stand.layoutId,
      availableH,
      occupiedH: availableH > 0 ? Math.min(rawOcc, availableH) : 0,
      idleH: standIdleH,
      utilizationPct: utilPct
    };
  });

  return {
    capacityH,
    occupiedH: cappedOccupied,
    idleH,
    utilizationPct,
    referenceStandCount,
    standMetrics
  };
}

type DeviationKind =
  | "ON_TIME"
  | "LATE_START"
  | "EARLY_START"
  | "LATE_FINISH"
  | "EARLY_FINISH"
  | "TAT_OVERRUN"
  | "TAT_UNDERRUN"
  | "MISSING_ACTUAL";

const DEVIATION_LABEL: Record<DeviationKind, string> = {
  ON_TIME: "В срок",
  LATE_START: "Поздний старт",
  EARLY_START: "Ранний старт",
  LATE_FINISH: "Позднее окончание",
  EARLY_FINISH: "Раннее окончание",
  TAT_OVERRUN: "TAT больше плана",
  TAT_UNDERRUN: "TAT меньше плана",
  MISSING_ACTUAL: "Нет фактических дат"
};

function classifyDeviations(params: {
  planStart: Date;
  planEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
}): DeviationKind[] {
  const { planStart, planEnd, actualStart, actualEnd } = params;
  if (!actualStart || !actualEnd) return ["MISSING_ACTUAL"];

  const kinds: DeviationKind[] = [];
  const startDeltaH = (actualStart.getTime() - planStart.getTime()) / MS_HOUR;
  const endDeltaH = (actualEnd.getTime() - planEnd.getTime()) / MS_HOUR;
  const planTat = hoursBetween(planStart, planEnd);
  const actualTat = hoursBetween(actualStart, actualEnd);
  const tatDelta = actualTat - planTat;

  if (startDeltaH > 2) kinds.push("LATE_START");
  else if (startDeltaH < -2) kinds.push("EARLY_START");

  if (endDeltaH > 2) kinds.push("LATE_FINISH");
  else if (endDeltaH < -2) kinds.push("EARLY_FINISH");

  if (tatDelta > 2) kinds.push("TAT_OVERRUN");
  else if (tatDelta < -2) kinds.push("TAT_UNDERRUN");

  if (kinds.length === 0) kinds.push("ON_TIME");
  return kinds;
}

async function assertSandboxAccess(app: any, sandboxId: string | null, userId: string, roles: string[] = []) {
  if (!sandboxId) return true;
  const sb = await app.prisma.sandbox.findUnique({
    where: { id: sandboxId },
    select: {
      id: true,
      ownerId: true,
      sharedWithAllRole: true,
      members: { where: { userId }, select: { userId: true } }
    }
  });
  if (!sb) {
    const err: any = new Error("SANDBOX_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }
  if (sb.ownerId !== userId && sb.members.length === 0 && !sb.sharedWithAllRole && !isSystemAdmin(roles)) {
    const err: any = new Error("SANDBOX_ACCESS_DENIED");
    err.statusCode = 403;
    throw err;
  }
  return true;
}

function parseSandboxScope(raw: string | undefined): string | null {
  if (!raw || raw === "prod" || raw === "null") return null;
  return zUuid.parse(raw);
}

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/analytics/tat-variance?from&to
  app.get("/tat-variance", async (req) => {
    assertPermission(req as any, "events:read");
    const query = z
      .object({
        from: zDateTime,
        to: zDateTime
      })
      .parse(req.query);

    if (query.to <= query.from) {
      const err: any = new Error("Период to должен быть позже from");
      err.statusCode = 400;
      throw err;
    }

    const events = await app.prisma.maintenanceEvent.findMany({
      where: {
        ...sandboxFilter(req as any),
        status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] },
        startAt: { lt: query.to },
        endAt: { gt: query.from }
      },
      include: {
        aircraft: { select: { id: true, tailNumber: true, operatorId: true, typeId: true } },
        eventType: { select: { id: true, name: true, code: true } },
        hangar: { select: { id: true, name: true } },
        auditTrail: {
          where: { reason: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { reason: true, action: true, createdAt: true, changes: true }
        }
      },
      orderBy: [{ startAt: "asc" }]
    });

    const rows = events.map((e) => {
      const planStart = e.startAt;
      const planEnd = e.endAt;
      const actualStart = e.actualStartAt;
      const actualEnd = e.actualEndAt;
      const budgetStart = e.budgetStartAt;
      const budgetEnd = e.budgetEndAt;

      const planTatH = hoursBetween(planStart, planEnd);
      const actualTatH = actualStart && actualEnd ? hoursBetween(actualStart, actualEnd) : null;
      const budgetTatH = budgetStart && budgetEnd ? hoursBetween(budgetStart, budgetEnd) : null;

      const startDelayH =
        actualStart != null ? round1((actualStart.getTime() - planStart.getTime()) / MS_HOUR) : null;
      const endDelayH = actualEnd != null ? round1((actualEnd.getTime() - planEnd.getTime()) / MS_HOUR) : null;
      const tatVarianceH = actualTatH != null ? round1(actualTatH - planTatH) : null;

      const kinds = classifyDeviations({
        planStart,
        planEnd,
        actualStart,
        actualEnd
      });

      const dateAudit = e.auditTrail.find((a) => {
        const ch = a.changes as Record<string, unknown> | null;
        if (!ch || typeof ch !== "object") return Boolean(a.reason);
        return (
          "startAt" in ch ||
          "endAt" in ch ||
          "actualStartAt" in ch ||
          "actualEndAt" in ch ||
          "budgetStartAt" in ch ||
          "budgetEndAt" in ch ||
          Boolean(a.reason)
        );
      });

      return {
        eventId: e.id,
        title: e.title,
        status: e.status,
        aircraft: e.aircraft?.tailNumber ?? (e.virtualAircraft as any)?.label ?? "—",
        aircraftId: e.aircraft?.id ?? null,
        operatorId: e.aircraft?.operatorId ?? (e.virtualAircraft as any)?.operatorId ?? null,
        aircraftTypeId: e.aircraft?.typeId ?? (e.virtualAircraft as any)?.aircraftTypeId ?? null,
        eventTypeId: e.eventType?.id ?? null,
        eventType: e.eventType?.name ?? "—",
        hangarId: e.hangar?.id ?? e.hangarId ?? null,
        hangar: e.hangar?.name ?? null,
        planStartAt: planStart.toISOString(),
        planEndAt: planEnd.toISOString(),
        actualStartAt: actualStart?.toISOString() ?? null,
        actualEndAt: actualEnd?.toISOString() ?? null,
        budgetStartAt: budgetStart?.toISOString() ?? null,
        budgetEndAt: budgetEnd?.toISOString() ?? null,
        planTatH: round1(planTatH),
        actualTatH: actualTatH != null ? round1(actualTatH) : null,
        budgetTatH: budgetTatH != null ? round1(budgetTatH) : null,
        tatVarianceH,
        startDelayH,
        endDelayH,
        deviationKinds: kinds,
        deviationLabels: kinds.map((k) => DEVIATION_LABEL[k]),
        reason: dateAudit?.reason ?? e.notes ?? null,
        reasonAt: dateAudit?.createdAt?.toISOString() ?? null
      };
    });

    const withActual = rows.filter((r) => r.actualTatH != null);
    const reasonCounts = new Map<string, number>();
    const kindCounts = new Map<string, number>();
    for (const r of rows) {
      for (const label of r.deviationLabels) {
        kindCounts.set(label, (kindCounts.get(label) ?? 0) + 1);
      }
      const reason = (r.reason ?? "").trim() || (r.deviationKinds.includes("MISSING_ACTUAL") ? "Нет факта" : "Без причины");
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }

    const avgTatVariance =
      withActual.length > 0
        ? round1(withActual.reduce((s, r) => s + (r.tatVarianceH ?? 0), 0) / withActual.length)
        : null;
    const avgStartDelay =
      withActual.length > 0
        ? round1(withActual.reduce((s, r) => s + (r.startDelayH ?? 0), 0) / withActual.length)
        : null;

    return {
      ok: true as const,
      period: { from: query.from.toISOString(), to: query.to.toISOString() },
      summary: {
        events: rows.length,
        withActual: withActual.length,
        missingActual: rows.length - withActual.length,
        avgTatVarianceH: avgTatVariance,
        avgStartDelayH: avgStartDelay,
        onTime: rows.filter((r) => r.deviationKinds.includes("ON_TIME")).length,
        lateStart: rows.filter((r) => r.deviationKinds.includes("LATE_START")).length,
        tatOverrun: rows.filter((r) => r.deviationKinds.includes("TAT_OVERRUN")).length
      },
      deviationBreakdown: Array.from(kindCounts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      reasonBreakdown: Array.from(reasonCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      rows
    };
  });

  // GET /api/analytics/utilization?from&to&grain=day|week|month|period
  app.get("/utilization", async (req) => {
    assertPermission(req as any, "events:read");
    const query = z
      .object({
        from: zDateTime,
        to: zDateTime,
        grain: z.enum(["day", "week", "month", "period"]).optional().default("period"),
        /** Client timezone offset east of UTC in minutes (dayjs.utcOffset()). */
        tzOffset: z.coerce.number().int().min(-14 * 60).max(14 * 60).optional().default(0)
      })
      .parse(req.query);

    if (query.to <= query.from) {
      const err: any = new Error("Период to должен быть позже from");
      err.statusCode = 400;
      throw err;
    }

    const periodH = hoursBetween(query.from, query.to);
    const sb = sandboxFilter(req as any);

    const [hangars, stands, reservations, layouts, events] = await Promise.all([
      app.prisma.hangar.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true, isPhysical: true },
        orderBy: { name: "asc" }
      }),
      app.prisma.hangarStand.findMany({
        where: { isActive: true, layout: { isActive: true } },
        select: {
          id: true,
          code: true,
          name: true,
          layoutId: true,
          layout: { select: { id: true, name: true, hangarId: true, hangar: { select: { id: true, name: true } } } }
        },
        orderBy: [{ code: "asc" }]
      }),
      app.prisma.standReservation.findMany({
        where: {
          ...sb,
          startAt: { lt: query.to },
          endAt: { gt: query.from },
          event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
        },
        select: {
          standId: true,
          layoutId: true,
          startAt: true,
          endAt: true,
          event: { select: { id: true, title: true } }
        }
      }),
      app.prisma.hangarLayout.findMany({
        where: { isActive: true },
        select: {
          id: true,
          hangarId: true,
          stands: { where: { isActive: true }, select: { id: true } }
        }
      }),
      app.prisma.maintenanceEvent.findMany({
        where: {
          ...sb,
          status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] },
          startAt: { lt: query.to },
          endAt: { gt: query.from }
        },
        select: {
          id: true,
          startAt: true,
          endAt: true,
          hangarId: true,
          reservations: { select: { layoutId: true, startAt: true, endAt: true } },
          placements: { select: { layoutId: true, startAt: true, endAt: true } }
        }
      })
    ]);

    const standCountByLayoutId = new Map(layouts.map((l) => [l.id, l.stands.length]));
    const layoutsByHangar = new Map<string, string[]>();
    for (const l of layouts) {
      const arr = layoutsByHangar.get(l.hangarId) ?? [];
      arr.push(l.id);
      layoutsByHangar.set(l.hangarId, arr);
    }

    const effEvents: EffEvent[] = [];
    for (const e of events) {
      if (e.placements.length > 0) {
        for (const p of e.placements) {
          if (p.layoutId) effEvents.push({ startAt: p.startAt, endAt: p.endAt, layoutId: p.layoutId });
        }
      } else if (e.reservations[0]) {
        const r = e.reservations[0];
        effEvents.push({ startAt: r.startAt, endAt: r.endAt, layoutId: r.layoutId });
      }
    }

    const placeByHangar = new Map<
      string,
      ReturnType<typeof computeHangarPlaceUtilization>
    >();

    for (const h of hangars) {
      const hangarLayoutIds = layoutsByHangar.get(h.id) ?? [];
      const hangarStandIds = new Set(
        stands.filter((s) => s.layout.hangarId === h.id).map((s) => s.id)
      );
      placeByHangar.set(
        h.id,
        computeHangarPlaceUtilization({
          from: query.from,
          to: query.to,
          standCountByLayoutId,
          hangarLayoutIds,
          events: effEvents,
          reservations: reservations.filter((r) => hangarStandIds.has(r.standId)),
          stands: stands
            .filter((s) => s.layout.hangarId === h.id)
            .map((s) => ({ standId: s.id, layoutId: s.layoutId }))
        })
      );
    }

    const standRows = stands.map((stand) => {
      const place = placeByHangar.get(stand.layout.hangarId);
      const m = place?.standMetrics.find((x) => x.standId === stand.id);
      const rs = reservations.filter((r) => r.standId === stand.id);
      const availableH = m?.availableH ?? 0;
      const occupiedH = m?.occupiedH ?? 0;
      const idleH = m?.idleH ?? 0;
      const utilPct = m?.utilizationPct ?? 0;
      return {
        standId: stand.id,
        standCode: stand.code,
        standName: stand.name,
        hangarId: stand.layout.hangarId,
        hangarName: stand.layout.hangar?.name ?? "—",
        layoutId: stand.layoutId,
        layoutName: stand.layout.name,
        availableH: round1(availableH),
        occupiedH: round1(occupiedH),
        idleH: round1(idleH),
        utilizationPct: round1(utilPct),
        reservationCount: rs.length,
        /** true when layout was blocked by another active layout for the whole period */
        blockedByOtherLayout: availableH <= 0 && rs.length === 0
      };
    });

    const hangarRows = hangars.map((h) => {
      const ss = standRows.filter((s) => s.hangarId === h.id);
      const place = placeByHangar.get(h.id)!;
      const hangarLayoutIds = layoutsByHangar.get(h.id) ?? [];
      const eff = computeHangarEfficiency({
        from: query.from,
        to: query.to,
        standCountByLayoutId,
        hangarLayoutIds,
        events: effEvents
      });
      return {
        hangarId: h.id,
        hangarName: h.name,
        hangarCode: h.code,
        isPhysical: h.isPhysical !== false,
        standCount: place.referenceStandCount,
        layoutCount: hangarLayoutIds.length,
        occupiedH: round1(place.occupiedH),
        idleH: round1(place.idleH),
        capacityH: round1(place.capacityH),
        utilizationPct: round1(place.utilizationPct),
        reservationCount: ss.reduce((sum, s) => sum + s.reservationCount, 0),
        efficiency: eff
      };
    });

    const overallCapacity = hangarRows.reduce((s, h) => s + h.capacityH, 0);
    const overallOccupied = hangarRows.reduce((s, h) => s + h.occupiedH, 0);

    // One segment sweep per hangar for the whole period. Day buckets only clip that sweep,
    // so a year of days stays close to the cost of a single period, not 365 rebuilds.
    const bucketHangars = hangars.map((h) => {
      const hangarLayoutIds = layoutsByHangar.get(h.id) ?? [];
      const hangarLayoutSet = new Set(hangarLayoutIds);
      const hangarStandIds = new Set(stands.filter((s) => s.layout.hangarId === h.id).map((s) => s.id));
      const { segments } = buildExclusiveLayoutSegments({
        from: query.from,
        to: query.to,
        standCountByLayoutId,
        hangarLayoutIds,
        events: effEvents
      });
      const reservationSpans = reservations
        .filter((r) => hangarStandIds.has(r.standId) && hangarLayoutSet.has(r.layoutId))
        .map((r) => ({ startMs: r.startAt.getTime(), endMs: r.endAt.getTime() }));
      return { hangar: h, segments, reservationSpans };
    });

    const mapBucketSeries = (grain: EfficiencyGrain) => {
      const defs = buildUtilizationBuckets(query.from, query.to, grain, query.tzOffset);
      const segCursor = bucketHangars.map(() => 0);
      return defs.map((b) => {
        const fromMs = b.from.getTime();
        const toMs = b.to.getTime();
        const periodMs = Math.max(1, toMs - fromMs);
        const hangarBucket = bucketHangars.map((p, idx) => {
          const clip = clipHangarWindow(p.segments, p.reservationSpans, fromMs, toMs, segCursor[idx] ?? 0);
          segCursor[idx] = clip.segFromIdx;
          const cappedOccupied = Math.min(clip.occupiedH, clip.capacityH);
          return {
            hangarId: p.hangar.id,
            hangarName: p.hangar.name,
            standUtilizationPct: round1(clip.capacityH > 0 ? (cappedOccupied / clip.capacityH) * 100 : 0),
            occupiedH: round1(cappedOccupied),
            capacityH: round1(clip.capacityH),
            idleH: round1(Math.max(0, clip.capacityH - cappedOccupied)),
            timeUtilizationPct: round1(Math.min(100, (clip.occupiedMs / periodMs) * 100)),
            capacityUtilizationPct: round1(
              clip.capacityHours > 0 ? (clip.aircraftHours / clip.capacityHours) * 100 : 0
            ),
            aircraftHours: round2(clip.aircraftHours),
            capacityHours: round2(clip.capacityHours),
            conflictPct: round1(Math.min(100, (clip.conflictMs / periodMs) * 100)),
            conflictSegments: clip.conflictSegments
          };
        });
        const aircraftHours = hangarBucket.reduce((s, h) => s + h.aircraftHours, 0);
        const capacityHours = hangarBucket.reduce((s, h) => s + h.capacityHours, 0);
        const occupiedH = hangarBucket.reduce((s, h) => s + h.occupiedH, 0);
        const capacityH = hangarBucket.reduce((s, h) => s + h.capacityH, 0);
        return {
          key: b.key,
          label: b.label,
          from: b.from.toISOString(),
          to: b.to.toISOString(),
          capacityUtilizationPct: round1(capacityHours > 0 ? (aircraftHours / capacityHours) * 100 : 0),
          timeUtilizationPct: round1(
            hangarBucket.length
              ? hangarBucket.reduce((s, h) => s + h.timeUtilizationPct, 0) / hangarBucket.length
              : 0
          ),
          standUtilizationPct: round1(capacityH > 0 ? (occupiedH / capacityH) * 100 : 0),
          aircraftHours: round2(aircraftHours),
          capacityHours: round2(capacityHours),
          occupiedH: round1(occupiedH),
          capacityH: round1(capacityH),
          idleH: round1(Math.max(0, capacityH - occupiedH)),
          conflictPct: round1(
            hangarBucket.length ? hangarBucket.reduce((s, h) => s + h.conflictPct, 0) / hangarBucket.length : 0
          ),
          hangars: hangarBucket.sort((a, b2) => b2.capacityUtilizationPct - a.capacityUtilizationPct)
        };
      });
    };

    const buckets = mapBucketSeries(query.grain);
    const timelineGrain = query.grain === "period" ? pickTimelineGrain(query.from, query.to) : query.grain;
    const timeline = timelineGrain === query.grain ? buckets : mapBucketSeries(timelineGrain);

    const periodEffAircraft = hangarRows.reduce((s, h) => s + h.efficiency.aircraftHours, 0);
    const periodEffCapacity = hangarRows.reduce((s, h) => s + h.efficiency.capacityHours, 0);

    return {
      ok: true as const,
      period: { from: query.from.toISOString(), to: query.to.toISOString(), hours: round1(periodH) },
      summary: {
        hangars: hangarRows.length,
        stands: standRows.filter((s) => !s.blockedByOtherLayout || s.reservationCount > 0).length,
        occupiedH: round1(overallOccupied),
        idleH: round1(Math.max(0, overallCapacity - overallOccupied)),
        capacityH: round1(overallCapacity),
        utilizationPct: overallCapacity > 0 ? round1((overallOccupied / overallCapacity) * 100) : 0
      },
      efficiency: {
        grain: query.grain,
        note:
          "Ёмкость и простой считаются по активной схеме (взаимоисключающие конфигурации). Заблокированные схемы не дают idle. Пустые интервалы — по nominal-ёмкости (max мест среди схем). Эффективность = ВС·ч / место·ч.",
        period: {
          capacityUtilizationPct: round1(periodEffCapacity > 0 ? (periodEffAircraft / periodEffCapacity) * 100 : 0),
          timeUtilizationPct: round1(
            hangarRows.length
              ? hangarRows.reduce((s, h) => s + h.efficiency.timeUtilizationPct, 0) / hangarRows.length
              : 0
          ),
          standUtilizationPct: overallCapacity > 0 ? round1((overallOccupied / overallCapacity) * 100) : 0,
          aircraftHours: round2(periodEffAircraft),
          capacityHours: round2(periodEffCapacity),
          conflictPct: round1(
            hangarRows.length ? hangarRows.reduce((s, h) => s + h.efficiency.conflictPct, 0) / hangarRows.length : 0
          )
        },
        buckets,
        timeline: {
          grain: timelineGrain,
          points: timeline
        }
      },
      hangars: hangarRows.sort((a, b) => b.efficiency.capacityUtilizationPct - a.efficiency.capacityUtilizationPct),
      stands: standRows.sort((a, b) => b.utilizationPct - a.utilizationPct)
    };
  });

  // GET /api/analytics/sandbox-compare?from&to&a=&b=
  // a/b: "prod" или uuid песочницы
  app.get("/sandbox-compare", async (req) => {
    assertPermission(req as any, "events:read");
    const auth = (req as any).auth as { id?: string; roles?: string[] } | undefined;
    const userId = auth?.id;
    if (!userId) {
      const err: any = new Error("UNAUTHORIZED");
      err.statusCode = 401;
      throw err;
    }

    const query = z
      .object({
        from: zDateTime,
        to: zDateTime,
        a: z.string().trim().min(1),
        b: z.string().trim().min(1)
      })
      .parse(req.query);

    if (query.to <= query.from) {
      const err: any = new Error("Период to должен быть позже from");
      err.statusCode = 400;
      throw err;
    }

    const aId = parseSandboxScope(query.a);
    const bId = parseSandboxScope(query.b);
    await assertSandboxAccess(app, aId, userId, auth?.roles ?? []);
    await assertSandboxAccess(app, bId, userId, auth?.roles ?? []);

    const periodH = hoursBetween(query.from, query.to);

    const layouts = await app.prisma.hangarLayout.findMany({
      where: { isActive: true },
      select: {
        id: true,
        hangarId: true,
        stands: { where: { isActive: true }, select: { id: true } }
      }
    });
    const standCountByLayoutId = new Map(layouts.map((l) => [l.id, l.stands.length]));
    const layoutsByHangar = new Map<string, string[]>();
    const standsByHangar = new Map<string, Array<{ standId: string; layoutId: string }>>();
    for (const l of layouts) {
      const arr = layoutsByHangar.get(l.hangarId) ?? [];
      arr.push(l.id);
      layoutsByHangar.set(l.hangarId, arr);
      const ss = standsByHangar.get(l.hangarId) ?? [];
      for (const s of l.stands) ss.push({ standId: s.id, layoutId: l.id });
      standsByHangar.set(l.hangarId, ss);
    }

    const loadSide = async (sandboxId: string | null) => {
      const [sandboxMeta, events, reservations] = await Promise.all([
        sandboxId
          ? app.prisma.sandbox.findUnique({ where: { id: sandboxId }, select: { id: true, name: true, status: true } })
          : Promise.resolve(null),
        app.prisma.maintenanceEvent.findMany({
          where: {
            sandboxId,
            status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] },
            startAt: { lt: query.to },
            endAt: { gt: query.from }
          },
          select: {
            id: true,
            title: true,
            status: true,
            startAt: true,
            endAt: true,
            hangarId: true,
            virtualAircraft: true,
            aircraft: { select: { id: true, tailNumber: true, operatorId: true, typeId: true } },
            eventType: { select: { id: true, name: true } },
            hangar: { select: { id: true, name: true } },
            reservations: {
              select: {
                standId: true,
                layoutId: true,
                startAt: true,
                endAt: true,
                stand: { select: { code: true } },
                layout: { select: { hangarId: true } }
              }
            },
            placements: { select: { layoutId: true, startAt: true, endAt: true } }
          }
        }),
        app.prisma.standReservation.findMany({
          where: {
            sandboxId,
            startAt: { lt: query.to },
            endAt: { gt: query.from },
            event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
          },
          select: {
            standId: true,
            layoutId: true,
            startAt: true,
            endAt: true,
            layout: { select: { hangarId: true } }
          }
        })
      ]);

      let aircraftHours = 0;
      let placed = 0;
      let unplaced = 0;
      type CompareEventRow = {
        eventId: string;
        title: string;
        status: string;
        aircraft: string;
        aircraftId: string | null;
        operatorId: string | null;
        aircraftTypeId: string | null;
        eventTypeId: string | null;
        eventType: string;
        hangarId: string;
        standCode: string | null;
        startAt: string;
        endAt: string;
        occupiedH: number;
      };
      const eventsByHangar = new Map<string, CompareEventRow[]>();
      const effEvents: EffEvent[] = [];

      for (const e of events) {
        aircraftHours += overlapHours(e.startAt, e.endAt, query.from, query.to);
        if (e.reservations.length > 0) placed += 1;
        else unplaced += 1;

        if (e.placements.length > 0) {
          for (const p of e.placements) {
            if (p.layoutId) effEvents.push({ startAt: p.startAt, endAt: p.endAt, layoutId: p.layoutId });
          }
        } else if (e.reservations[0]) {
          const r = e.reservations[0];
          effEvents.push({ startAt: r.startAt, endAt: r.endAt, layoutId: r.layoutId });
        }

        const aircraftLabel = e.aircraft?.tailNumber ?? (e as any).virtualAircraft?.label ?? "—";
        const operatorId = e.aircraft?.operatorId ?? (e as any).virtualAircraft?.operatorId ?? null;
        const aircraftTypeId = e.aircraft?.typeId ?? (e as any).virtualAircraft?.aircraftTypeId ?? null;

        const pushEvent = (hangarId: string, standCode: string | null, startAt: Date, endAt: Date) => {
          const list = eventsByHangar.get(hangarId) ?? [];
          list.push({
            eventId: e.id,
            title: e.title,
            status: e.status,
            aircraft: aircraftLabel,
            aircraftId: e.aircraft?.id ?? null,
            operatorId,
            aircraftTypeId,
            eventTypeId: e.eventType?.id ?? null,
            eventType: e.eventType?.name ?? "—",
            hangarId,
            standCode,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            occupiedH: round1(overlapHours(startAt, endAt, query.from, query.to))
          });
          eventsByHangar.set(hangarId, list);
        };

        if (e.reservations.length === 0) {
          const hangarId = e.hangarId ?? e.hangar?.id ?? null;
          if (hangarId) pushEvent(hangarId, null, e.startAt, e.endAt);
          continue;
        }
        for (const r of e.reservations) {
          const hangarId = r.layout?.hangarId ?? e.hangarId ?? e.hangar?.id;
          if (hangarId) pushEvent(hangarId, r.stand?.code ?? null, r.startAt, r.endAt);
        }
      }

      let occupiedStandHours = 0;
      const byHangar = new Map<string, number>();
      for (const r of reservations) {
        const h = overlapHours(r.startAt, r.endAt, query.from, query.to);
        occupiedStandHours += h;
        const hangarId = r.layout.hangarId;
        byHangar.set(hangarId, (byHangar.get(hangarId) ?? 0) + h);
      }

      // Exclusive-layout capacity across all hangars (blocked layouts excluded)
      let capacityH = 0;
      let idleH = 0;
      for (const [hangarId, hangarLayoutIds] of layoutsByHangar.entries()) {
        const place = computeHangarPlaceUtilization({
          from: query.from,
          to: query.to,
          standCountByLayoutId,
          hangarLayoutIds,
          events: effEvents,
          reservations: reservations.filter((r) => r.layout.hangarId === hangarId),
          stands: standsByHangar.get(hangarId) ?? []
        });
        capacityH += place.capacityH;
        idleH += place.idleH;
      }
      const utilizationPct = capacityH > 0 ? Math.min(100, (Math.min(occupiedStandHours, capacityH) / capacityH) * 100) : 0;

      return {
        scope: sandboxId ? "sandbox" : "prod",
        sandboxId,
        name: sandboxMeta?.name ?? "Рабочий контур",
        status: sandboxMeta?.status ?? null,
        events: events.length,
        placed,
        unplaced,
        aircraftHours: round1(aircraftHours),
        occupiedStandHours: round1(Math.min(occupiedStandHours, capacityH || occupiedStandHours)),
        idleH: round1(idleH),
        capacityH: round1(capacityH),
        utilizationPct: round1(utilizationPct),
        avgEventTatH: events.length
          ? round1(events.reduce((s, e) => s + hoursBetween(e.startAt, e.endAt), 0) / events.length)
          : 0,
        hangarLoad: Array.from(byHangar.entries())
          .map(([hangarId, hours]) => ({ hangarId, occupiedH: round1(hours) }))
          .sort((x, y) => y.occupiedH - x.occupiedH),
        eventsByHangar: Object.fromEntries(
          Array.from(eventsByHangar.entries()).map(([hangarId, list]) => [
            hangarId,
            list.sort((x, y) => x.startAt.localeCompare(y.startAt))
          ])
        )
      };
    };

    const [sideA, sideB] = await Promise.all([loadSide(aId), loadSide(bId)]);

    const hangarIds = Array.from(
      new Set([
        ...sideA.hangarLoad.map((x) => x.hangarId),
        ...sideB.hangarLoad.map((x) => x.hangarId),
        ...Object.keys(sideA.eventsByHangar),
        ...Object.keys(sideB.eventsByHangar)
      ])
    );
    const hangars = hangarIds.length
      ? await app.prisma.hangar.findMany({
          where: { id: { in: hangarIds } },
          select: { id: true, name: true }
        })
      : [];
    const hangarName = new Map(hangars.map((h) => [h.id, h.name]));

    const hangarCompare = hangarIds
      .map((id) => {
        const aH = sideA.hangarLoad.find((x) => x.hangarId === id)?.occupiedH ?? 0;
        const bH = sideB.hangarLoad.find((x) => x.hangarId === id)?.occupiedH ?? 0;
        return {
          hangarId: id,
          hangarName: hangarName.get(id) ?? id,
          aOccupiedH: aH,
          bOccupiedH: bH,
          deltaH: round1(bH - aH),
          aEvents: sideA.eventsByHangar[id] ?? [],
          bEvents: sideB.eventsByHangar[id] ?? []
        };
      })
      .sort((x, y) => Math.abs(y.deltaH) - Math.abs(x.deltaH));

    return {
      ok: true as const,
      period: { from: query.from.toISOString(), to: query.to.toISOString(), hours: round1(periodH) },
      a: sideA,
      b: sideB,
      delta: {
        events: sideB.events - sideA.events,
        placed: sideB.placed - sideA.placed,
        unplaced: sideB.unplaced - sideA.unplaced,
        aircraftHours: round1(sideB.aircraftHours - sideA.aircraftHours),
        occupiedStandHours: round1(sideB.occupiedStandHours - sideA.occupiedStandHours),
        idleH: round1(sideB.idleH - sideA.idleH),
        utilizationPct: round1(sideB.utilizationPct - sideA.utilizationPct),
        avgEventTatH: round1(sideB.avgEventTatH - sideA.avgEventTatH)
      },
      hangarCompare
    };
  });

  // GET /api/analytics/monthly-base-plan?from&to&tzOffset
  app.get("/monthly-base-plan", async (req) => {
    assertPermission(req as any, "events:read");
    const query = z
      .object({
        from: zDateTime,
        to: zDateTime,
        tzOffset: z.coerce.number().int().min(-14 * 60).max(14 * 60).optional().default(0)
      })
      .parse(req.query);

    if (query.to <= query.from) {
      const err: any = new Error("Период to должен быть позже from");
      err.statusCode = 400;
      throw err;
    }

    const spanDays = (query.to.getTime() - query.from.getTime()) / (24 * 60 * 60 * 1000);
    if (spanDays > MONTHLY_BASE_PLAN_MAX_DAYS) {
      const err: any = new Error(`Период не больше ${MONTHLY_BASE_PLAN_MAX_DAYS} суток`);
      err.statusCode = 400;
      throw err;
    }

    const sb = sandboxFilter(req as any);
    const [events, operators, aircraftTypes, palettes] = await Promise.all([
      app.prisma.maintenanceEvent.findMany({
        where: {
          ...sb,
          status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] },
          startAt: { lt: query.to },
          endAt: { gt: query.from }
        },
        include: {
          aircraft: {
            select: {
              id: true,
              tailNumber: true,
              operatorId: true,
              typeId: true,
              operator: { select: { id: true, code: true, name: true } },
              type: { select: { id: true, name: true, icaoType: true } }
            }
          },
          eventType: { select: { id: true, name: true, color: true } },
          hangar: { select: { id: true, name: true } },
          workshop: { select: { id: true, name: true, code: true } },
          reportMetrics: {
            where: { block: { in: ["WP_PLAN_MPS", "LABOR_BUDGET"] } },
            select: { block: true, department: true, manHours: true }
          },
          workPlanLines: {
            where: {
              date: { gte: new Date(query.from.getTime() - 24 * 60 * 60 * 1000), lt: query.to }
            },
            select: {
              date: true,
              plannedMinutes: true,
              skill: { select: { code: true } },
              shift: { select: { code: true, startMin: true } }
            }
          }
        },
        orderBy: [{ startAt: "asc" }]
      }),
      app.prisma.operator.findMany({ select: { id: true, code: true, name: true } }),
      app.prisma.aircraftType.findMany({ select: { id: true, name: true, icaoType: true } }),
      app.prisma.aircraftTypePalette.findMany({
        where: { isActive: true },
        select: { operatorId: true, aircraftTypeId: true, color: true }
      })
    ]);

    const operatorById = new Map(operators.map((o) => [o.id, o]));
    const typeById = new Map(aircraftTypes.map((t) => [t.id, t]));
    const paletteByKey = new Map(palettes.map((p) => [`${p.operatorId}:${p.aircraftTypeId}`, p.color]));

    const inputs: MonthlyBasePlanEventInput[] = events.map((e) => {
      const virt = (e.virtualAircraft ?? null) as {
        label?: string;
        operatorId?: string;
        aircraftTypeId?: string;
      } | null;
      const operatorId = e.aircraft?.operatorId ?? virt?.operatorId ?? null;
      const aircraftTypeId = e.aircraft?.typeId ?? virt?.aircraftTypeId ?? null;
      const operator = operatorId ? operatorById.get(operatorId) : null;
      const type = aircraftTypeId ? typeById.get(aircraftTypeId) : null;
      const color =
        (operatorId && aircraftTypeId ? paletteByKey.get(`${operatorId}:${aircraftTypeId}`) : null) ||
        e.eventType?.color ||
        "#38bdf8";
      return {
        eventId: e.id,
        title: e.title,
        startAt: e.startAt,
        endAt: e.endAt,
        aircraftLabel: e.aircraft?.tailNumber ?? virt?.label ?? "—",
        aircraftTypeName: e.aircraft?.type?.icaoType || e.aircraft?.type?.name || type?.icaoType || type?.name || "—",
        operatorCode: e.aircraft?.operator?.code || operator?.code || "—",
        operatorId,
        aircraftId: e.aircraft?.id ?? null,
        aircraftTypeId,
        eventTypeId: e.eventType?.id ?? null,
        hangarId: e.hangar?.id ?? e.hangarId ?? null,
        hangarName: e.hangar?.name ?? "—",
        workshopId: e.workshop?.id ?? null,
        workshopName: e.workshop?.name || e.workshop?.code || "—",
        color,
        metrics: e.reportMetrics.map((m) => ({
          block: m.block,
          department: m.department,
          manHours: m.manHours == null ? null : Number(m.manHours)
        })),
        planLines: e.workPlanLines.map((line) => ({
          date: line.date,
          plannedMinutes: line.plannedMinutes,
          shiftCode: line.shift?.code ?? null,
          shiftStartMin: line.shift?.startMin ?? null,
          skillCode: line.skill?.code ?? null
        }))
      };
    });

    const report = buildMonthlyBasePlan({
      from: query.from,
      to: query.to,
      tzOffsetMinutes: query.tzOffset,
      events: inputs
    });

    return {
      ok: true as const,
      period: { from: query.from.toISOString(), to: query.to.toISOString() },
      ...report
    };
  });

  // GET /api/analytics/tows?from&to
  app.get("/tows", async (req) => {
    assertPermission(req as any, "events:read");
    const query = z
      .object({
        from: zDateTime,
        to: zDateTime
      })
      .parse(req.query);

    if (query.to <= query.from) {
      const err: any = new Error("Период to должен быть позже from");
      err.statusCode = 400;
      throw err;
    }

    const tows = await app.prisma.eventTow.findMany({
      where: {
        ...sandboxFilter(req as any),
        startAt: { lt: query.to },
        endAt: { gt: query.from },
        event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
      },
      include: towInclude,
      orderBy: [{ startAt: "asc" }, { id: "asc" }]
    });

    const virtualNames = await resolveVirtualNames(app.prisma, tows);
    const rows = tows.map((tow) => {
      const report = serializeTowReportRow(tow, virtualNames.get(tow.id));
      return {
        id: report.id,
        eventId: report.eventId,
        eventTitle: report.eventTitle,
        eventStatus: report.eventStatus,
        eventTypeId: report.eventTypeId || null,
        eventType: report.eventType || "—",
        hangarId: report.hangarId || null,
        hangar: report.hangarNumber || "—",
        aircraftId: report.aircraftId || null,
        aircraft: report.tailNumber || "—",
        aircraftTypeId: report.aircraftTypeId || null,
        aircraftType: report.aircraftType || "—",
        operatorId: report.operatorId || null,
        operator: report.operator || "—",
        direction: report.direction,
        directionLabel: report.directionLabel || "Не определено",
        fromStand: report.fromStand,
        toStand: report.toStand,
        startAt: report.plannedStartAt,
        endAt: report.plannedEndAt,
        occupancyEndAt: report.occupancyEndAt || report.inferredOccupancyEndAt || null,
        towDurationMin: report.towDurationMinutes,
        occupancyMin: report.standOccupancyMinutes,
        slotMin: report.toSlotMinutes,
        startChangeReason: report.startChangeReason,
        notes: report.notes,
        positionComment: report.positionComment,
        plannedStartMsk: report.plannedStartMsk,
        occupancyEndMsk: report.occupancyEndMsk,
        standOccupancy: report.standOccupancy
      };
    });

    return {
      ok: true as const,
      period: { from: query.from.toISOString(), to: query.to.toISOString() },
      rows
    };
  });
};
