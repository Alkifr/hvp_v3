import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();
const inPath = path.resolve(process.cwd(), "prisma/ref-data.json");

const DATE_KEYS = new Set(["createdAt", "updatedAt", "manufactureDate"]);

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DATE_KEYS.has(k) && typeof v === "string") {
        out[k] = new Date(v);
      } else {
        out[k] = revive(v);
      }
    }
    return out;
  }
  return value;
}

async function copyMany(label: string, rows: unknown[], write: (chunk: any[]) => Promise<unknown>) {
  const list = (rows ?? []) as any[];
  console.log(`${label}: ${list.length}`);
  const chunk = 200;
  for (let i = 0; i < list.length; i += chunk) {
    await write(list.slice(i, i + chunk));
  }
}

async function main() {
  const raw = JSON.parse(await fs.readFile(inPath, "utf8"));
  const data = revive(raw) as Record<string, any>;

  if (data.source !== "cloud-ref-only") {
    throw new Error(`${inPath} не похож на выгрузку справочников (source=${data.source})`);
  }

  await prisma.$executeRawUnsafe(`
TRUNCATE TABLE
  "HangarStandAircraftType",
  "PlacementPriorityRuleEventType",
  "PlacementPriorityRuleAircraftType",
  "PlacementPriorityRule",
  "OptimizationScoreRule",
  "AircraftTypePalette",
  "PersonSkill",
  "PersonUnavailability",
  "Aircraft",
  "HangarStand",
  "HangarLayout",
  "Hangar",
  "Operator",
  "AircraftType",
  "EventType",
  "Workshop",
  "Shift",
  "Skill",
  "Person",
  "Warehouse",
  "Material",
  "OptimizationProfile",
  "EventStatusCatalog"
CASCADE`);

  await copyMany("operators", data.operators, (d) => prisma.operator.createMany({ data: d }));
  await copyMany("aircraftTypes", data.aircraftTypes, (d) => prisma.aircraftType.createMany({ data: d }));
  await copyMany("eventTypes", data.eventTypes, (d) => prisma.eventType.createMany({ data: d }));
  await copyMany("eventStatusCatalog", data.eventStatusCatalog, (d) =>
    prisma.eventStatusCatalog.createMany({ data: d })
  );
  await copyMany("workshops", data.workshops, (d) => prisma.workshop.createMany({ data: d }));
  await copyMany("hangars", data.hangars, (d) => prisma.hangar.createMany({ data: d }));
  await copyMany("layouts", data.layouts, (d) => prisma.hangarLayout.createMany({ data: d }));
  await copyMany("stands", data.stands, (d) => prisma.hangarStand.createMany({ data: d }));
  await copyMany("hangarStandAircraftTypes", data.hangarStandAircraftTypes, (d) =>
    prisma.hangarStandAircraftType.createMany({ data: d })
  );
  await copyMany("palettes", data.palettes, (d) => prisma.aircraftTypePalette.createMany({ data: d }));
  await copyMany("aircraft", data.aircraft, (d) => prisma.aircraft.createMany({ data: d }));
  await copyMany("shifts", data.shifts, (d) => prisma.shift.createMany({ data: d }));
  await copyMany("skills", data.skills, (d) => prisma.skill.createMany({ data: d }));
  await copyMany("persons", data.persons, (d) => prisma.person.createMany({ data: d }));
  await copyMany("personSkills", data.personSkills, (d) => prisma.personSkill.createMany({ data: d }));
  await copyMany("warehouses", data.warehouses, (d) => prisma.warehouse.createMany({ data: d }));
  await copyMany("materials", data.materials, (d) => prisma.material.createMany({ data: d }));
  await copyMany("optimizationProfiles", data.optimizationProfiles, (d) =>
    prisma.optimizationProfile.createMany({ data: d })
  );
  await copyMany("optimizationScoreRules", data.optimizationScoreRules, (d) =>
    prisma.optimizationScoreRule.createMany({ data: d })
  );
  await copyMany("placementPriorityRules", data.placementPriorityRules, (d) =>
    prisma.placementPriorityRule.createMany({ data: d })
  );
  await copyMany("placementPriorityRuleEventTypes", data.placementPriorityRuleEventTypes, (d) =>
    prisma.placementPriorityRuleEventType.createMany({ data: d })
  );
  await copyMany("placementPriorityRuleAircraftTypes", data.placementPriorityRuleAircraftTypes, (d) =>
    prisma.placementPriorityRuleAircraftType.createMany({ data: d })
  );

  console.log(`Imported reference data from ${inPath}`);
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
