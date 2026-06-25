import { EventStatus, PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();
const TARGET_HANGAR_CODES = ["H1", "H2", "H3", "H4", "H5"];

type ImportedLayout = Awaited<ReturnType<typeof loadImportedLayouts>>[number];
type ImportedStand = ImportedLayout["stands"][number];

function aircraftTypeIdForEvent(event: any): string | null {
  return event.aircraft?.typeId ?? event.virtualAircraft?.aircraftTypeId ?? null;
}

function aircraftTypeLabelForEvent(event: any): string {
  return event.aircraft?.type?.icaoType ?? event.virtualAircraft?.aircraftTypeId ?? "NO_TYPE";
}

function standAccepts(stand: ImportedStand, aircraftTypeId: string | null): boolean {
  const allowed = stand.allowedAircraftTypes.map((rule) => rule.aircraftTypeId);
  return allowed.length === 0 || !aircraftTypeId || allowed.includes(aircraftTypeId);
}

async function loadImportedLayouts() {
  return await prisma.hangarLayout.findMany({
    where: {
      isActive: true,
      code: { startsWith: "SCHEME_" },
      hangar: { code: { in: TARGET_HANGAR_CODES } }
    },
    include: {
      hangar: true,
      stands: {
        where: { isActive: true },
        include: { allowedAircraftTypes: true },
        orderBy: { code: "asc" }
      }
    },
    orderBy: [{ hangar: { code: "asc" } }, { code: "asc" }]
  });
}

function findCandidate(params: {
  layouts: ImportedLayout[];
  aircraftTypeId: string | null;
  currentStandCode: string;
}) {
  const sameStand: Array<{ layout: ImportedLayout; stand: ImportedStand }> = [];
  const otherStand: Array<{ layout: ImportedLayout; stand: ImportedStand }> = [];

  for (const layout of params.layouts) {
    for (const stand of layout.stands) {
      if (!standAccepts(stand, params.aircraftTypeId)) continue;
      if (stand.code === params.currentStandCode) sameStand.push({ layout, stand });
      else otherStand.push({ layout, stand });
    }
  }

  return sameStand[0] ?? otherStand[0] ?? null;
}

async function main() {
  const importedLayouts = await loadImportedLayouts();
  const layoutsByHangarId = new Map<string, ImportedLayout[]>();
  for (const layout of importedLayouts) {
    const layouts = layoutsByHangarId.get(layout.hangarId) ?? [];
    layouts.push(layout);
    layoutsByHangarId.set(layout.hangarId, layouts);
  }

  const reservations = await prisma.standReservation.findMany({
    where: {
      layout: {
        hangar: { code: { in: TARGET_HANGAR_CODES } },
        code: { not: { startsWith: "SCHEME_" } }
      },
      event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
    },
    include: {
      event: { include: { aircraft: { include: { type: true } } } },
      layout: { include: { hangar: true } },
      stand: true
    },
    orderBy: [{ startAt: "asc" }, { id: "asc" }]
  });

  const skipped = new Map<string, number>();
  const summary = { scanned: reservations.length, updated: 0, sameStand: 0, otherStand: 0, skipped: 0 };

  for (const reservation of reservations) {
    const layouts = layoutsByHangarId.get(reservation.layout.hangarId) ?? [];
    const aircraftTypeId = aircraftTypeIdForEvent(reservation.event);
    const candidate = findCandidate({
      layouts,
      aircraftTypeId,
      currentStandCode: reservation.stand.code
    });

    if (!candidate) {
      summary.skipped += 1;
      const key = `${reservation.layout.hangar.code}|${aircraftTypeLabelForEvent(reservation.event)}|${reservation.stand.code}`;
      skipped.set(key, (skipped.get(key) ?? 0) + 1);
      continue;
    }

    await prisma.standReservation.update({
      where: { id: reservation.id },
      data: { layoutId: candidate.layout.id, standId: candidate.stand.id }
    });

    if (reservation.placementId) {
      await prisma.eventPlacement.update({
        where: { id: reservation.placementId },
        data: {
          hangarId: candidate.layout.hangarId,
          layoutId: candidate.layout.id,
          standId: candidate.stand.id
        }
      });
    }

    await prisma.maintenanceEvent.update({
      where: { id: reservation.eventId },
      data: {
        hangarId: candidate.layout.hangarId,
        layoutId: candidate.layout.id
      }
    });

    summary.updated += 1;
    if (candidate.stand.code === reservation.stand.code) summary.sameStand += 1;
    else summary.otherStand += 1;
  }

  const bodyTypeOnlyLayouts = await prisma.hangarLayout.findMany({
    where: {
      isActive: true,
      stands: { some: { isActive: true, bodyType: { not: null }, allowedAircraftTypes: { none: {} } } }
    },
    include: {
      hangar: { select: { code: true } },
      reservations: {
        where: { event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } } },
        select: { id: true },
        take: 1
      }
    }
  });

  let deactivatedLayouts = 0;
  const keptActiveLayouts: string[] = [];
  for (const layout of bodyTypeOnlyLayouts) {
    const hasImportedReplacement = importedLayouts.some((candidate) => candidate.hangarId === layout.hangarId);
    const hasActiveReservations = layout.reservations.length > 0;
    if (hasImportedReplacement && !hasActiveReservations) {
      await prisma.hangarLayout.update({ where: { id: layout.id }, data: { isActive: false } });
      deactivatedLayouts += 1;
    } else {
      keptActiveLayouts.push(`${layout.hangar.code}/${layout.code}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        deactivatedBodyTypeOnlyLayouts: deactivatedLayouts,
        keptActiveBodyTypeOnlyLayouts: keptActiveLayouts,
        skipped: Array.from(skipped.entries()).sort((a, b) => b[1] - a[1])
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
