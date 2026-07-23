import { EventAuditAction, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

export type CopyRange = { from?: Date; to?: Date };

export type CopyPlanResult = {
  events: number;
  reservations: number;
  tows: number;
  planLines: number;
  actualLines: number;
  timeEntries: number;
  materialReservations: number;
  materialIssues: number;
  stockMovements: number;
  auditLines: number;
  skippedDuplicates: number;
};

type SourceEvent = {
  id: string;
  sandboxId: string | null;
  level: any;
  status: any;
  planningKind?: any;
  title: string;
  aircraftId: string | null;
  eventTypeId: string;
  virtualAircraft: Prisma.JsonValue | null;
  startAt: Date;
  endAt: Date;
  budgetStartAt?: Date | null;
  budgetEndAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  hangarId: string | null;
  layoutId: string | null;
  workshopId?: string | null;
  notes: string | null;
  originEventId?: string | null;
  sourceEventId?: string | null;
  sourceSandboxId?: string | null;
  updatedAt?: Date;
};

/** Корень lineage: origin из источника, либо сам id если событие из prod. */
export function resolveOriginEventId(src: {
  id: string;
  sandboxId: string | null;
  originEventId?: string | null;
}): string | null {
  if (src.originEventId) return src.originEventId;
  if (src.sandboxId == null) return src.id;
  return null;
}

function eventFingerprint(ev: {
  aircraftId: string | null;
  virtualAircraft: unknown;
  eventTypeId: string;
  startAt: Date;
  endAt: Date;
}): string {
  const virtualLabel =
    ev.aircraftId == null && ev.virtualAircraft && typeof ev.virtualAircraft === "object"
      ? String((ev.virtualAircraft as any).label ?? "")
      : "";
  return [
    ev.aircraftId ?? `v:${virtualLabel}`,
    ev.eventTypeId,
    ev.startAt.toISOString(),
    ev.endAt.toISOString()
  ].join("|");
}

/**
 * Копирует записи плана из исходного контекста (sourceSandboxId = null для прода) в целевой sandbox.
 * Работает в транзакции. Опциональный диапазон ограничивает копирование событий по [startAt, endAt).
 * Связанные строки (резерв, буксировки, работа, материалы, стоки, аудит) копируются ТОЛЬКО для скопированных событий.
 *
 * Используем createMany, чтобы не упираться в interactive transaction timeout при больших планах.
 */
export async function copyPlanToSandbox(
  tx: Prisma.TransactionClient,
  params: {
    sourceSandboxId: string | null;
    targetSandboxId: string;
    range?: CopyRange;
    actor: string;
    /** Если задано — копируются только эти события (должны принадлежать sourceSandboxId). */
    eventIds?: string[];
    /**
     * Пропускать дубликаты по originEventId (и fingerprint, если origin нет).
     * Учитывает уже существующие события в target и события, добавленные ранее в этой же операции.
     */
    skipDuplicates?: boolean;
    /** Уже занятые origin/fingerprint в target (для merge нескольких источников). */
    occupiedOrigins?: Set<string>;
    occupiedFingerprints?: Set<string>;
  }
): Promise<CopyPlanResult> {
  const {
    sourceSandboxId,
    targetSandboxId,
    range,
    actor,
    eventIds,
    skipDuplicates = false,
    occupiedOrigins,
    occupiedFingerprints
  } = params;

  const where: Prisma.MaintenanceEventWhereInput = { sandboxId: sourceSandboxId };
  if (eventIds?.length) where.id = { in: eventIds };
  if (range?.from || range?.to) {
    if (range.from) where.endAt = { gt: range.from };
    if (range.to) where.startAt = { lt: range.to };
  }

  const sourceEvents = (await tx.maintenanceEvent.findMany({ where })) as SourceEvent[];

  const counts: CopyPlanResult = {
    events: 0,
    reservations: 0,
    tows: 0,
    planLines: 0,
    actualLines: 0,
    timeEntries: 0,
    materialReservations: 0,
    materialIssues: 0,
    stockMovements: 0,
    auditLines: 0,
    skippedDuplicates: 0
  };
  if (sourceEvents.length === 0) return counts;

  const originSet = occupiedOrigins ?? new Set<string>();
  const fingerprintSet = occupiedFingerprints ?? new Set<string>();

  if (skipDuplicates && (!occupiedOrigins || !occupiedFingerprints)) {
    const existing = await tx.maintenanceEvent.findMany({
      where: { sandboxId: targetSandboxId },
      select: {
        id: true,
        originEventId: true,
        aircraftId: true,
        virtualAircraft: true,
        eventTypeId: true,
        startAt: true,
        endAt: true
      }
    });
    for (const e of existing) {
      if (e.originEventId) originSet.add(e.originEventId);
      fingerprintSet.add(eventFingerprint(e));
    }
  }

  // При дублях по origin оставляем более свежий источник
  const sorted = skipDuplicates
    ? [...sourceEvents].sort((a, b) => (b.updatedAt?.valueOf() ?? 0) - (a.updatedAt?.valueOf() ?? 0))
    : sourceEvents;

  const selected: SourceEvent[] = [];
  for (const src of sorted) {
    if (!skipDuplicates) {
      selected.push(src);
      continue;
    }
    const origin = resolveOriginEventId(src);
    const fp = eventFingerprint(src);
    if (origin && originSet.has(origin)) {
      counts.skippedDuplicates += 1;
      continue;
    }
    if (!origin && fingerprintSet.has(fp)) {
      counts.skippedDuplicates += 1;
      continue;
    }
    selected.push(src);
    if (origin) originSet.add(origin);
    fingerprintSet.add(fp);
  }

  if (selected.length === 0) return counts;

  const eventIdMap = new Map<string, string>();
  for (const src of selected) eventIdMap.set(src.id, randomUUID());

  const eventRows = selected.map((src) => {
    const originEventId = resolveOriginEventId(src);
    return {
      id: eventIdMap.get(src.id)!,
      sandboxId: targetSandboxId,
      level: src.level,
      status: src.status,
      planningKind:
        (src as any).planningKind ??
        ((src as any).budgetStartAt && (src as any).budgetEndAt ? "PLANNED" : "UNPLANNED"),
      title: src.title,
      aircraftId: src.aircraftId,
      eventTypeId: src.eventTypeId,
      virtualAircraft: (src.virtualAircraft as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
      startAt: src.startAt,
      endAt: src.endAt,
      budgetStartAt: (src as any).budgetStartAt,
      budgetEndAt: (src as any).budgetEndAt,
      actualStartAt: (src as any).actualStartAt,
      actualEndAt: (src as any).actualEndAt,
      hangarId: src.hangarId,
      layoutId: src.layoutId,
      workshopId: (src as any).workshopId ?? null,
      notes: src.notes,
      originEventId,
      sourceEventId: src.id,
      sourceSandboxId
    };
  });
  const evCreated = await tx.maintenanceEvent.createMany({ data: eventRows });
  counts.events = evCreated.count;

  const auditRows = selected.map((src) => ({
    eventId: eventIdMap.get(src.id)!,
    sandboxId: targetSandboxId,
    action: EventAuditAction.CREATE,
    actor,
    reason: sourceSandboxId ? "Импорт из песочницы" : "Копия плана",
    changes: {
      copiedFrom: {
        sourceEventId: src.id,
        sourceSandboxId,
        originEventId: resolveOriginEventId(src)
      }
    } as Prisma.InputJsonValue
  }));
  const auCreated = await tx.maintenanceEventAudit.createMany({ data: auditRows });
  counts.auditLines = auCreated.count;

  const sourceEventIds = Array.from(eventIdMap.keys());

  const placementIdMap = new Map<string, string>();
  const placements = await tx.eventPlacement.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (placements.length) {
    for (const p of placements) placementIdMap.set(p.id, randomUUID());
    await tx.eventPlacement.createMany({
      data: placements.map((p) => ({
        id: placementIdMap.get(p.id)!,
        eventId: eventIdMap.get(p.eventId)!,
        sandboxId: targetSandboxId,
        startAt: p.startAt,
        endAt: p.endAt,
        budgetStartAt: p.budgetStartAt,
        budgetEndAt: p.budgetEndAt,
        actualStartAt: p.actualStartAt,
        actualEndAt: p.actualEndAt,
        hangarId: p.hangarId,
        layoutId: p.layoutId,
        standId: p.standId,
        sortOrder: p.sortOrder
      }))
    });
  }

  const reservations = await tx.standReservation.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (reservations.length) {
    const resCreated = await tx.standReservation.createMany({
      data: reservations.map((r) => ({
        eventId: eventIdMap.get(r.eventId)!,
        placementId: r.placementId ? (placementIdMap.get(r.placementId) ?? null) : null,
        sandboxId: targetSandboxId,
        layoutId: r.layoutId,
        standId: r.standId,
        startAt: r.startAt,
        endAt: r.endAt
      }))
    });
    counts.reservations = resCreated.count;
  }

  const tows = await tx.eventTow.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (tows.length) {
    const towCreated = await tx.eventTow.createMany({
      data: tows.map((t) => ({
        eventId: eventIdMap.get(t.eventId)!,
        sandboxId: targetSandboxId,
        startAt: t.startAt,
        endAt: t.endAt
      }))
    });
    counts.tows = towCreated.count;
  }

  const planLines = await tx.eventWorkPlanLine.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (planLines.length) {
    const pLCreated = await tx.eventWorkPlanLine.createMany({
      data: planLines.map((p) => ({
        eventId: eventIdMap.get(p.eventId)!,
        sandboxId: targetSandboxId,
        date: p.date,
        shiftId: p.shiftId,
        skillId: p.skillId,
        plannedHeadcount: p.plannedHeadcount,
        plannedMinutes: p.plannedMinutes,
        notes: p.notes
      }))
    });
    counts.planLines = pLCreated.count;
  }

  const actualLines = await tx.eventWorkActualLine.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (actualLines.length) {
    const aLCreated = await tx.eventWorkActualLine.createMany({
      data: actualLines.map((a) => ({
        eventId: eventIdMap.get(a.eventId)!,
        sandboxId: targetSandboxId,
        date: a.date,
        shiftId: a.shiftId,
        skillId: a.skillId,
        actualHeadcount: a.actualHeadcount,
        notes: a.notes
      }))
    });
    counts.actualLines = aLCreated.count;
  }

  const timeEntries = await tx.timeEntry.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (timeEntries.length) {
    const teCreated = await tx.timeEntry.createMany({
      data: timeEntries.map((te) => ({
        eventId: eventIdMap.get(te.eventId)!,
        sandboxId: targetSandboxId,
        personId: te.personId,
        skillId: te.skillId,
        shiftId: te.shiftId,
        startAt: te.startAt,
        endAt: te.endAt,
        minutes: te.minutes,
        notes: te.notes
      }))
    });
    counts.timeEntries = teCreated.count;
  }

  const materialReservations = await tx.materialReservation.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (materialReservations.length) {
    const mrCreated = await tx.materialReservation.createMany({
      data: materialReservations.map((m) => ({
        eventId: eventIdMap.get(m.eventId)!,
        sandboxId: targetSandboxId,
        materialId: m.materialId,
        warehouseId: m.warehouseId,
        qtyReserved: m.qtyReserved,
        needByDate: m.needByDate,
        notes: m.notes
      }))
    });
    counts.materialReservations = mrCreated.count;
  }

  const materialIssues = await tx.materialIssue.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (materialIssues.length) {
    const miCreated = await tx.materialIssue.createMany({
      data: materialIssues.map((m) => ({
        eventId: eventIdMap.get(m.eventId)!,
        sandboxId: targetSandboxId,
        materialId: m.materialId,
        warehouseId: m.warehouseId,
        qtyIssued: m.qtyIssued,
        issuedAt: m.issuedAt,
        notes: m.notes
      }))
    });
    counts.materialIssues = miCreated.count;
  }

  const stockMovements = await tx.stockMovement.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (stockMovements.length) {
    const smCreated = await tx.stockMovement.createMany({
      data: stockMovements.map((s) => ({
        eventId: s.eventId ? eventIdMap.get(s.eventId) ?? null : null,
        sandboxId: targetSandboxId,
        materialId: s.materialId,
        warehouseId: s.warehouseId,
        type: s.type,
        qty: s.qty,
        notes: s.notes
      }))
    });
    counts.stockMovements = smCreated.count;
  }

  return counts;
}

export { eventFingerprint };
