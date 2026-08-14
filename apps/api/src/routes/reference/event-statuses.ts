import type { FastifyPluginAsync } from "fastify";
import { EventStatus } from "@prisma/client";
import { z } from "zod";

import { assertPermission, assertSystemAdmin } from "../../lib/rbac.js";
import {
  ensureEventStatusCatalogRows,
  EVENT_STATUS_CATALOG,
  mergeEventStatusCatalogRow
} from "../../lib/eventStatusCatalog.js";

function normalizeHexColor(raw: string | null | undefined) {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const m = v.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return undefined;
  return `#${m[1]!.toUpperCase()}`;
}

export const eventStatusesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    await ensureEventStatusCatalogRows(app.prisma);
    const rows = await app.prisma.eventStatusCatalog.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });
    const byCode = new Map(rows.map((row) => [row.code, row]));
    return EVENT_STATUS_CATALOG.map((item) => {
      const stored = byCode.get(item.code);
      return mergeEventStatusCatalogRow(
        stored ?? {
          code: item.code,
          name: item.name,
          color: item.color,
          sortOrder: item.sortOrder,
          selectable: item.selectable,
          allowsAutoInProgress: item.allowsAutoInProgress,
          manualOnly: item.manualOnly
        }
      );
    }).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    assertSystemAdmin(req as any);
    const code = z.nativeEnum(EventStatus).parse((req.params as any).id);
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        color: z.string().trim().max(16).nullable().optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
        selectable: z.boolean().optional(),
        isActive: z.boolean().optional(),
        allowsAutoInProgress: z.boolean().optional(),
        manualOnly: z.boolean().optional()
      })
      .parse(req.body);

    const color =
      body.color === undefined ? undefined : body.color === null || body.color === "" ? null : normalizeHexColor(body.color);
    if (body.color !== undefined && body.color !== null && body.color !== "" && color === undefined) {
      throw Object.assign(new Error("Некорректный цвет. Ожидается hex: #RRGGBB"), { statusCode: 400 });
    }

    await ensureEventStatusCatalogRows(app.prisma);
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
};
