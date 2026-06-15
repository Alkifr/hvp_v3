import type { FastifyPluginAsync } from "fastify";
import { EventStatus } from "@prisma/client";
import { z } from "zod";

import { assertPermission } from "../../lib/rbac.js";
import { zDateTime, zUuid } from "../../lib/zod.js";
import { sandboxFilter } from "../../plugins/sandbox.js";

type BodyType = "NARROW_BODY" | "WIDE_BODY" | null;

type SummaryEvent = {
  id: string;
  title: string;
  status: string;
  aircraftLabel: string;
  bodyType: BodyType;
  eventTypeName: string | null;
  startAt: Date;
  endAt: Date;
  reservation: { layoutId: string; standId: string } | null;
};

type EfficiencySegment = {
  startAt: Date;
  endAt: Date;
  layoutId: string | null;
  layoutName: string | null;
  activeLayoutIds: string[];
  occupiedCount: number;
  capacity: number;
  utilizationPct: number;
  conflict: boolean;
};

function overlapMs(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  return Math.max(0, Math.min(aEnd.getTime(), bEnd.getTime()) - Math.max(aStart.getTime(), bStart.getTime()));
}

function isActiveAt(startAt: Date, endAt: Date, at: Date): boolean {
  return startAt.getTime() <= at.getTime() && endAt.getTime() > at.getTime();
}

function aircraftLabel(event: any): string {
  return event.aircraft?.tailNumber ?? event.virtualAircraft?.label ?? "—";
}

function eventBodyType(event: any, bodyTypeByAircraftTypeId: Map<string, BodyType>): BodyType {
  const real = event.aircraft?.type?.bodyType ?? null;
  if (real) return real as BodyType;
  const virtualTypeId = event.virtualAircraft?.aircraftTypeId ? String(event.virtualAircraft.aircraftTypeId) : "";
  return virtualTypeId ? (bodyTypeByAircraftTypeId.get(virtualTypeId) ?? null) : null;
}

function standAccepts(standBodyType: BodyType, eventBodyTypeValue: BodyType): boolean {
  return !standBodyType || !eventBodyTypeValue || standBodyType === eventBodyTypeValue;
}

function buildHangarEfficiency(params: {
  from: Date;
  to: Date;
  layouts: any[];
  events: SummaryEvent[];
}) {
  const { from, to, layouts, events } = params;
  const periodMs = Math.max(1, to.getTime() - from.getTime());
  const layoutById = new Map(layouts.map((l: any) => [l.id, l]));
  const hangarIds = Array.from(new Set(layouts.map((l: any) => l.hangarId)));

  return hangarIds.map((hangarId) => {
    const hangarLayouts = layouts.filter((l: any) => l.hangarId === hangarId);
    const hangar = hangarLayouts[0]?.hangar ?? null;
    const hangarEvents = events.filter((e) => {
      const layoutId = e.reservation?.layoutId;
      return Boolean(layoutId && layoutById.get(layoutId)?.hangarId === hangarId);
    });
    const points = new Set<number>([from.getTime(), to.getTime()]);
    for (const e of hangarEvents) {
      const s = Math.max(from.getTime(), e.startAt.getTime());
      const en = Math.min(to.getTime(), e.endAt.getTime());
      if (s < en) {
        points.add(s);
        points.add(en);
      }
    }

    const sorted = Array.from(points).sort((a, b) => a - b);
    const timeline: EfficiencySegment[] = [];
    let occupiedMs = 0;
    let aircraftHours = 0;
    let capacityHours = 0;
    let conflictMs = 0;

    for (let i = 0; i < sorted.length - 1; i++) {
      const s = sorted[i]!;
      const en = sorted[i + 1]!;
      if (en <= s) continue;
      const active = hangarEvents.filter((e) => e.startAt.getTime() < en && e.endAt.getTime() > s);
      if (active.length === 0) continue;

      const activeLayoutIds = Array.from(new Set(active.map((e) => e.reservation?.layoutId).filter(Boolean) as string[]));
      const conflict = activeLayoutIds.length > 1;
      const primaryLayout = activeLayoutIds.length === 1 ? layoutById.get(activeLayoutIds[0]!) : null;
      const capacity = primaryLayout ? (primaryLayout.stands ?? []).length : 0;
      const durationHours = (en - s) / (60 * 60 * 1000);
      const occupiedCount = active.length;
      const utilizationPct = capacity > 0 ? (occupiedCount / capacity) * 100 : 100;

      occupiedMs += en - s;
      aircraftHours += occupiedCount * durationHours;
      if (!conflict && capacity > 0) capacityHours += capacity * durationHours;
      if (conflict) conflictMs += en - s;
      timeline.push({
        startAt: new Date(s),
        endAt: new Date(en),
        layoutId: primaryLayout?.id ?? null,
        layoutName: primaryLayout?.name ?? (conflict ? "Конфликт схем" : null),
        activeLayoutIds,
        occupiedCount,
        capacity,
        utilizationPct,
        conflict
      });
    }

    return {
      hangarId,
      hangarName: hangar?.name ?? "Ангар",
      timeUtilizationPct: Math.min(100, (occupiedMs / periodMs) * 100),
      capacityUtilizationPct: capacityHours > 0 ? (aircraftHours / capacityHours) * 100 : 0,
      aircraftHours: Number(aircraftHours.toFixed(2)),
      capacityHours: Number(capacityHours.toFixed(2)),
      conflictPct: Math.min(100, (conflictMs / periodMs) * 100),
      conflictSegments: timeline.filter((x) => x.conflict).length,
      timeline
    };
  });
}

