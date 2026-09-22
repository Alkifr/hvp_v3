import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertModelPermission } from "../../lib/rbac.js";

const zBodyType = z.enum(["NARROW_BODY", "WIDE_BODY"]).optional().nullable();

export const aircraftTypesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertModelPermission(req as any, "AircraftType", "view");
    return await app.prisma.aircraftType.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
  });

  app.post("/import", async (req) => {
    assertModelPermission(req as any, "AircraftType", "add");
    const body = z
      .object({
        dryRun: z.boolean().optional(),
        isActive: z.boolean().optional(),
        rows: z
          .array(
            z.object({
              name: z.string().optional(),
              icaoType: z.string().optional(),
              manufacturer: z.string().optional(),
              bodyType: z.string().optional()
            })
          )
          .min(1)
          .max(200)
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
    const parseBodyType = (raw: string): "NARROW_BODY" | "WIDE_BODY" | null | undefined => {
      const value = key(raw);
      if (!value) return null;
      if (["narrow_body", "narrow", "узкий", "узкофюзеляжный"].includes(value)) return "NARROW_BODY";
      if (["wide_body", "wide", "широкий", "широкофюзеляжный"].includes(value)) return "WIDE_BODY";
      return undefined;
    };

    const existing = await app.prisma.aircraftType.findMany();
    const byKey = new Map<string, (typeof existing)[number]>();
    for (const type of existing) {
      byKey.set(key(type.name), type);
      if (type.icaoType) byKey.set(key(type.icaoType), type);
    }
    const seen = new Set<string>();
    const toCreate: Array<{
      name: string;
      icaoType?: string;
      manufacturer?: string;
      bodyType?: "NARROW_BODY" | "WIDE_BODY" | null;
      isActive: boolean;
    }> = [];
    const previewRows: Array<{ rowIndex: number; ok: boolean; name: string; icaoType: string; error?: string }> = [];

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i]!;
      const name = norm(row.name);
      const icaoType = norm(row.icaoType);
      const manufacturer = norm(row.manufacturer);
      const bodyType = parseBodyType(norm(row.bodyType));
      let error = "";
      if (!name) error = "Не указан name";
      else if (name.length > 200) error = "name длиннее 200 символов";
      else if (icaoType && (icaoType.length < 2 || icaoType.length > 25)) error = "icaoType должен быть от 2 до 25 символов";
      else if (bodyType === undefined) error = `Некорректный bodyType: ${norm(row.bodyType)}`;
      else if (seen.has(key(name)) || (icaoType && seen.has(key(icaoType)))) error = `Дубль в файле: ${name}`;
      else if (byKey.has(key(name)) || (icaoType && byKey.has(key(icaoType)))) error = `Тип ВС уже есть: ${name}`;
      seen.add(key(name));
      if (icaoType) seen.add(key(icaoType));
      previewRows.push({ rowIndex: i + 2, ok: !error, name, icaoType, ...(error ? { error } : {}) });
      if (!error) {
        toCreate.push({
          name,
          isActive: body.isActive ?? true,
          ...(icaoType ? { icaoType } : {}),
          ...(manufacturer ? { manufacturer } : {}),
          ...(bodyType ? { bodyType } : {})
        });
      }
    }

    const summary = {
      dryRun: Boolean(body.dryRun),
      totalRows: body.rows.length,
      okRows: previewRows.filter((r) => r.ok).length,
      errorRows: previewRows.filter((r) => !r.ok).length
    };
    if (body.dryRun) return { ok: true, summary, rows: previewRows };
    const res = toCreate.length ? await app.prisma.aircraftType.createMany({ data: toCreate, skipDuplicates: true }) : { count: 0 };
    return { ok: true, summary, rows: previewRows, created: res.count, skipped: body.rows.length - res.count };
  });

  app.post("/", async (req) => {
    assertModelPermission(req as any, "AircraftType", "add");
    const body = z
      .object({
        icaoType: z.string().trim().min(2).max(25).optional(),
        name: z.string().trim().min(1).max(200),
        manufacturer: z.string().trim().min(1).max(200).optional(),
        bodyType: zBodyType,
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraftType.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertModelPermission(req as any, "AircraftType", "change");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        icaoType: z.string().trim().min(2).max(25).nullable().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        manufacturer: z.string().trim().min(1).max(200).nullable().optional(),
        bodyType: zBodyType,
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraftType.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertModelPermission(req as any, "AircraftType", "delete");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.aircraftType.delete({ where: { id } });
    return { ok: true };
  });
};

