import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertModelPermission } from "../../lib/rbac.js";

export const operatorsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertModelPermission(req as any, "Operator", "view");
    return await app.prisma.operator.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
  });

  app.post("/import", async (req) => {
    assertModelPermission(req as any, "Operator", "add");
    const body = z
      .object({
        dryRun: z.boolean().optional(),
        isActive: z.boolean().optional(),
        rows: z
          .array(
            z.object({
              code: z.string().optional(),
              name: z.string().optional()
            })
          )
          .min(1)
          .max(500)
      })
      .parse(req.body);

    const norm = (s: unknown) =>
      String(s ?? "")
        .normalize("NFKC")
        .replace(/^\uFEFF/, "")
        .replace(/\u00A0/g, " ")
        .trim()
        .replace(/^"+|"+$/g, "");
    const key = (s: unknown) => norm(s).toLocaleLowerCase("ru-RU");

    const existing = await app.prisma.operator.findMany();
    const byKey = new Map<string, (typeof existing)[number]>();
    for (const op of existing) {
      byKey.set(key(op.code), op);
      byKey.set(key(op.name), op);
    }
    const seen = new Set<string>();
    const toCreate: Array<{ code: string; name: string; isActive: boolean }> = [];
    const previewRows: Array<{ rowIndex: number; ok: boolean; code: string; name: string; error?: string }> = [];

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i]!;
      const code = norm(row.code);
      const name = norm(row.name);
      let error = "";
      if (!code) error = "Не указан code";
      else if (code.length > 32) error = "code длиннее 32 символов";
      else if (!name) error = "Не указано name";
      else if (name.length > 200) error = "name длиннее 200 символов";
      else if (seen.has(key(code))) error = `Дубль в файле: ${code}`;
      else if (byKey.has(key(code)) || byKey.has(key(name))) error = `Оператор уже есть: ${code}`;
      seen.add(key(code));
      previewRows.push({ rowIndex: i + 2, ok: !error, code, name, ...(error ? { error } : {}) });
      if (!error) toCreate.push({ code, name, isActive: body.isActive ?? true });
    }

    const summary = {
      dryRun: Boolean(body.dryRun),
      totalRows: body.rows.length,
      okRows: previewRows.filter((r) => r.ok).length,
      errorRows: previewRows.filter((r) => !r.ok).length
    };
    if (body.dryRun) return { ok: true, summary, rows: previewRows };
    const res = toCreate.length ? await app.prisma.operator.createMany({ data: toCreate, skipDuplicates: true }) : { count: 0 };
    return { ok: true, summary, rows: previewRows, created: res.count, skipped: body.rows.length - res.count };
  });

  app.post("/", async (req) => {
    assertModelPermission(req as any, "Operator", "add");
    const body = z
      .object({
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(200),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.operator.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertModelPermission(req as any, "Operator", "change");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(32).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.operator.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertModelPermission(req as any, "Operator", "delete");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.operator.delete({ where: { id } });
    return { ok: true };
  });
};

