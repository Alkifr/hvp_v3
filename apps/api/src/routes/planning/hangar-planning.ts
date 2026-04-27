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
        where: selectedLayoutIds.size ? { id: { in: Array.from(selectedLayoutIds) } } : { isActive: true },
        include: {
          hangar: true,
          stands: { where: { isActive: true }, orderBy: { code: "asc" } }
        },
        orderBy: [{ hangar: { name: "asc" } }, { name: "asc" }]
      }),
      app.prisma.maintenanceEvent.findMany({
        where: {
          ...sandboxFilter(req as any),
          status: { not: EventStatus.CANCELLED },
          startAt: { lt: query.to },
          endAt: { gt: query.from }
        },
        include: {
          aircraft: { include: { type: true } },
          eventType: true,
          reservation: true
        },
        orderBy: [{ startAt: "asc" }]
      }),
      app.prisma.aircraftType.findMany({ select: { id: true, bodyType: true } })
    ]);

    const bodyTypeByAircraftTypeId = new Map<string, BodyType>(
      aircraftTypes.map((t: any) => [t.id, (t.bodyType ?? null) as BodyType])
    );
    const selectedLayouts = selectedLayoutIds.size
      ? layouts
      : Array.from(new Map(layouts.map((l: any) => [l.hangarId, l])).values());
    const periodMs = Math.max(1, query.to.getTime() - query.from.getTime());
    const summaryEvents: SummaryEvent[] = events.map((e: any) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      aircraftLabel: aircraftLabel(e),
      bodyType: eventBodyType(e, bodyTypeByAircraftTypeId),
      eventTypeName: e.eventType?.name ?? null,
      startAt: e.startAt,
      endAt: e.endAt,
      reservation: e.reservation ? { layoutId: e.reservation.layoutId, standId: e.reservation.standId } : null
    }));

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
      const layoutEvents = summaryEvents.filter((e) => e.reservation?.layoutId === layout.id);
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
        utilizationPct: stands.length ? Math.min(100, (occupiedMsTotal / (stands.length * periodMs)) * 100) : 0,
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
          status: { not: EventStatus.CANCELLED },
          startAt: { lt: body.to },
          endAt: { gt: body.from }
        },
        include: { aircraft: { include: { type: true } }, eventType: true, reservation: true },
        orderBy: [{ startAt: "asc" }]
      }),
      app.prisma.aircraftType.findMany({ select: { id: true, bodyType: true } }),
      app.prisma.standReservation.findMany({
        where: {
          ...sandboxFilter(req as any),
          layoutId: { in: body.layouts.map((l) => l.layoutId) },
          startAt: { lt: body.to },
          endAt: { gt: body.from },
          event: { status: { not: EventStatus.CANCELLED } }
        }
      })
    ]);

    const bodyTypeByAircraftTypeId = new Map<string, BodyType>(
      aircraftTypes.map((t: any) => [t.id, (t.bodyType ?? null) as BodyType])
    );
    const busyByStand = new Map<string, Array<{ startAt: Date; endAt: Date }>>();
    for (const r of reservations as any[]) {
      const arr = busyByStand.get(r.standId) ?? [];
      arr.push({ startAt: r.startAt, endAt: r.endAt });
      busyByStand.set(r.standId, arr);
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
      .filter((e: any) => !e.reservation || !body.layouts.some((l) => l.layoutId === e.reservation?.layoutId))
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
