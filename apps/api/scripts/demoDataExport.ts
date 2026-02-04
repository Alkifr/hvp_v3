import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

// Важно: .env лежит в корне репо, а скрипт запускается из apps/api
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();

async function main() {
  const outPath = path.resolve(process.cwd(), "prisma/demo-data.json");

  const data = {
    // справочники / планирование
    operators: await prisma.operator.findMany({ orderBy: [{ code: "asc" }] }),
    aircraftTypes: await prisma.aircraftType.findMany({ orderBy: [{ name: "asc" }] }),
    aircraft: await prisma.aircraft.findMany({ orderBy: [{ tailNumber: "asc" }] }),
    eventTypes: await prisma.eventType.findMany({ orderBy: [{ code: "asc" }] }),
    hangars: await prisma.hangar.findMany({ orderBy: [{ code: "asc" }] }),
    layouts: await prisma.hangarLayout.findMany({ orderBy: [{ hangarId: "asc" }, { code: "asc" }] }),
    stands: await prisma.hangarStand.findMany({ orderBy: [{ layoutId: "asc" }, { code: "asc" }] }),
    palettes: await prisma.aircraftTypePalette.findMany({ orderBy: [{ operatorId: "asc" }, { aircraftTypeId: "asc" }] }),

    events: await prisma.maintenanceEvent.findMany({ orderBy: [{ startAt: "asc" }] }),
    reservations: await prisma.standReservation.findMany({ orderBy: [{ standId: "asc" }, { startAt: "asc" }] }),
    tows: await prisma.eventTow.findMany({ orderBy: [{ eventId: "asc" }, { startAt: "asc" }] }),
    audits: await prisma.maintenanceEventAudit.findMany({ orderBy: [{ eventId: "asc" }, { createdAt: "asc" }] }),

    // ресурсы / персонал / материалы (MVP)
    shifts: await prisma.shift.findMany({ orderBy: [{ code: "asc" }] }),
    skills: await prisma.skill.findMany({ orderBy: [{ code: "asc" }] }),
    persons: await prisma.person.findMany({ orderBy: [{ code: "asc" }] }),
    personSkills: await prisma.personSkill.findMany({ orderBy: [{ personId: "asc" }, { skillId: "asc" }] }),
    personUnavailability: await prisma.personUnavailability.findMany({ orderBy: [{ personId: "asc" }, { startAt: "asc" }] }),

    workPlanLines: await prisma.eventWorkPlanLine.findMany({ orderBy: [{ eventId: "asc" }, { date: "asc" }] }),
    workActualLines: await prisma.eventWorkActualLine.findMany({ orderBy: [{ eventId: "asc" }, { date: "asc" }] }),
    timeEntries: await prisma.timeEntry.findMany({ orderBy: [{ eventId: "asc" }, { startAt: "asc" }] }),

    warehouses: await prisma.warehouse.findMany({ orderBy: [{ code: "asc" }] }),
    materials: await prisma.material.findMany({ orderBy: [{ code: "asc" }] }),
    stockMovements: await prisma.stockMovement.findMany({ orderBy: [{ createdAt: "asc" }] }),
    materialReservations: await prisma.materialReservation.findMany({ orderBy: [{ needByDate: "asc" }] }),
    materialIssues: await prisma.materialIssue.findMany({ orderBy: [{ issuedAt: "asc" }] })
  };

  await fs.writeFile(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");

  // eslint-disable-next-line no-console
  console.log(`Demo data exported to ${outPath}`);
  // eslint-disable-next-line no-console
  console.table({
    operators: data.operators.length,
    aircraftTypes: data.aircraftTypes.length,
    aircraft: data.aircraft.length,
    eventTypes: data.eventTypes.length,
    hangars: data.hangars.length,
    layouts: data.layouts.length,
    stands: data.stands.length,
    palettes: data.palettes.length,
    events: data.events.length,
    reservations: data.reservations.length,
    tows: data.tows.length,
    audits: data.audits.length,
    shifts: data.shifts.length,
    skills: data.skills.length,
    persons: data.persons.length,
    personSkills: data.personSkills.length,
    personUnavailability: data.personUnavailability.length,
    workPlanLines: data.workPlanLines.length,
    workActualLines: data.workActualLines.length,
    timeEntries: data.timeEntries.length,
    warehouses: data.warehouses.length,
    materials: data.materials.length,
    stockMovements: data.stockMovements.length,
    materialReservations: data.materialReservations.length,
    materialIssues: data.materialIssues.length
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

