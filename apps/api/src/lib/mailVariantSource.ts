import { Prisma, type PrismaClient } from "@prisma/client";

export const MAIL_SOURCES = [
  { id: "plan", label: "Изменения плана ТО" },
  { id: "tows", label: "Буксировки" }
] as const;

export type MailSourceId = (typeof MAIL_SOURCES)[number]["id"];

export function parseMailSource(raw: unknown): MailSourceId {
  const value = String(raw ?? "").trim();
  return MAIL_SOURCES.some((item) => item.id === value) ? (value as MailSourceId) : "plan";
}

function dbSchema(): string {
  const raw = String(process.env.DATABASE_CLOUD_URL ?? "");
  const match = raw.match(/[?&]schema=([^&]+)/i);
  const schema = decodeURIComponent(match?.[1] ?? "public").trim() || "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) return "public";
  return schema;
}

function variantTable(): string {
  return `"${dbSchema()}"."MailDigestVariant"`;
}

export async function ensureMailSourceColumn(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE ${variantTable()} ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'plan'`
  );
}

export async function readMailSources(prisma: PrismaClient, ids: string[]): Promise<Map<string, MailSourceId>> {
  const out = new Map<string, MailSourceId>();
  if (!ids.length) return out;
  await ensureMailSourceColumn(prisma);
  const rows = await prisma.$queryRaw<Array<{ id: string; source: string }>>(
    Prisma.sql`SELECT "id", "source" FROM ${Prisma.raw(variantTable())} WHERE "id" IN (${Prisma.join(ids)})`
  );
  for (const row of rows) out.set(row.id, parseMailSource(row.source));
  return out;
}

export async function writeMailSource(prisma: PrismaClient, id: string, source: MailSourceId): Promise<void> {
  await ensureMailSourceColumn(prisma);
  await prisma.$executeRaw`
    UPDATE ${Prisma.raw(variantTable())}
    SET "source" = ${source}
    WHERE "id" = ${id}
  `;
}
