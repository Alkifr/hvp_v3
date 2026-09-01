import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { assertPermission } from "../lib/rbac.js";
import { zUuid } from "../lib/zod.js";

const TABLE_KEYS = ["gantt_events"] as const;

const zConfig = z.object({
  order: z.array(z.string().trim().min(1).max(80)).max(250),
  hidden: z.array(z.string().trim().min(1).max(80)).max(250),
  visible: z.array(z.string().trim().min(1).max(80)).max(250).optional(),
  widths: z.record(z.string().trim().min(1).max(80), z.number().finite().min(40).max(800)),
  pinnedLeft: z.array(z.string().trim().min(1).max(80)).max(80).optional()
});

function assertAuthed(req: any): { id: string } {
  const auth = req.auth as { id?: string } | undefined;
  if (!auth?.id) {
    const err: any = new Error("UNAUTHORIZED");
    err.statusCode = 401;
    throw err;
  }
  return { id: auth.id };
}

function serialize(view: {
  id: string;
  tableKey: string;
  name: string;
  isActive: boolean;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: view.id,
    tableKey: view.tableKey,
    name: view.name,
    isActive: view.isActive,
    config: view.config,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString()
  };
}

export const tableViewRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const tableKey = z.enum(TABLE_KEYS).parse((req.query as any)?.tableKey ?? "gantt_events");
    const views = await app.prisma.savedTableView.findMany({
      where: { userId: me.id, tableKey },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }]
    });
    return { ok: true as const, views: views.map(serialize) };
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const body = z
      .object({
        tableKey: z.enum(TABLE_KEYS).default("gantt_events"),
        name: z.string().trim().min(1).max(80),
        config: zConfig,
        isActive: z.boolean().optional().default(true)
      })
      .parse(req.body);

    let created;
    try {
      created = await app.prisma.$transaction(async (tx) => {
        if (body.isActive) {
          await tx.savedTableView.updateMany({
            where: { userId: me.id, tableKey: body.tableKey, isActive: true },
            data: { isActive: false }
          });
        }
        return tx.savedTableView.create({
          data: {
            userId: me.id,
            tableKey: body.tableKey,
            name: body.name,
            config: body.config,
            isActive: body.isActive
          }
        });
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        const err: any = new Error("TABLE_VIEW_NAME_TAKEN");
        err.statusCode = 409;
        throw err;
      }
      throw e;
    }

    return { ok: true as const, view: serialize(created) };
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        config: zConfig.optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    const existing = await app.prisma.savedTableView.findFirst({
      where: { id, userId: me.id }
    });
    if (!existing) {
      const err: any = new Error("TABLE_VIEW_NOT_FOUND");
      err.statusCode = 404;
      throw err;
    }

    const updated = await app.prisma.$transaction(async (tx) => {
      if (body.isActive === true) {
        await tx.savedTableView.updateMany({
          where: { userId: me.id, tableKey: existing.tableKey, isActive: true, id: { not: id } },
          data: { isActive: false }
        });
      }
      return tx.savedTableView.update({
        where: { id },
        data: {
          ...(body.name != null ? { name: body.name } : {}),
          ...(body.config ? { config: body.config } : {}),
          ...(body.isActive != null ? { isActive: body.isActive } : {})
        }
      });
    });

    return { ok: true as const, view: serialize(updated) };
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const id = zUuid.parse((req.params as any).id);
    const existing = await app.prisma.savedTableView.findFirst({
      where: { id, userId: me.id },
      select: { id: true }
    });
    if (!existing) {
      const err: any = new Error("TABLE_VIEW_NOT_FOUND");
      err.statusCode = 404;
      throw err;
    }
    await app.prisma.savedTableView.delete({ where: { id } });
    return { ok: true as const };
  });
};
