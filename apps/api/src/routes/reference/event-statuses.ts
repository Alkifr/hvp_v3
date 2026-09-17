import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { assertModelPermission, assertSystemAdmin } from "../../lib/rbac.js";
import {
  ensureEventStatusCatalogRows,
  EventStatus,
  isEventStatusCodeFormat,
  isSystemEventStatusCode,
  mergeEventStatusCatalogRow,
  normalizeEventStatusCode
} from "../../lib/eventStatusCatalog.js";

function normalizeHexColor(raw: string | null | undefined) {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const m = v.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return undefined;
  return `#${m[1]!.toUpperCase()}`;
}

const statusFields = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  color: z.string().trim().max(16).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  selectable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  allowsAutoInProgress: z.boolean().optional(),
  manualOnly: z.boolean().optional()
});

function parseStatusCode(raw: unknown): string {
  const code = normalizeEventStatusCode(String(raw ?? ""));
  if (!isEventStatusCodeFormat(code)) {
    throw Object.assign(new Error("Код статуса: латиница, цифры и подчёркивание, 2–64 символа"), { statusCode: 400 });
  }
  return code;
}

function parseColor(body: { color?: string | null }) {
  const color =
    body.color === undefined ? undefined : body.color === null || body.color === "" ? null : normalizeHexColor(body.color);
  if (body.color !== undefined && body.color !== null && body.color !== "" && color === undefined) {
    throw Object.assign(new Error("Некорректный цвет. Ожидается hex: #RRGGBB"), { statusCode: 400 });
  }
  return color;
}

export const eventStatusesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertModelPermission(req as any, "EventStatusCatalog", "view");
    await ensureEventStatusCatalogRows(app.prisma);
    const rows = await app.prisma.eventStatusCatalog.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });
    return rows
      .map((row) => mergeEventStatusCatalogRow(row))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
  });

  app.post("/", async (req) => {
    assertModelPermission(req as any, "EventStatusCatalog", "add");
    assertSystemAdmin(req as any);
    const body = statusFields
      .extend({
        code: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(200)
      })
      .parse(req.body);

    const code = parseStatusCode(body.code);
    if (isSystemEventStatusCode(code)) {
      throw app.httpErrors.badRequest("Этот код зарезервирован системой. Выберите другой.");
    }
    const color = parseColor(body);
    const selectable = body.selectable ?? body.isActive ?? true;
    const allowsAutoInProgress = body.allowsAutoInProgress ?? false;
    const manualOnly = body.manualOnly ?? false;

    await ensureEventStatusCatalogRows(app.prisma);
    const existing = await app.prisma.eventStatusCatalog.findUnique({ where: { code } });
    if (existing) {
      throw app.httpErrors.conflict("Статус с таким кодом уже есть");
    }

    const created = await app.prisma.eventStatusCatalog.create({
      data: {
        code,
        name: body.name,
        color: color ?? null,
        sortOrder: body.sortOrder ?? 90,
        selectable,
        allowsAutoInProgress,
        manualOnly
      }
    });
    return mergeEventStatusCatalogRow(created);
  });

  app.patch("/:id", async (req) => {
    assertModelPermission(req as any, "EventStatusCatalog", "change");
    assertSystemAdmin(req as any);
    const code = parseStatusCode((req.params as any).id);
    const body = statusFields.parse(req.body);
    const color = parseColor(body);

    await ensureEventStatusCatalogRows(app.prisma);
    const existing = await app.prisma.eventStatusCatalog.findUnique({ where: { code } });
    if (!existing) {
      throw app.httpErrors.notFound("Статус не найден");
    }

    const selectable =
      code === EventStatus.DELETED ? false : (body.selectable ?? body.isActive);
    const terminal = code === EventStatus.DELETED || code === EventStatus.CANCELLED;
    const allowsAutoInProgress = terminal ? false : body.allowsAutoInProgress;
    const manualOnly = code === EventStatus.DELETED ? true : body.manualOnly;

    const updated = await app.prisma.eventStatusCatalog.update({
      where: { code },
      data: {
        ...(body.name != null ? { name: body.name } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(body.sortOrder != null ? { sortOrder: body.sortOrder } : {}),
        ...(selectable != null ? { selectable } : {}),
        ...(allowsAutoInProgress != null ? { allowsAutoInProgress } : {}),
        ...(manualOnly != null ? { manualOnly } : {})
      }
    });

    return mergeEventStatusCatalogRow(updated);
  });

  app.delete("/:id", async (req) => {
    assertModelPermission(req as any, "EventStatusCatalog", "delete");
    assertSystemAdmin(req as any);
    const code = parseStatusCode((req.params as any).id);
    if (isSystemEventStatusCode(code)) {
      throw app.httpErrors.badRequest("Системный статус нельзя удалить");
    }

    const used = await app.prisma.maintenanceEvent.count({ where: { status: code } });
    if (used > 0) {
      throw app.httpErrors.conflict(`Статус используется в ${used} событии(ях)`);
    }

    await app.prisma.eventStatusCatalog.delete({ where: { code } });
    return { ok: true };
  });
};