const zLayoutsParam = z
  .string()
  .trim()
  .min(1)
  .transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean));

const zLayoutSelection = z.object({
  hangarId: zUuid,
  layoutId: zUuid
});

export const hangarPlanningRoutes: FastifyPluginAsync = async (app) => {
  app.get("/summary", async (req) => {
    assertPermission(req as any, "events:read");
    const query = z
      .object({
        from: zDateTime,
        to: zDateTime,
        at: zDateTime.optional(),
        layoutIds: zLayoutsParam.optional()
      })
      .parse(req.query ?? {});

    const selectedLayoutIds = new Set(query.layoutIds ?? []);
    const [layouts, events, aircraftTypes] = await Promise.all([
      app.prisma.hangarLayout.findMany({
        where: { isActive: true },
        include: {
          hangar: true,
          stands: { where: { isActive: true }, orderBy: { code: "asc" } }
        },
        orderBy: [{ hangar: { name: "asc" } }, { name: "asc" }]
      }),
      app.prisma.maintenanceEvent.findMany({
        where: {
          ...sandboxFilter(req as any),
          status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] },
          startAt: { lt: query.to },
          endAt: { gt: query.from }
        },
        include: {
          aircraft: { include: { type: true } },
          eventType: true,
          reservations: { orderBy: [{ startAt: "asc" }] },
          placements: { orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }] }
        },
        orderBy: [{ startAt: "asc" }]
      }),
      app.prisma.aircraftType.findMany({ select: { id: true, bodyType: true } })
    ]);

    const bodyTypeByAircraftTypeId = new Map<string, BodyType>(
      aircraftTypes.map((t: any) => [t.id, (t.bodyType ?? null) as BodyType])
    );
    const selectedLayouts = selectedLayoutIds.size
      ? layouts.filter((l: any) => selectedLayoutIds.has(l.id))
      : Array.from(new Map(layouts.map((l: any) => [l.hangarId, l])).values());
    const periodMs = Math.max(1, query.to.getTime() - query.from.getTime());
    const summaryEvents: SummaryEvent[] = events.flatMap((e: any) => {
      const placements = e.placements?.length ? e.placements : [];
      if (placements.length === 0) {
        const reservation = e.reservations?.[0] ?? null;
        return [{
          id: e.id,
          title: e.title,
          status: e.status,
          aircraftLabel: aircraftLabel(e),
          bodyType: eventBodyType(e, bodyTypeByAircraftTypeId),
          eventTypeName: e.eventType?.name ?? null,
          startAt: reservation?.startAt ?? e.startAt,
          endAt: reservation?.endAt ?? e.endAt,
          reservation: reservation ? { layoutId: reservation.layoutId, standId: reservation.standId } : null
        }];
      }
      return placements.map((p: any) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        aircraftLabel: aircraftLabel(e),
        bodyType: eventBodyType(e, bodyTypeByAircraftTypeId),
        eventTypeName: e.eventType?.name ?? null,
        startAt: p.startAt,
        endAt: p.endAt,
        reservation: p.layoutId && p.standId ? { layoutId: p.layoutId, standId: p.standId } : null
      }));
    });
    const efficiencyByHangarId = new Map(
      buildHangarEfficiency({ from: query.from, to: query.to, layouts, events: summaryEvents }).map((x) => [x.hangarId, x])
    );

    const byLayout = selectedLayouts.map((layout: any) => {
      const stands = layout.stands ?? [];
      let occupiedMsTotal = 0;
      let occupiedNow = 0;
      const standSummaries = stands.map((stand: any) => {
        const reservationsOnStand = summaryEvents.filter((e) => e.reservation?.standId === stand.id);
        const occupiedMs = reservationsOnStand.reduce(
          (sum, e) => sum + overlapMs(e.startAt, e.endAt, query.from, query.to),
          0
        );
        const atEvents = query.at ? reservationsOnStand.filter((e) => isActiveAt(e.startAt, e.endAt, query.at!)) : [];
        if (atEvents.length > 0) occupiedNow += 1;
        occupiedMsTotal += occupiedMs;
        return {
          id: stand.id,
          code: stand.code,
          name: stand.name,
          bodyType: stand.bodyType,
          x: stand.x,
          y: stand.y,
          w: stand.w,
          h: stand.h,
          rotate: stand.rotate,
          utilizationPct: Math.min(100, (occupiedMs / periodMs) * 100),
          occupiedAt: atEvents[0] ?? null,
          reservations: reservationsOnStand
        };
      });
      const layoutEvents = summaryEvents.filter((e) => {
        const layoutId = e.reservation?.layoutId;
        return Boolean(layoutId && layouts.find((l: any) => l.id === layoutId)?.hangarId === layout.hangarId);
      });
      const capacityByBodyType = {
        narrow: stands.filter((s: any) => s.bodyType === "NARROW_BODY").length,
        wide: stands.filter((s: any) => s.bodyType === "WIDE_BODY").length,
        any: stands.filter((s: any) => !s.bodyType).length
      };
      return {
        hangar: layout.hangar,
        layout: {
          id: layout.id,
          code: layout.code,
          name: layout.name,
          description: layout.description,
          widthMeters: layout.widthMeters,
          heightMeters: layout.heightMeters,
          obstacles: layout.obstacles,
          capacityByBodyType
        },
        utilizationPct: efficiencyByHangarId.get(layout.hangarId)?.capacityUtilizationPct ?? (stands.length ? Math.min(100, (occupiedMsTotal / (stands.length * periodMs)) * 100) : 0),
        timeUtilizationPct: efficiencyByHangarId.get(layout.hangarId)?.timeUtilizationPct ?? 0,
        aircraftHours: efficiencyByHangarId.get(layout.hangarId)?.aircraftHours ?? 0,
        capacityHours: efficiencyByHangarId.get(layout.hangarId)?.capacityHours ?? 0,
        conflictPct: efficiencyByHangarId.get(layout.hangarId)?.conflictPct ?? 0,
        conflictSegments: efficiencyByHangarId.get(layout.hangarId)?.conflictSegments ?? 0,
        efficiencyTimeline: efficiencyByHangarId.get(layout.hangarId)?.timeline ?? [],
        occupiedAtCount: occupiedNow,
        freeAtCount: query.at ? Math.max(0, stands.length - occupiedNow) : null,
        eventCount: layoutEvents.length,
        standCount: stands.length,
        stands: standSummaries
      };
    });

    const selectedLayoutIdSet = new Set(selectedLayouts.map((l: any) => l.id));
    const unplaced = summaryEvents.filter((e) => !e.reservation || !selectedLayoutIdSet.has(e.reservation.layoutId));
    const incompatible = unplaced.map((e) => ({
      event: e,
      suitableStandCount: selectedLayouts.reduce((sum: number, l: any) => {
        return sum + (l.stands ?? []).filter((s: any) => standAccepts((s.bodyType ?? null) as BodyType, e.bodyType)).length;
      }, 0)
    }));

    return {
      ok: true,
      range: { from: query.from, to: query.to, at: query.at ?? null },
      selectedLayouts: selectedLayouts.map((l: any) => ({ hangarId: l.hangarId, layoutId: l.id })),
      summary: {
        hangars: byLayout.length,
        layouts: selectedLayouts.length,
        events: summaryEvents.length,
        unplaced: unplaced.length,
        incompatible: incompatible.filter((x) => x.suitableStandCount === 0).length
      },
      hangars: byLayout,
      unplaced,
      incompatible
    };
  });

  app.post("/auto-fit", async (req) => {
    assertPermission(req as any, "events:read");
    const body = z
      .object({
        from: zDateTime,
        to: zDateTime,
        layouts: z.array(zLayoutSelection).min(1)
      })
      .parse(req.body);

    const query = {
      from: body.from,
      to: body.to,
      layoutIds: body.layouts.map((l) => l.layoutId).join(",")
    };
    (req as any).query = query;

    const [layouts, events, aircraftTypes, reservations] = await Promise.all([
      app.prisma.hangarLayout.findMany({
        where: { id: { in: body.layouts.map((l) => l.layoutId) } },
        include: { hangar: true, stands: { where: { isActive: true }, orderBy: { code: "asc" } } }
      }),
      app.prisma.maintenanceEvent.findMany({
        where: {
          ...sandboxFilter(req as any),
          status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] },
          startAt: { lt: body.to },
          endAt: { gt: body.from }
        },
        include: { aircraft: { include: { type: true } }, eventType: true, reservations: { orderBy: [{ startAt: "asc" }] } },
        orderBy: [{ startAt: "asc" }]
      }),
      app.prisma.aircraftType.findMany({ select: { id: true, bodyType: true } }),
      app.prisma.standReservation.findMany({
        where: {
          ...sandboxFilter(req as any),
          layout: { hangarId: { in: body.layouts.map((l) => l.hangarId) } },
          startAt: { lt: body.to },
          endAt: { gt: body.from },
          event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
        },
        include: { layout: { select: { hangarId: true } } }
      })
    ]);

    const bodyTypeByAircraftTypeId = new Map<string, BodyType>(
      aircraftTypes.map((t: any) => [t.id, (t.bodyType ?? null) as BodyType])
    );
    const busyByStand = new Map<string, Array<{ startAt: Date; endAt: Date }>>();
    const layoutLocksByHangar = new Map<string, Array<{ layoutId: string; startAt: Date; endAt: Date }>>();
    for (const r of reservations as any[]) {
      const arr = busyByStand.get(r.standId) ?? [];
      arr.push({ startAt: r.startAt, endAt: r.endAt });
      busyByStand.set(r.standId, arr);
      const locks = layoutLocksByHangar.get(r.layout.hangarId) ?? [];
      locks.push({ layoutId: r.layoutId, startAt: r.startAt, endAt: r.endAt });
      layoutLocksByHangar.set(r.layout.hangarId, locks);
    }
    const standOptions = layouts.flatMap((layout: any) =>
      (layout.stands ?? []).map((stand: any) => ({
        hangarId: layout.hangarId,
        hangarName: layout.hangar.name,
        layoutId: layout.id,
        layoutName: layout.name,
        standId: stand.id,
        standCode: stand.code,
        bodyType: (stand.bodyType ?? null) as BodyType
      }))
    );
    const candidates = events
      .filter((e: any) => {
        const reservation = e.reservations?.[0] ?? null;
        return !reservation || !body.layouts.some((l) => l.layoutId === reservation.layoutId);
      })
      .map((e: any) => ({
        id: e.id,
        title: e.title,
        aircraftLabel: aircraftLabel(e),
        bodyType: eventBodyType(e, bodyTypeByAircraftTypeId),
        startAt: e.startAt,
        endAt: e.endAt
      }));

    const placements: any[] = [];
    const unplaced: any[] = [];
    for (const event of candidates) {
      const stand = standOptions.find((s) => {
        if (!standAccepts(s.bodyType, event.bodyType)) return false;
        const layoutLocks = layoutLocksByHangar.get(s.hangarId) ?? [];
        const incompatibleLayout = layoutLocks.some(
          (l) => l.layoutId !== s.layoutId && l.startAt < event.endAt && l.endAt > event.startAt
        );
        if (incompatibleLayout) return false;
        const busy = busyByStand.get(s.standId) ?? [];
        return !busy.some((b) => b.startAt < event.endAt && b.endAt > event.startAt);
      });
      if (!stand) {
        unplaced.push({ event, reason: "Нет свободного подходящего места в выбранных схемах" });
        continue;
      }
      placements.push({ event, ...stand });
      const busy = busyByStand.get(stand.standId) ?? [];
      busy.push({ startAt: event.startAt, endAt: event.endAt });
      busyByStand.set(stand.standId, busy);
      const locks = layoutLocksByHangar.get(stand.hangarId) ?? [];
      locks.push({ layoutId: stand.layoutId, startAt: event.startAt, endAt: event.endAt });
      layoutLocksByHangar.set(stand.hangarId, locks);
    }

    return {
      ok: true,
      placements,
      unplaced,
      summary: {
        candidates: candidates.length,
        placed: placements.length,
        unplaced: unplaced.length
      }
    };
  });
};
