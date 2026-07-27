import { EventStatus } from "@prisma/client";

import { PRIMARY_TABLE_COLUMN_BY_KEY } from "./columnCatalog.generated.js";
import { formatPrimaryDateDisplay, isTemporalPrimaryType } from "./dateFormat.js";
import { toPrimaryTableRow } from "./rowMapper.js";
import type {
  PrimaryFilterCondition,
  PrimaryQueryInput,
  PrimaryQueryResult,
  PrimarySort
} from "./types.js";

type CursorValue = { startAt: string; id: string };

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): CursorValue | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof value?.startAt !== "string" || typeof value?.id !== "string") return null;
    if (!Number.isFinite(new Date(value.startAt).getTime())) return null;
    return value;
  } catch {
    return null;
  }
}

function matches(row: Record<string, unknown>, conditions: PrimaryFilterCondition[]): boolean {
  for (const condition of conditions) {
    const raw = row[condition.field];
    const empty = raw == null || raw === "";
    if (condition.op === "empty") {
      if (!empty) return false;
      continue;
    }
    if (condition.op === "notEmpty") {
      if (empty) return false;
      continue;
    }
    const expected = condition.value ?? "";
    const actualText = String(raw ?? "");
    const actualNumber = Number(raw);
    const expectedNumber = Number(expected);
    switch (condition.op) {
      case "contains":
        if (!actualText.toLocaleLowerCase("ru").includes(expected.toLocaleLowerCase("ru"))) return false;
        break;
      case "eq":
        if (actualText !== expected) return false;
        break;
      case "neq":
        if (actualText === expected) return false;
        break;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const actualDate = new Date(actualText).getTime();
        const expectedDate = new Date(expected).getTime();
        const [left, right] =
          Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)
            ? [actualNumber, expectedNumber]
            : Number.isFinite(actualDate) && Number.isFinite(expectedDate)
              ? [actualDate, expectedDate]
              : [Number.NaN, Number.NaN];
        if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
        if (condition.op === "gt" && !(left > right)) return false;
        if (condition.op === "gte" && !(left >= right)) return false;
        if (condition.op === "lt" && !(left < right)) return false;
        if (condition.op === "lte" && !(left <= right)) return false;
        break;
      }
    }
  }
  return true;
}

function sortRows(rows: Array<Record<string, unknown>>, sort: PrimarySort[]): void {
  if (!sort.length) return;
  rows.sort((a, b) => {
    for (const item of sort) {
      const av = a[item.field];
      const bv = b[item.field];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "ru", { numeric: true });
      if (cmp) return item.dir === "asc" ? cmp : -cmp;
    }
    return String(a.__eventId).localeCompare(String(b.__eventId));
  });
}

const EVENT_INCLUDE = {
  aircraft: { include: { operator: true, type: true } },
  eventType: true,
  hangar: true,
  workshop: true,
  primaryExtension: true,
  customerSlot: true,
  slotDeviations: true,
  reportMetrics: true,
  reportScalars: true,
  ptoRollingEntries: { orderBy: { createdAt: "asc" as const }, take: 1 },
  aCheckAnalysis: true,
  placements: {
    orderBy: { sortOrder: "asc" as const },
    take: 1,
    include: {
      hangar: true,
      stand: true,
      reservation: { include: { stand: true } }
    }
  },
  reservations: {
    orderBy: { startAt: "asc" as const },
    take: 1,
    include: { stand: true }
  }
};

export async function queryPrimaryTable(
  app: any,
  sandboxId: string | null,
  input: PrimaryQueryInput
): Promise<PrimaryQueryResult> {
  const requestedColumns = input.fields
    .map((key) => PRIMARY_TABLE_COLUMN_BY_KEY.get(key))
    .filter((column) => column != null);
  if (!requestedColumns.length) throw Object.assign(new Error("PRIMARY_FIELDS_REQUIRED"), { statusCode: 400 });

  let cursor = decodeCursor(input.cursor);
  if (input.cursor && !cursor) throw Object.assign(new Error("INVALID_CURSOR"), { statusCode: 400 });

  const collected: Array<Record<string, unknown>> = [];
  const batchSize = Math.min(500, Math.max(input.limit * 3, 100));
  let exhausted = false;

  while (collected.length <= input.limit && !exhausted) {
    const events = await app.prisma.maintenanceEvent.findMany({
      where: {
        sandboxId,
        status: { not: EventStatus.DELETED },
        startAt: { lt: input.to },
        endAt: { gt: input.from },
        ...(cursor
          ? {
              OR: [
                { startAt: { gt: new Date(cursor.startAt) } },
                { startAt: new Date(cursor.startAt), id: { gt: cursor.id } }
              ]
            }
          : {})
      },
      include: EVENT_INCLUDE,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: batchSize
    });
    if (events.length < batchSize) exhausted = true;
    if (!events.length) break;
    const scannedLast = events.at(-1)!;
    cursor = { startAt: scannedLast.startAt.toISOString(), id: scannedLast.id };
    for (const event of events) {
      const row = toPrimaryTableRow(event);
      if (matches(row, input.conditions)) collected.push(row);
      if (collected.length > input.limit) break;
    }
  }

  const hasMore = collected.length > input.limit || !exhausted;
  const page = collected.slice(0, input.limit);
  const pageCursor = page.at(-1);
  sortRows(page, input.sort);
  const rows = page.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const column of requestedColumns) {
      const value = row[column.key] ?? null;
      projected[column.key] =
        !input.rawDates && isTemporalPrimaryType(column.type) && value != null
          ? formatPrimaryDateDisplay(value, column.type)
          : value;
    }
    return projected;
  });

  const totalEstimate = await app.prisma.maintenanceEvent.count({
    where: {
      sandboxId,
      status: { not: EventStatus.DELETED },
      startAt: { lt: input.to },
      endAt: { gt: input.from }
    }
  });

  return {
    columns: requestedColumns,
    rows,
    nextCursor:
      hasMore && pageCursor?.__startAt && pageCursor?.__eventId
        ? encodeCursor({ startAt: String(pageCursor.__startAt), id: String(pageCursor.__eventId) })
        : null,
    totalEstimate
  };
}
