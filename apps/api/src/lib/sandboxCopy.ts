import { EventAuditAction, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

export type CopyRange = { from?: Date; to?: Date };

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
  }
): Promise<{
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
}> {
  const { sourceSandboxId, targetSandboxId, range, actor } = params;

  const where: Prisma.MaintenanceEventWhereInput = { sandboxId: sourceSandboxId };
  if (range?.from || range?.to) {
    if (range.from) where.endAt = { gt: range.from };
    if (range.to) where.startAt = { lt: range.to };
  }

  const sourceEvents = await tx.maintenanceEvent.findMany({ where });

  const counts = {
    events: 0,
    reservations: 0,
    tows: 0,
    planLines: 0,
    actualLines: 0,
    timeEntries: 0,
    materialReservations: 0,
    materialIssues: 0,
    stockMovements: 0,
    auditLines: 0
  };
  if (sourceEvents.length === 0) return counts;

  const eventIdMap = new Map<string, string>();
  for (const src of sourceEvents) eventIdMap.set(src.id, randomUUID());

  const eventRows = sourceEvents.map((src) => ({
    id: eventIdMap.get(src.id)!,
    sandboxId: targetSandboxId,
    level: src.level,
    status: src.status,
    title: src.title,
    aircraftId: src.aircraftId,
    eventTypeId: src.eventTypeId,
    virtualAircraft: (src.virtualAircraft as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
    startAt: src.startAt,
    endAt: src.endAt,
    hangarId: src.hangarId,
    layoutId: src.layoutId,
    notes: src.notes
  }));
  const evCreated = await tx.maintenanceEvent.createMany({ data: eventRows });
  counts.events = evCreated.count;

  const auditRows = sourceEvents.map((src) => ({
    eventId: eventIdMap.get(src.id)!,
    sandboxId: targetSandboxId,
    action: EventAuditAction.CREATE,
    actor,
    reason: sourceSandboxId ? "Импорт из песочницы" : "Копия плана",
    changes: {
      copiedFrom: {
        sourceEventId: src.id,
        sourceSandboxId
      }
    } as Prisma.InputJsonValue
  }));
  const auCreated = await tx.maintenanceEventAudit.createMany({ data: auditRows });
  counts.auditLines = auCreated.count;

  const sourceEventIds = Array.from(eventIdMap.keys());

  // Резервы: 1:1 с событием (eventId уникален)
  const reservations = await tx.standReservation.findMany({
    where: { eventId: { in: sourceEventIds }, sandboxId: sourceSandboxId }
  });
  if (reservations.length) {
    const resCreated = await tx.standReservation.createMany({
      data: reservations.map((r) => ({
        eventId: eventIdMap.get(r.eventId)!,
        sandboxId: targetSandboxId,
        layoutId: r.layoutId,
        standId: r.standId,
        startAt: r.startAt,
        endAt: r.endAt
      }))
    });
    counts.reservations = resCreated.count;
  }

  // Буксировки
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

  // Work plan lines
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

  // Work actual lines
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

  // Time entries
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

  // Material reservations
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

  // Material issues
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

  // Stock movements
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
