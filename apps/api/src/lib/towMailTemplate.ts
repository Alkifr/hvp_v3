import { Prisma, type PrismaClient } from "@prisma/client";

export const DEFAULT_TOW_SUBJECT = "Реестр буксировок {{period}}";

function mailSchema(): string {
  const raw = String(process.env.DATABASE_CLOUD_URL ?? "");
  const match = raw.match(/[?&]schema=([^&]+)/i);
  const schema = decodeURIComponent(match?.[1] ?? "public").trim() || "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) return "public";
  return schema;
}

function tableSql(): string {
  return `"${mailSchema()}"."TowRegistryMailTemplate"`;
}

async function ensureTable(prisma: PrismaClient): Promise<void> {
  const schema = mailSchema();
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${schema}"."TowRegistryMailTemplate" (
      "id" TEXT PRIMARY KEY,
      "subjectTemplate" TEXT NOT NULL,
      "bodyTemplate" TEXT NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function readTowMailTemplate(prisma: PrismaClient): Promise<{ subjectTemplate: string; bodyTemplate: string }> {
  await ensureTable(prisma);
  const rows = await prisma.$queryRaw<Array<{ subjectTemplate: string; bodyTemplate: string }>>(
    Prisma.sql`SELECT "subjectTemplate", "bodyTemplate" FROM ${Prisma.raw(tableSql())} WHERE "id" = 'default'`
  );
  return rows[0] ?? { subjectTemplate: DEFAULT_TOW_SUBJECT, bodyTemplate: "" };
}

export async function writeTowMailTemplate(
  prisma: PrismaClient,
  input: { subjectTemplate: string; bodyTemplate: string }
): Promise<void> {
  await ensureTable(prisma);
  const subject = input.subjectTemplate.trim() || DEFAULT_TOW_SUBJECT;
  const body = input.bodyTemplate.trim();
  await prisma.$executeRaw`
    INSERT INTO ${Prisma.raw(tableSql())} ("id", "subjectTemplate", "bodyTemplate", "updatedAt")
    VALUES ('default', ${subject}, ${body}, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE
    SET "subjectTemplate" = EXCLUDED."subjectTemplate",
        "bodyTemplate" = EXCLUDED."bodyTemplate",
        "updatedAt" = CURRENT_TIMESTAMP
  `;
}
