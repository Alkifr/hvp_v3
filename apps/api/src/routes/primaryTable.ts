import {
  PrimaryMetricBlock,
  PrimaryMetricDepartment,
  PrimaryMetricSource
} from "@prisma/client";
import ExcelJS from "exceljs";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertPermission } from "../lib/rbac.js";
import { PRIMARY_TABLE_COLUMNS } from "../lib/primaryTable/columnCatalog.generated.js";
import {
  formatPrimaryDateDisplay,
  isTemporalPrimaryType,
  toExcelDateValue
} from "../lib/primaryTable/dateFormat.js";
import { writePrimaryTableHeaderRows } from "../lib/primaryTable/exportHeaders.js";
import { queryPrimaryTable } from "../lib/primaryTable/queryService.js";
import type { PrimaryQueryInput } from "../lib/primaryTable/types.js";
import { canWriteInContext, sandboxIdFor } from "../plugins/sandbox.js";
import { zDateTime, zUuid } from "../lib/zod.js";

const zCondition = z.object({
  field: z.string().trim().min(1),
  op: z.enum(["contains", "eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"]),
  value: z.string().optional()
});

const zQueryBody = z.object({
  from: zDateTime,
  to: zDateTime,
  fields: z.array(z.string()).min(1).max(190),
  filters: z.object({ conditions: z.array(zCondition).max(20).optional().default([]) }).optional().default({ conditions: [] }),
  sort: z
    .array(z.object({ field: z.string().trim().min(1), dir: z.enum(["asc", "desc"]) }))
    .max(3)
    .optional()
    .default([]),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100)
});

const zExtension = z
  .object({
    fleetCode: z.string().trim().max(80).nullable().optional(),
    externalExecution: z.boolean().nullable().optional(),
    normalizedForm: z.string().trim().max(160).nullable().optional(),
    normalizedFormDetail: z.string().trim().max(300).nullable().optional(),
    stationCode: z.string().trim().max(120).nullable().optional(),
    phaseKind: z.string().trim().max(80).nullable().optional(),
    agreementStatus: z.string().trim().max(120).nullable().optional(),
    iiCCheckFact: z.boolean().nullable().optional(),
    wpNumberFact: z.string().trim().max(120).nullable().optional()
  })
  .optional();

const zWriteBody = z.object({
  extension: zExtension,
  customerSlot: z
    .object({
      startAt: zDateTime.nullable().optional(),
      endAt: zDateTime.nullable().optional(),
      dlFlag: z.string().trim().max(80).nullable().optional()
    })
    .optional(),
  deviations: z
    .array(
      z.object({
        kind: z.enum(["DURATION_VS_BUDGET", "DURATION_VS_PLAN", "SHIFT_VS_BUDGET"]),
        reason: z.string().trim().max(2000).nullable().optional()
      })
    )
    .max(3)
    .optional(),
  metrics: z
    .array(
      z.object({
        block: z.nativeEnum(PrimaryMetricBlock),
        department: z.nativeEnum(PrimaryMetricDepartment),
        manHours: z.number().finite().nullable().optional(),
        costAmount: z.number().finite().nullable().optional(),
        currency: z.string().trim().length(3).toUpperCase().nullable().optional(),
        source: z.nativeEnum(PrimaryMetricSource).optional().default(PrimaryMetricSource.MANUAL)
      })
    )
    .max(72)
    .optional(),
  scalars: z
    .array(
      z.object({
        metricKey: z.string().trim().regex(/^[a-z0-9_.-]+$/).max(80),
        valueNum: z.number().finite().nullable().optional(),
        valueText: z.string().trim().max(1000).nullable().optional()
      })
    )
    .max(40)
    .optional(),
  rollingEntries: z
    .array(
      z.object({
        externalKey: z.string().trim().max(160).nullable().optional(),
        status: z.string().trim().max(120).nullable().optional(),
        kippHours: z.number().finite().nullable().optional(),
        laborTotal: z.number().finite().nullable().optional(),
        amount: z.number().finite().nullable().optional(),
        category: z.string().trim().max(160).nullable().optional(),
        comments: z.string().trim().max(2000).nullable().optional()
      })
    )
    .max(100)
    .optional(),
  aCheckAnalysis: z
    .object({
      status: z.string().trim().max(120).nullable().optional(),
      quantity: z.number().int().min(0).nullable().optional(),
      program: z.string().trim().max(160).nullable().optional()
    })
    .optional()
});

function assertWritable(req: FastifyRequest): void {
  assertPermission(req as any, "events:write");
  if (!canWriteInContext(req)) throw Object.assign(new Error("SANDBOX_WRITE_DENIED"), { statusCode: 403 });
}

