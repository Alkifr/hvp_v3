import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();

const outPath = path.resolve(process.cwd(), "prisma/ref-data.json");

async function main() {
  const data = {
    exportedAt: new Date().toISOString(),
    source: "cloud-ref-only",
    operators: await prisma.operator.findMany({ orderBy: [{ code: "asc" }] }),
    aircraftTypes: await prisma.aircraftType.findMany({ orderBy: [{ name: "asc" }] }),
    eventTypes: await prisma.eventType.findMany({ orderBy: [{ code: "asc" }] }),
    eventStatusCatalog: await prisma.eventStatusCatalog.findMany({ orderBy: [{ sortOrder: "asc" }] }),
    workshops: await prisma.workshop.findMany({ orderBy: [{ code: "asc" }] }),
    hangars: await prisma.hangar.findMany({ orderBy: [{ code: "asc" }] }),
    layouts: await prisma.hangarLayout.findMany({ orderBy: [{ hangarId: "asc" }, { code: "asc" }] }),
    stands: await prisma.hangarStand.findMany({ orderBy: [{ layoutId: "asc" }, { code: "asc" }] }),
    hangarStandAircraftTypes: await prisma.hangarStandAircraftType.findMany({
      orderBy: [{ standId: "asc" }, { aircraftTypeId: "asc" }]
    }),
    palettes: await prisma.aircraftTypePalette.findMany({
      orderBy: [{ operatorId: "asc" }, { aircraftTypeId: "asc" }]
    }),
    aircraft: await prisma.aircraft.findMany({ orderBy: [{ tailNumber: "asc" }] }),
    shifts: await prisma.shift.findMany({ orderBy: [{ code: "asc" }] }),
    skills: await prisma.skill.findMany({ orderBy: [{ code: "asc" }] }),
    persons: await prisma.person.findMany({ orderBy: [{ name: "asc" }] }),
    personSkills: await prisma.personSkill.findMany({ orderBy: [{ personId: "asc" }, { skillId: "asc" }] }),
    warehouses: await prisma.warehouse.findMany({ orderBy: [{ code: "asc" }] }),
    materials: await prisma.material.findMany({ orderBy: [{ code: "asc" }] }),
    optimizationProfiles: await prisma.optimizationProfile.findMany({ orderBy: [{ code: "asc" }] }),
    optimizationScoreRules: await prisma.optimizationScoreRule.findMany({
      orderBy: [{ profileId: "asc" }, { code: "asc" }]
    }),
    placementPriorityRules: await prisma.placementPriorityRule.findMany({ orderBy: [{ createdAt: "asc" }] }),
    placementPriorityRuleEventTypes: await prisma.placementPriorityRuleEventType.findMany({
      orderBy: [{ ruleId: "asc" }, { eventTypeId: "asc" }]
    }),
    placementPriorityRuleAircraftTypes: await prisma.placementPriorityRuleAircraftType.findMany({
      orderBy: [{ ruleId: "asc" }, { aircraftTypeId: "asc" }]
    })
  };

  await fs.writeFile(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");

  const counts = Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => [k, (v as unknown[]).length])
  );
  console.log(`Reference data exported to ${outPath}`);
  console.table(counts);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
