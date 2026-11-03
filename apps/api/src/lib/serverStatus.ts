import fs from "node:fs/promises";
import os from "node:os";

import type { PrismaClient } from "@prisma/client";

export type StatusLevel = "ok" | "warn" | "down" | "unknown";

export type ServerStatusSnapshot = {
  collectedAt: string;
  process: {
    pid: number;
    node: string;
    uptimeSec: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    level: StatusLevel;
    note: string | null;
  };
  host: {
    hostname: string;
    platform: string;
    arch: string;
    cpuCount: number;
    loadAvg: [number, number, number];
    memTotalBytes: number;
    memFreeBytes: number;
    uptimeSec: number;
    level: StatusLevel;
    note: string | null;
  };
  disk: {
    path: string;
    totalBytes: number | null;
    freeBytes: number | null;
    level: StatusLevel;
    note: string | null;
  };
  database: {
    connected: boolean;
    latencyMs: number | null;
    name: string | null;
    sizeBytes: number | null;
    connections: number | null;
    version: string | null;
    level: StatusLevel;
    note: string | null;
  };
};

const LOW_FREE_RATIO = 0.1;
const SLOW_QUERY_MS = 500;
const PROCESS_RSS_RATIO = 0.8;

export function processStatus(rssBytes: number, memTotalBytes: number): { level: StatusLevel; note: string | null } {
  if (memTotalBytes > 0 && rssBytes / memTotalBytes > PROCESS_RSS_RATIO) {
    return { level: "warn", note: "Процесс занимает больше 80% памяти машины." };
  }
  return { level: "ok", note: null };
}

export function hostStatus(input: {
  memFreeBytes: number;
  memTotalBytes: number;
  load1: number;
  cpuCount: number;
}): { level: StatusLevel; note: string | null } {
  const lowMem = input.memTotalBytes > 0 && input.memFreeBytes / input.memTotalBytes < LOW_FREE_RATIO;
  const highLoad = input.cpuCount > 0 && input.load1 > input.cpuCount;
  if (lowMem && highLoad) return { level: "warn", note: "Мало свободной памяти и высокая нагрузка." };
  if (lowMem) return { level: "warn", note: "Свободно меньше 10% памяти." };
  if (highLoad) return { level: "warn", note: "Нагрузка за минуту выше числа ядер." };
  return { level: "ok", note: null };
}

export function diskStatus(freeBytes: number, totalBytes: number): { level: StatusLevel; note: string | null } {
  if (totalBytes > 0 && freeBytes / totalBytes < LOW_FREE_RATIO) {
    return { level: "warn", note: "Свободно меньше 10% диска." };
  }
  return { level: "ok", note: null };
}

export function databaseStatus(connected: boolean, latencyMs: number | null): { level: StatusLevel; note: string | null } {
  if (!connected) return { level: "down", note: "База не отвечает." };
  if (latencyMs != null && latencyMs >= SLOW_QUERY_MS) return { level: "warn", note: "Ответ дольше 500 мс." };
  return { level: "ok", note: null };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function readDisk(path: string): Promise<ServerStatusSnapshot["disk"]> {
  try {
    const stat = await fs.statfs(path);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes) || totalBytes <= 0) {
      return { path, totalBytes: null, freeBytes: null, level: "unknown", note: "Размер диска прочитать не удалось." };
    }
    const status = diskStatus(freeBytes, totalBytes);
    return { path, totalBytes, freeBytes, ...status };
  } catch {
    return { path, totalBytes: null, freeBytes: null, level: "unknown", note: "Размер диска прочитать не удалось." };
  }
}

async function readDatabase(prisma: PrismaClient): Promise<ServerStatusSnapshot["database"]> {
  const started = performance.now();
  const empty = {
    connected: false,
    latencyMs: null,
    name: null,
    sizeBytes: null,
    connections: null,
    version: null
  };
  try {
    const rows = await prisma.$queryRaw<
      Array<{ name: string; size_bytes: unknown; connections: unknown; version: string }>
    >`
      SELECT
        current_database()::text AS name,
        pg_database_size(current_database()) AS size_bytes,
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
        current_setting('server_version') AS version
    `;
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const row = rows[0];
    if (!row) return { ...empty, ...databaseStatus(false, null) };
    return {
      connected: true,
      latencyMs,
      name: row.name ?? null,
      sizeBytes: toNumber(row.size_bytes),
      connections: toNumber(row.connections),
      version: row.version ?? null,
      ...databaseStatus(true, latencyMs)
    };
  } catch {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const latencyMs = Math.max(0, Math.round(performance.now() - started));
      return { ...empty, connected: true, latencyMs, ...databaseStatus(true, latencyMs) };
    } catch {
      return { ...empty, ...databaseStatus(false, null) };
    }
  }
}

export async function collectServerStatus(prisma: PrismaClient, diskPath = process.cwd()): Promise<ServerStatusSnapshot> {
  const mem = process.memoryUsage();
  const memTotalBytes = os.totalmem();
  const memFreeBytes = os.freemem();
  const cpuCount = os.cpus().length;
  const load = os.loadavg();
  const loadAvg: [number, number, number] = [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0];
  const [disk, database] = await Promise.all([readDisk(diskPath), readDatabase(prisma)]);

  return {
    collectedAt: new Date().toISOString(),
    process: {
      pid: process.pid,
      node: process.version,
      uptimeSec: process.uptime(),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      ...processStatus(mem.rss, memTotalBytes)
    },
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpuCount,
      loadAvg,
      memTotalBytes,
      memFreeBytes,
      uptimeSec: os.uptime(),
      ...hostStatus({ memFreeBytes, memTotalBytes, load1: loadAvg[0], cpuCount })
    },
    disk,
    database
  };
}