function toQueryInput(body: z.infer<typeof zQueryBody>, opts?: { rawDates?: boolean }): PrimaryQueryInput {
  if (body.to <= body.from) throw Object.assign(new Error("Период to должен быть позже from"), { statusCode: 400 });
  return {
    from: body.from,
    to: body.to,
    fields: body.fields,
    conditions: body.filters.conditions,
    sort: body.sort,
    cursor: body.cursor,
    limit: body.limit,
    rawDates: opts?.rawDates
  };
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /[\";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const primaryTableRoutes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async (req) => {
    assertPermission(req as any, "events:read");
    return {
      ok: true as const,
      id: "primary_events",
      label: "Первичная таблица",
      description: "Полный плоский набор реквизитов планирования, факта, трудоёмкости и стоимости",
      fields: PRIMARY_TABLE_COLUMNS,
      defaultFields: ["primary.g", "primary.h", "primary.k", "primary.y", "primary.z", "primary.af", "primary.ai"],
      groups: Array.from(new Set(PRIMARY_TABLE_COLUMNS.map((column) => column.group).filter(Boolean)))
    };
  });

  app.post("/query", async (req) => {
    assertPermission(req as any, "events:read");
    const body = zQueryBody.parse(req.body);
    const result = await queryPrimaryTable(app, sandboxIdFor(req), toQueryInput(body));
    return { ok: true as const, ...result };
  });

  app.patch("/events/:eventId", async (req) => {
    assertWritable(req);
    const eventId = zUuid.parse((req.params as any).eventId);
    const body = zWriteBody.parse(req.body);
    const sandboxId = sandboxIdFor(req);
    const event = await app.prisma.maintenanceEvent.findFirst({ where: { id: eventId, sandboxId }, select: { id: true } });
    if (!event) throw Object.assign(new Error("EVENT_NOT_FOUND"), { statusCode: 404 });

    await app.prisma.$transaction(async (tx) => {
      if (body.extension) {
        await tx.eventPrimaryExtension.upsert({
          where: { eventId },
          update: body.extension,
          create: { eventId, sandboxId, ...body.extension }
        });
      }
      if (body.customerSlot) {
        await tx.eventCustomerSlot.upsert({
          where: { eventId },
          update: body.customerSlot,
          create: { eventId, sandboxId, ...body.customerSlot }
        });
      }
      for (const item of body.deviations ?? []) {
        await tx.eventSlotDeviation.upsert({
          where: { eventId_kind: { eventId, kind: item.kind } },
          update: { reason: item.reason ?? null },
          create: { eventId, sandboxId, kind: item.kind, reason: item.reason ?? null }
        });
      }
      for (const metric of body.metrics ?? []) {
        await tx.eventReportMetric.upsert({
          where: {
            eventId_block_department: {
              eventId,
              block: metric.block,
              department: metric.department
            }
          },
          update: metric,
          create: { eventId, sandboxId, ...metric }
        });
      }
      for (const scalar of body.scalars ?? []) {
        await tx.eventReportScalar.upsert({
          where: { eventId_metricKey: { eventId, metricKey: scalar.metricKey } },
          update: scalar,
          create: { eventId, sandboxId, ...scalar }
        });
      }
      if (body.rollingEntries) {
        await tx.eventPtoRollingEntry.deleteMany({ where: { eventId } });
        if (body.rollingEntries.length) {
          await tx.eventPtoRollingEntry.createMany({
            data: body.rollingEntries.map((entry) => ({ eventId, sandboxId, ...entry }))
          });
        }
      }
      if (body.aCheckAnalysis) {
        await tx.eventACheckAnalysis.upsert({
          where: { eventId },
          update: body.aCheckAnalysis,
          create: { eventId, sandboxId, ...body.aCheckAnalysis }
        });
      }
    });
    return { ok: true as const };
  });

  app.post("/export", async (req, reply) => {
    assertPermission(req as any, "events:read");
    const parsed = zQueryBody
      .extend({ format: z.enum(["csv", "xlsx"]).optional().default("xlsx") })
      .parse(req.body);
    const input = toQueryInput({ ...parsed, limit: 500 }, { rawDates: true });
    const columns = parsed.fields
      .map((key) => PRIMARY_TABLE_COLUMNS.find((column) => column.key === key))
      .filter((column) => column != null);
    const fileStamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    let cursor: string | undefined;
    let exported = 0;

    if (parsed.format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename=\"primary-table-${fileStamp}.csv\"`);
      reply.hijack();
      reply.raw.write(`\uFEFF${columns.map((column) => csvCell(column.label)).join(";")}\r\n`);
      do {
        const page = await queryPrimaryTable(app, sandboxIdFor(req), { ...input, cursor });
        for (const row of page.rows) {
          reply.raw.write(
            `${columns
              .map((column) => {
                const raw = row[column.key];
                if (isTemporalPrimaryType(column.type) && raw != null) {
                  return csvCell(formatPrimaryDateDisplay(raw, column.type) ?? "");
                }
                return csvCell(raw);
              })
              .join(";")}\r\n`
          );
          exported += 1;
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor && exported < 100_000);
      reply.raw.end();
      return;
    }

    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", `attachment; filename=\"primary-table-${fileStamp}.xlsx\"`);
    reply.hijack();
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: reply.raw, useStyles: true });
    const worksheet = workbook.addWorksheet("Первичная таблица");
    worksheet.columns = columns.map((column) => ({
      key: column.key,
      width: Math.min(50, Math.max(14, column.label.length + 2))
      // numFmt дат не вешаем на колонку целиком — иначе строка номеров (1,2,3…)
      // в шапке отображается как даты. Формат задаём только на ячейках данных.
    }));
    writePrimaryTableHeaderRows(worksheet, columns);
    do {
      const page = await queryPrimaryTable(app, sandboxIdFor(req), { ...input, cursor });
      for (const row of page.rows) {
        const values: unknown[] = columns.map((column) => {
          const raw = row[column.key];
          if (isTemporalPrimaryType(column.type) && raw != null) {
            return toExcelDateValue(raw, column.type)?.value ?? null;
          }
          return raw ?? null;
        });
        const excelRow = worksheet.addRow(values);
        columns.forEach((column, index) => {
          if (!isTemporalPrimaryType(column.type)) return;
          const excel = toExcelDateValue(row[column.key], column.type);
          if (!excel) return;
          const cell = excelRow.getCell(index + 1);
          cell.value = excel.value;
          cell.numFmt = excel.numFmt;
        });
        excelRow.commit();
        exported += 1;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor && exported < 100_000);
    worksheet.commit();
    await workbook.commit();
  });
};
