import { createHash, randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

const ROLE_RE = /^[a-z][a-z0-9_]{0,62}$/;
const SENSITIVE_TABLES = ["User", "MailDigestSettings"] as const;

export function quoteIdent(name: string): string {
  if (!ROLE_RE.test(name) && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("INVALID_PG_IDENT");
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  if (value.includes("\u0000")) throw new Error("INVALID_PG_LITERAL");
  return `'${value.replace(/'/g, "''")}'`;
}

export function pgRoleNameFromEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const local = normalized.replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "user";
  const prefix = "hvp_ro_";
  const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 6);
  const maxCore = 63 - prefix.length - 1 - hash.length;
  const core = local.slice(0, Math.max(1, maxCore));
  const name = `${prefix}${core}_${hash}`;
  if (!ROLE_RE.test(name)) throw new Error("INVALID_PG_IDENT");
  return name;
}

export function generatePgPassword(): string {
  return randomBytes(18).toString("base64url");
}

export function publicDbTarget(databaseUrl: string | undefined): { database: string; port: number } {
  const raw = String(databaseUrl ?? "").trim();
  const dbMatch = raw.match(/\/([^/?]+)(?:\?|$)/);
  const portMatch = raw.match(/:(\d+)(?:\/|\?|$)/);
  const database = decodeURIComponent(dbMatch?.[1] ?? "").replace(/\/+$/, "") || "hangar_planning";
  const port = Number(portMatch?.[1] ?? "") || 5432;
  return { database, port };
}

function assertRoleName(name: string): string {
  const role = String(name ?? "").trim();
  if (!ROLE_RE.test(role)) throw new Error("INVALID_PG_IDENT");
  return role;
}

function provisionFailed(err: unknown): Error {
  const e = new Error("DB_ROLE_PROVISION_FAILED") as Error & { statusCode?: number; cause?: unknown };
  e.statusCode = 400;
  e.cause = err;
  return e;
}

export async function provisionReadOnlyRole(
  prisma: PrismaClient,
  roleName: string,
  password: string
): Promise<void> {
  const role = assertRoleName(roleName);
  const ident = quoteIdent(role);
  const pwd = quoteLiteral(password);
  const existing = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS "exists"
  `;
  try {
    if (existing[0]?.exists) {
      await prisma.$executeRawUnsafe(`ALTER ROLE ${ident} LOGIN PASSWORD ${pwd}`);
    } else {
      await prisma.$executeRawUnsafe(`CREATE ROLE ${ident} LOGIN PASSWORD ${pwd}`);
    }
    const dbRows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const dbName = dbRows[0]?.current_database;
    if (dbName) {
      await prisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${ident}`);
    }
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${ident}`);
    await prisma.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ident}`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ident}`);
    for (const table of SENSITIVE_TABLES) {
      await prisma.$executeRawUnsafe(`REVOKE ALL ON TABLE ${quoteIdent(table)} FROM ${ident}`);
    }
  } catch (err) {
    throw provisionFailed(err);
  }
}

export async function setRoleCanLogin(prisma: PrismaClient, roleName: string, canLogin: boolean): Promise<void> {
  const role = assertRoleName(roleName);
  const ident = quoteIdent(role);
  const existing = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS "exists"
  `;
  if (!existing[0]?.exists) return;
  try {
    await prisma.$executeRawUnsafe(`ALTER ROLE ${ident} ${canLogin ? "LOGIN" : "NOLOGIN"}`);
  } catch (err) {
    throw provisionFailed(err);
  }
}

export type UserDbAccessState = {
  email: string;
  isActive: boolean;
  dbAccessEnabled: boolean;
  pgRoleName: string | null;
  pgPassword: string | null;
};

export async function syncUserDbAccess(
  prisma: PrismaClient,
  current: UserDbAccessState,
  patch: { dbAccessEnabled?: boolean; isActive?: boolean }
): Promise<{ dbAccessEnabled: boolean; pgRoleName: string | null; pgPassword: string | null }> {
  const wantAccess = patch.dbAccessEnabled ?? current.dbAccessEnabled;
  const isActive = patch.isActive ?? current.isActive;

  if (!wantAccess) {
    if (current.pgRoleName) {
      await setRoleCanLogin(prisma, current.pgRoleName, false);
    }
    return {
      dbAccessEnabled: false,
      pgRoleName: current.pgRoleName,
      pgPassword: current.pgPassword
    };
  }

  const roleName = current.pgRoleName || pgRoleNameFromEmail(current.email);
  const password = current.pgPassword && current.dbAccessEnabled ? current.pgPassword : generatePgPassword();
  await provisionReadOnlyRole(prisma, roleName, password);
  if (!isActive) {
    await setRoleCanLogin(prisma, roleName, false);
  }
  return { dbAccessEnabled: true, pgRoleName: roleName, pgPassword: password };
}

export function dbAccessPayload(
  user: { dbAccessEnabled: boolean; pgRoleName: string | null; pgPassword: string | null },
  databaseUrl: string | undefined
): {
  enabled: true;
  host: string;
  hostHint: string;
  port: number;
  database: string;
  user: string;
  password: string;
} | null {
  if (!user.dbAccessEnabled || !user.pgRoleName || !user.pgPassword) return null;
  const target = publicDbTarget(databaseUrl);
  return {
    enabled: true,
    host: "",
    hostHint: "Хост нужно уточнить у администратора",
    port: target.port,
    database: target.database,
    user: user.pgRoleName,
    password: user.pgPassword
  };
}
