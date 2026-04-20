import { Prisma, PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const localUrl = (process.env.DATABASE_URL ?? "").trim();
const cloudUrl = (process.env.DATABASE_CLOUD_URL ?? "").trim();

if (!localUrl) {
  throw new Error("DATABASE_URL не задан. Он нужен как источник локальной БД.");
}
if (!cloudUrl) {
  throw new Error("DATABASE_CLOUD_URL не задан. Он нужен как приёмник облачной БД.");
}

const local = new PrismaClient({ datasources: { db: { url: localUrl } } });
const cloud = new PrismaClient({ datasources: { db: { url: cloudUrl } } });

const COPY_ORDER = [
  ["Permission", () => local.permission.findMany(), (rows: any[]) => cloud.permission.createMany({ data: rows })],
  ["Role", () => local.role.findMany(), (rows: any[]) => cloud.role.createMany({ data: rows })],
  ["User", () => local.user.findMany(), (rows: any[]) => cloud.user.createMany({ data: rows })],
  ["RolePermission", () => local.rolePermission.findMany(), (rows: any[]) => cloud.rolePermission.createMany({ data: rows })],
  ["UserRole", () => local.userRole.findMany(), (rows: any[]) => cloud.userRole.createMany({ data: rows })],
  ["Operator", () => local.operator.findMany(), (rows: any[]) => cloud.operator.createMany({ data: rows })],
  ["AircraftType", () => local.aircraftType.findMany(), (rows: any[]) => cloud.aircraftType.createMany({ data: rows })],
  ["EventType", () => local.eventType.findMany(), (rows: any[]) => cloud.eventType.createMany({ data: rows })],
  ["Hangar", () => local.hangar.findMany(), (rows: any[]) => cloud.hangar.createMany({ data: rows })],
  ["HangarLayout", () => local.hangarLayout.findMany(), (rows: any[]) => cloud.hangarLayout.createMany({ data: rows })],
  ["HangarStand", () => local.hangarStand.findMany(), (rows: any[]) => cloud.hangarStand.createMany({ data: rows })],
  ["AircraftTypePalette", () => local.aircraftTypePalette.findMany(), (rows: any[]) => cloud.aircraftTypePalette.createMany({ data: rows })],
  ["Aircraft", () => local.aircraft.findMany(), (rows: any[]) => cloud.aircraft.createMany({ data: rows })],
  ["Shift", () => local.shift.findMany(), (rows: any[]) => cloud.shift.createMany({ data: rows })],
  ["Skill", () => local.skill.findMany(), (rows: any[]) => cloud.skill.createMany({ data: rows })],
  ["Person", () => local.person.findMany(), (rows: any[]) => cloud.person.createMany({ data: rows })],
  ["PersonSkill", () => local.personSkill.findMany(), (rows: any[]) => cloud.personSkill.createMany({ data: rows })],
  ["PersonUnavailability", () => local.personUnavailability.findMany(), (rows: any[]) => cloud.personUnavailability.createMany({ data: rows })],
  ["Warehouse", () => local.warehouse.findMany(), (rows: any[]) => cloud.warehouse.createMany({ data: rows })],
  ["Material", () => local.material.findMany(), (rows: any[]) => cloud.material.createMany({ data: rows })],
  ["MaintenanceEvent", () => local.maintenanceEvent.findMany(), (rows: any[]) => cloud.maintenanceEvent.createMany({ data: rows })],
  ["StandReservation", () => local.standReservation.findMany(), (rows: any[]) => cloud.standReservation.createMany({ data: rows })],
  ["EventTow", () => local.eventTow.findMany(), (rows: any[]) => cloud.eventTow.createMany({ data: rows })],
  ["MaintenanceEventAudit", () => local.maintenanceEventAudit.findMany(), (rows: any[]) => cloud.maintenanceEventAudit.createMany({ data: rows })],
  ["EventWorkPlanLine", () => local.eventWorkPlanLine.findMany(), (rows: any[]) => cloud.eventWorkPlanLine.createMany({ data: rows })],
  ["EventWorkActualLine", () => local.eventWorkActualLine.findMany(), (rows: any[]) => cloud.eventWorkActualLine.createMany({ data: rows })],
  ["TimeEntry", () => local.timeEntry.findMany(), (rows: any[]) => cloud.timeEntry.createMany({ data: rows })],
  ["StockMovement", () => local.stockMovement.findMany(), (rows: any[]) => cloud.stockMovement.createMany({ data: rows })],
  ["MaterialReservation", () => local.materialReservation.findMany(), (rows: any[]) => cloud.materialReservation.createMany({ data: rows })],
  ["MaterialIssue", () => local.materialIssue.findMany(), (rows: any[]) => cloud.materialIssue.createMany({ data: rows })]
] as const;

async function truncateCloudData() {
  const tables = await cloud.$queryRaw<Array<{ tablename: string }>>(Prisma.sql`
    select tablename
    from pg_tables
    where schemaname = 'public' and tablename <> '_prisma_migrations'
  `);

  if (tables.length === 0) return;

  const list = tables
    .map(({ tablename }) => `"public"."${tablename.replace(/"/g, "\"\"")}"`)
    .join(", ");

  await cloud.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function createManyChunked(write: (rows: any[]) => Promise<{ count: number }>, rows: any[], chunkSize = 200) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await write(rows.slice(i, i + chunkSize));
  }
}

async function main() {
  console.log("Source DATABASE_URL:", localUrl);
  console.log("Target DATABASE_CLOUD_URL:", cloudUrl);

  await local.$connect();
  await cloud.$connect();

  await truncateCloudData();

  const summary: Record<string, number> = {};
  for (const [label, readRows, writeRows] of COPY_ORDER) {
    const rows = await readRows();
    await createManyChunked(writeRows, rows);
    summary[label] = rows.length;
    console.log(`${label}: ${rows.length}`);
  }

  console.table(summary);
}

main()
  .then(async () => {
    await Promise.all([local.$disconnect(), cloud.$disconnect()]);
  })
  .catch(async (error) => {
    console.error(error);
    await Promise.all([local.$disconnect(), cloud.$disconnect()]);
    process.exit(1);
  });
