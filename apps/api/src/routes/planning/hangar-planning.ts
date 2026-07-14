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
  aircraftId: string | null;
  aircraftTypeId: string | null;
  operatorId: string | null;
  bodyType: BodyType;
  eventTypeId: string | null;
  eventTypeName: string | null;
  startAt: Date;
  endAt: Date;
  hangarId: string | null;
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

function eventAircraftTypeId(event: any): string | null {
  const realTypeId = event.aircraft?.typeId ? String(event.aircraft.typeId) : null;
  if (realTypeId) return realTypeId;
  const virtualTypeId = event.virtualAircraft?.aircraftTypeId ? String(event.virtualAircraft.aircraftTypeId) : null;
  return virtualTypeId;
}

function eventAircraftId(event: any): string | null {
  if (event.aircraftId) return String(event.aircraftId);
  if (event.aircraft?.id) return String(event.aircraft.id);
  return null;
}

function eventOperatorId(event: any): string | null {
  if (event.aircraft?.operatorId) return String(event.aircraft.operatorId);
  if (event.virtualAircraft?.operatorId) return String(event.virtualAircraft.operatorId);
  return null;
}

function eventEventTypeId(event: any): string | null {
  if (event.eventTypeId) return String(event.eventTypeId);
  if (event.eventType?.id) return String(event.eventType.id);
  return null;
}

function allowedAircraftTypeIds(stand: any): string[] {
  return (stand.allowedAircraftTypes ?? []).map((link: any) => String(link.aircraftTypeId));
}

function standAccepts(standAircraftTypeIds: string[], eventAircraftTypeIdValue: string | null): boolean {
  return standAircraftTypeIds.length === 0 || !eventAircraftTypeIdValue || standAircraftTypeIds.includes(eventAircraftTypeIdValue);
}

function buildSummaryEvent(event: any, bodyTypeByAircraftTypeId: Map<string, BodyType>): SummaryEvent {
  return {
    id: event.id,
    title: event.title,
    status: event.status,
    aircraftLabel: aircraftLabel(event),
    aircraftId: eventAircraftId(event),
    aircraftTypeId: eventAircraftTypeId(event),
    operatorId: eventOperatorId(event),
    bodyType: eventBodyType(event, bodyTypeByAircraftTypeId),
    eventTypeId: eventEventTypeId(event),
    eventTypeName: event.eventType?.name ?? null,
    startAt: event.startAt,
    endAt: event.endAt,
    hangarId: event.hangarId ? String(event.hangarId) : null,
    reservation: null
  };
}

