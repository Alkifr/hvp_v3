import type { FastifyPluginAsync } from "fastify";
import { EventStatus } from "@prisma/client";
import { z } from "zod";

import { assertPermission } from "../lib/rbac.js";
import { zDateTime, zUuid } from "../lib/zod.js";
import { sandboxFilter } from "../plugins/sandbox.js";

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

async function assertSandboxAccess(app: any, sandboxId: string | null, userId: string) {
  if (!sandboxId) return true;
  const sb = await app.prisma.sandbox.findUnique({
    where: { id: sandboxId },
    select: { id: true, ownerId: true, members: { where: { userId }, select: { userId: true } } }
  });
  if (!sb) {
    const err: any = new Error("SANDBOX_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }
  if (sb.ownerId !== userId && sb.members.length === 0) {
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
        aircraft: { select: { tailNumber: true } },
        eventType: { select: { name: true, code: true } },
        hangar: { select: { name: true } },
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
        eventType: e.eventType?.name ?? "—",
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

  // GET /api/analytics/utilization?from&to
  app.get("/utilization", async (req) => {
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

    const periodH = hoursBetween(query.from, query.to);
    const sb = sandboxFilter(req as any);

    const [hangars, stands, reservations] = await Promise.all([
      app.prisma.hangar.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
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
      })
    ]);

    const standRows = stands.map((stand) => {
      const rs = reservations.filter((r) => r.standId === stand.id);
      let occupiedH = 0;
      for (const r of rs) {
        occupiedH += overlapHours(r.startAt, r.endAt, query.from, query.to);
      }
      // ограничим занятость периодом (нахлёсты могут дать >100%)
      const utilPct = periodH > 0 ? Math.min(100, (occupiedH / periodH) * 100) : 0;
      const idleH = Math.max(0, periodH - Math.min(occupiedH, periodH));
      return {
        standId: stand.id,
        standCode: stand.code,
        standName: stand.name,
        hangarId: stand.layout.hangarId,
        hangarName: stand.layout.hangar?.name ?? "—",
        layoutId: stand.layoutId,
        layoutName: stand.layout.name,
        occupiedH: round1(Math.min(occupiedH, periodH * 3)),
        idleH: round1(idleH),
        utilizationPct: round1(utilPct),
        reservationCount: rs.length
      };
    });

    const hangarRows = hangars.map((h) => {
      const ss = standRows.filter((s) => s.hangarId === h.id);
      const standCount = ss.length;
      const capacityH = periodH * Math.max(1, standCount);
      const occupiedH = ss.reduce((sum, s) => sum + Math.min(s.occupiedH, periodH), 0);
      const idleH = Math.max(0, capacityH - occupiedH);
      const utilizationPct = capacityH > 0 ? (occupiedH / capacityH) * 100 : 0;
      return {
        hangarId: h.id,
        hangarName: h.name,
        hangarCode: h.code,
        standCount,
        occupiedH: round1(occupiedH),
        idleH: round1(idleH),
        capacityH: round1(capacityH),
        utilizationPct: round1(utilizationPct),
        reservationCount: ss.reduce((sum, s) => sum + s.reservationCount, 0)
      };
    });

    const overallCapacity = hangarRows.reduce((s, h) => s + h.capacityH, 0);
    const overallOccupied = hangarRows.reduce((s, h) => s + h.occupiedH, 0);

    return {
      ok: true as const,
      period: { from: query.from.toISOString(), to: query.to.toISOString(), hours: round1(periodH) },
      summary: {
        hangars: hangarRows.length,
        stands: standRows.length,
        occupiedH: round1(overallOccupied),
        idleH: round1(Math.max(0, overallCapacity - overallOccupied)),
        capacityH: round1(overallCapacity),
        utilizationPct: overallCapacity > 0 ? round1((overallOccupied / overallCapacity) * 100) : 0
      },
      hangars: hangarRows.sort((a, b) => b.utilizationPct - a.utilizationPct),
      stands: standRows.sort((a, b) => b.utilizationPct - a.utilizationPct)
    };
  });

  // GET /api/analytics/sandbox-compare?from&to&a=&b=
  // a/b: "prod" или uuid песочницы
  app.get("/sandbox-compare", async (req) => {
    assertPermission(req as any, "events:read");
    const auth = (req as any).auth as { id?: string } | undefined;
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
    await assertSandboxAccess(app, aId, userId);
    await assertSandboxAccess(app, bId, userId);

    const periodH = hoursBetween(query.from, query.to);

    const loadSide = async (sandboxId: string | null) => {
      const [sandboxMeta, events, reservations, stands] = await Promise.all([
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
            reservations: { select: { standId: true, layoutId: true, startAt: true, endAt: true } }
          }
        }),
        app.prisma.standReservation.findMany({
          where: {
            sandboxId,
            startAt: { lt: query.to },
            endAt: { gt: query.from },
            event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
          },
          select: { standId: true, startAt: true, endAt: true, layout: { select: { hangarId: true } } }
        }),
        app.prisma.hangarStand.count({ where: { isActive: true, layout: { isActive: true } } })
      ]);

      let aircraftHours = 0;
      let placed = 0;
      let unplaced = 0;
      for (const e of events) {
        aircraftHours += overlapHours(e.startAt, e.endAt, query.from, query.to);
        if (e.reservations.length > 0) placed += 1;
        else unplaced += 1;
      }

      let occupiedStandHours = 0;
      const byHangar = new Map<string, number>();
      for (const r of reservations) {
        const h = overlapHours(r.startAt, r.endAt, query.from, query.to);
        occupiedStandHours += h;
        const hangarId = r.layout.hangarId;
        byHangar.set(hangarId, (byHangar.get(hangarId) ?? 0) + h);
      }

      const capacityH = periodH * Math.max(1, stands);
      const utilizationPct = capacityH > 0 ? Math.min(100, (occupiedStandHours / capacityH) * 100) : 0;
      const idleH = Math.max(0, capacityH - Math.min(occupiedStandHours, capacityH));

      return {
        scope: sandboxId ? "sandbox" : "prod",
        sandboxId,
        name: sandboxMeta?.name ?? "Рабочий контур",
        status: sandboxMeta?.status ?? null,
        events: events.length,
        placed,
        unplaced,
        aircraftHours: round1(aircraftHours),
        occupiedStandHours: round1(occupiedStandHours),
        idleH: round1(idleH),
        capacityH: round1(capacityH),
        utilizationPct: round1(utilizationPct),
        avgEventTatH: events.length
          ? round1(events.reduce((s, e) => s + hoursBetween(e.startAt, e.endAt), 0) / events.length)
          : 0,
        hangarLoad: Array.from(byHangar.entries())
          .map(([hangarId, hours]) => ({ hangarId, occupiedH: round1(hours) }))
          .sort((x, y) => y.occupiedH - x.occupiedH)
      };
    };

    const [sideA, sideB] = await Promise.all([loadSide(aId), loadSide(bId)]);

    const hangarIds = Array.from(
      new Set([...sideA.hangarLoad.map((x) => x.hangarId), ...sideB.hangarLoad.map((x) => x.hangarId)])
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
          deltaH: round1(bH - aH)
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
};
