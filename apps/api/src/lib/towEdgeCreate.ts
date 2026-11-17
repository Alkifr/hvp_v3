import type { Prisma, PrismaClient } from "@prisma/client";

import { plannedEdgeCreates, towChangeRows, type RegistryEdgeRole } from "./towRegistry.js";
import { EDGE_TOW_NORM_CODE } from "./edgeTows.js";

type TowWriter = Prisma.TransactionClient | PrismaClient;

export async function createAutomaticEdgeTows(
  tx: TowWriter,
  params: { eventId: string; sandboxId: string | null }
): Promise<number> {
  const norm = await tx.towNorm.findUnique({ where: { code: EDGE_TOW_NORM_CODE } });
  if (!norm || !norm.isActive || norm.minutes < 1) return 0;
  const [placements, existing, waivers] = await Promise.all([
    tx.eventPlacement.findMany({
      where: { eventId: params.eventId },
      include: { stand: true },
      orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }]
    }),
    tx.eventTow.findMany({
      where: { eventId: params.eventId },
      select: { startAt: true, endAt: true }
    }),
    tx.eventTowWaiver.findMany({
      where: { eventId: params.eventId },
      select: { role: true }
    })
  ]);
  const waivedRoles = waivers
    .map((waiver) => waiver.role)
    .filter((role): role is RegistryEdgeRole => role === "event-in" || role === "event-out");
  const creates = plannedEdgeCreates({
    minutes: norm.minutes,
    placements: placements.map((placement) => ({
      id: placement.id,
      origin: placement.origin === "AUTO_GAP" ? "AUTO_GAP" : "MANUAL",
      startAt: placement.startAt,
      endAt: placement.endAt,
      standCode: placement.stand?.code || placement.stand?.name || null
    })),
    existing,
    waivedRoles
  });
  for (const tow of creates) {
    await tx.eventTow.create({
      data: {
        eventId: params.eventId,
        sandboxId: params.sandboxId,
        startAt: tow.startAt,
        endAt: tow.endAt,
        placementId: tow.placementId,
        fromLabel: tow.fromLabel || null,
        toLabel: tow.toLabel || null
      }
    });
  }
  return creates.length;
}

export async function recordTowFieldChanges(
  prisma: TowWriter,
  rows: ReturnType<typeof towChangeRows>
): Promise<void> {
  if (!rows.length) return;
  await prisma.towFieldChange.createMany({ data: rows });
}