function summaryEventFields(e: any, bodyTypeByAircraftTypeId: Map<string, BodyType>) {
  return {
    id: e.id,
    title: e.title,
    status: e.status,
    aircraftLabel: aircraftLabel(e),
    aircraftId: eventAircraftId(e),
    aircraftTypeId: eventAircraftTypeId(e),
    operatorId: eventOperatorId(e),
    bodyType: eventBodyType(e, bodyTypeByAircraftTypeId),
    eventTypeId: eventEventTypeId(e),
    eventTypeName: e.eventType?.name ?? null
  };
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

    let referenceStandCount = 0;
    for (const l of hangarLayouts) {
      referenceStandCount = Math.max(referenceStandCount, (l.stands ?? []).length);
    }

    for (let i = 0; i < sorted.length - 1; i++) {
      const s = sorted[i]!;
      const en = sorted[i + 1]!;
      if (en <= s) continue;
      const active = hangarEvents.filter((e) => e.startAt.getTime() < en && e.endAt.getTime() > s);
      const durationHours = (en - s) / (60 * 60 * 1000);

      if (active.length === 0) {
        // Empty hangar: nominal (max) layout capacity — blocked alternatives contribute 0
        if (referenceStandCount > 0) capacityHours += referenceStandCount * durationHours;
        continue;
      }

      const activeLayoutIds = Array.from(new Set(active.map((e) => e.reservation?.layoutId).filter(Boolean) as string[]));
      const conflict = activeLayoutIds.length > 1;
      const primaryLayout = activeLayoutIds.length === 1 ? layoutById.get(activeLayoutIds[0]!) : null;
      const capacity = primaryLayout ? (primaryLayout.stands ?? []).length : 0;
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
          stands: {
            where: { isActive: true },
            include: { allowedAircraftTypes: { select: { aircraftTypeId: true } } },
            orderBy: { code: "asc" }
          }
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
    const layoutById = new Map(layouts.map((l: any) => [l.id, l]));
    const selectedLayoutsRaw = selectedLayoutIds.size
      ? layouts.filter((l: any) => selectedLayoutIds.has(l.id))
      : Array.from(new Map(layouts.map((l: any) => [l.hangarId, l])).values());
    // Гарантируем карточку для каждого ангара с активной схемой (даже если клиент
    // не передал layoutId из‑за гонки загрузки или выбрал неактивную схему).
    const selectedLayouts = [...selectedLayoutsRaw];
    const coveredHangarIds = new Set(selectedLayouts.map((l: any) => String(l.hangarId)));
    for (const layout of layouts) {
      const hid = String(layout.hangarId);
      if (coveredHangarIds.has(hid)) continue;
      selectedLayouts.push(layout);
      coveredHangarIds.add(hid);
    }
    const periodMs = Math.max(1, query.to.getTime() - query.from.getTime());
    const resolveHangarId = (e: any, placement: any | null, reservation: any | null): string | null => {
      if (placement?.hangarId) return String(placement.hangarId);
      if (e.hangarId) return String(e.hangarId);
      const layoutId = placement?.layoutId ?? reservation?.layoutId;
      if (layoutId) {
        const hid = layoutById.get(String(layoutId))?.hangarId;
        return hid ? String(hid) : null;
      }
      return null;
    };
    const summaryEvents: SummaryEvent[] = events.flatMap((e: any) => {
      const base = summaryEventFields(e, bodyTypeByAircraftTypeId);
      const placements = e.placements?.length ? e.placements : [];
      if (placements.length === 0) {
        const reservation = e.reservations?.[0] ?? null;
        return [{
          ...base,
          startAt: reservation?.startAt ?? e.startAt,
          endAt: reservation?.endAt ?? e.endAt,
          hangarId: resolveHangarId(e, null, reservation),
          reservation: reservation ? { layoutId: reservation.layoutId, standId: reservation.standId } : null
        }];
      }
      return placements.map((p: any) => ({
        ...base,
        startAt: p.startAt,
        endAt: p.endAt,
        hangarId: resolveHangarId(e, p, null),
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
          aircraftTypeIds: allowedAircraftTypeIds(stand),
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
      const capacityByAircraftTypeRule = {
        specific: stands.filter((s: any) => allowedAircraftTypeIds(s).length > 0).length,
        any: stands.filter((s: any) => allowedAircraftTypeIds(s).length === 0).length
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
          capacityByBodyType,
          capacityByAircraftTypeRule
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
    const hangarsWithActiveLayouts = new Set(layouts.map((l: any) => String(l.hangarId)));
    const unplaced = summaryEvents.filter((e) => !e.reservation || !selectedLayoutIdSet.has(e.reservation.layoutId));
    const incompatible = unplaced.map((e) => ({
      event: e,
      suitableStandCount: selectedLayouts.reduce((sum: number, l: any) => {
        return sum + (l.stands ?? []).filter((s: any) => standAccepts(allowedAircraftTypeIds(s), e.aircraftTypeId)).length;
      }, 0)
    }));

    // Только ангары без активных схем в БД (внешние MRO и т.п.)
    const allHangars = await app.prisma.hangar.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" }
    });
    const layoutlessHangars = allHangars
      .filter((h) => !hangarsWithActiveLayouts.has(h.id))
      .map((hangar) => {
        const hangarEvents = summaryEvents.filter((e) => e.hangarId === hangar.id);
        return {
          hangar,
          layout: {
            id: "",
            code: "",
            name: "Без схемы",
            description: null,
            widthMeters: null,
            heightMeters: null,
            obstacles: null,
            capacityByBodyType: { narrow: 0, wide: 0, any: 0 },
            capacityByAircraftTypeRule: { specific: 0, any: 0 }
          },
          utilizationPct: 0,
          timeUtilizationPct: 0,
          aircraftHours: 0,
          capacityHours: 0,
          conflictPct: 0,
          conflictSegments: 0,
          efficiencyTimeline: [],
          occupiedAtCount: 0,
          freeAtCount: query.at ? 0 : null,
          eventCount: hangarEvents.length,
          standCount: 0,
          stands: [],
          assignedEvents: hangarEvents,
          isPhysical: hangar.isPhysical !== false
        };
      })
      .filter((h) => h.eventCount > 0);

    const hangarsOut = [
      ...byLayout.map((h: any) => ({ ...h, isPhysical: h.hangar?.isPhysical !== false, assignedEvents: [] as SummaryEvent[] })),
      ...layoutlessHangars
    ];

    return {
      ok: true,
      range: { from: query.from, to: query.to, at: query.at ?? null },
      selectedLayouts: selectedLayouts.map((l: any) => ({ hangarId: l.hangarId, layoutId: l.id })),
      summary: {
        hangars: hangarsOut.length,
        layouts: selectedLayouts.length,
        events: summaryEvents.length,
        unplaced: unplaced.length,
        incompatible: incompatible.filter((x) => x.suitableStandCount === 0).length
      },
      hangars: hangarsOut,
      unplaced,
      incompatible
    };
  });

  app.post("/suggest-placement", async (req) => {
    assertPermission(req as any, "events:read");
    const body = z
      .object({
        eventId: zUuid,
        hangarId: zUuid
      })
      .parse(req.body);

    const [event, layouts, aircraftTypes, reservations] = await Promise.all([
      app.prisma.maintenanceEvent.findFirst({
        where: {
          id: body.eventId,
          ...sandboxFilter(req as any),
          status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] }
        },
        include: {
          aircraft: { include: { type: true } },
          eventType: true,
          reservations: { orderBy: [{ startAt: "asc" }] },
          placements: { orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }] }
        }
      }),
      app.prisma.hangarLayout.findMany({
        where: { hangarId: body.hangarId, isActive: true },
        include: {
          hangar: true,
          stands: {
            where: { isActive: true },
            include: { allowedAircraftTypes: { select: { aircraftTypeId: true } } },
            orderBy: { code: "asc" }
          }
        },
        orderBy: [{ code: "asc" }, { name: "asc" }]
      }),
      app.prisma.aircraftType.findMany({ select: { id: true, bodyType: true } }),
      app.prisma.standReservation.findMany({
        where: {
          ...sandboxFilter(req as any),
          layout: { hangarId: body.hangarId },
          event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
        },
        include: { layout: { select: { id: true, name: true, hangarId: true } }, event: { select: { id: true } } },
        orderBy: [{ startAt: "asc" }]
      })
    ]);

    if (!event) throw app.httpErrors.notFound("Event not found");
    if (layouts.length === 0) {
      return { ok: true, event: null, candidates: [], blockedLayouts: [], summary: { candidates: 0, activeLayoutIds: [] } };
    }

    const bodyTypeByAircraftTypeId = new Map<string, BodyType>(
      aircraftTypes.map((t: any) => [t.id, (t.bodyType ?? null) as BodyType])
    );
    const summaryEvent = buildSummaryEvent(event, bodyTypeByAircraftTypeId);
    const startAt = event.startAt;
    const endAt = event.endAt;
    const currentReservation = event.reservations?.[0] ?? null;
    const currentStandById = currentReservation
      ? layouts.flatMap((layout: any) => layout.stands ?? []).find((stand: any) => stand.id === currentReservation.standId)
      : null;
    const currentStandCode = currentStandById?.code ?? null;

    const overlapping = reservations.filter(
      (reservation: any) =>
        reservation.eventId !== event.id &&
        reservation.startAt < endAt &&
        reservation.endAt > startAt
    );
    const activeLayoutIds = Array.from(new Set(overlapping.map((reservation: any) => reservation.layoutId)));
    const allowedLayoutIds = new Set(activeLayoutIds.length > 0 ? activeLayoutIds : layouts.map((layout: any) => layout.id));
    const blockedLayouts = layouts
      .filter((layout: any) => !allowedLayoutIds.has(layout.id))
      .map((layout: any) => ({ layoutId: layout.id, layoutName: layout.name }));

    const candidates = layouts
      .filter((layout: any) => allowedLayoutIds.has(layout.id))
      .flatMap((layout: any) =>
        (layout.stands ?? []).flatMap((stand: any) => {
          const aircraftTypeIds = allowedAircraftTypeIds(stand);
          if (!standAccepts(aircraftTypeIds, summaryEvent.aircraftTypeId)) return [];

          const standConflicts = overlapping.filter((reservation: any) => reservation.standId === stand.id);
          if (standConflicts.length > 0) return [];

          const utilizationInPeriod = reservations
            .filter((reservation: any) => reservation.standId === stand.id)
            .reduce((sum: number, reservation: any) => sum + overlapMs(reservation.startAt, reservation.endAt, startAt, endAt), 0);
          const sameStandCode = Boolean(currentStandCode && stand.code === currentStandCode);
          const activeLayout = activeLayoutIds.includes(layout.id);
          const score =
            (activeLayout ? 1000 : 0) +
            (sameStandCode ? 100 : 0) +
            (aircraftTypeIds.length > 0 ? 10 : 0) -
            utilizationInPeriod / (60 * 60 * 1000);

          return [{
            hangarId: layout.hangarId,
            hangarName: layout.hangar.name,
            layoutId: layout.id,
            layoutName: layout.name,
            layoutCode: layout.code,
            standId: stand.id,
            standCode: stand.code,
            score: Number(score.toFixed(2)),
            reason: activeLayout
              ? sameStandCode
                ? "активная схема периода, тот же код места"
                : "активная схема периода"
              : sameStandCode
                ? "свободный ангар, тот же код места"
                : "свободный ангар"
          }];
        })
      )
      .sort((a: any, b: any) => b.score - a.score || a.layoutName.localeCompare(b.layoutName, "ru") || a.standCode.localeCompare(b.standCode, "ru"))
      .slice(0, 20);

    return {
      ok: true,
      event: summaryEvent,
      candidates,
      blockedLayouts,
      summary: {
        candidates: candidates.length,
        activeLayoutIds
      }
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
        include: {
          hangar: true,
          stands: {
            where: { isActive: true },
            include: { allowedAircraftTypes: { select: { aircraftTypeId: true } } },
            orderBy: { code: "asc" }
          }
        }
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
        aircraftTypeIds: allowedAircraftTypeIds(stand),
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
        aircraftTypeId: eventAircraftTypeId(e),
        bodyType: eventBodyType(e, bodyTypeByAircraftTypeId),
        startAt: e.startAt,
        endAt: e.endAt
      }));

    const placements: any[] = [];
    const unplaced: any[] = [];
    for (const event of candidates) {
      const stand = standOptions.find((s) => {
        if (!standAccepts(s.aircraftTypeIds, event.aircraftTypeId)) return false;
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
