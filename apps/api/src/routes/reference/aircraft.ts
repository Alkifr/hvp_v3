import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const aircraftRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    return await app.prisma.aircraft.findMany({
      include: { operator: true, type: true },
      orderBy: [{ isActive: "desc" }, { tailNumber: "asc" }]
    });
  });

  // Массовая загрузка бортов из CSV (UI читает файл и отправляет список строк)
  app.post("/import", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        dryRun: z.boolean().optional(),
        isActive: z.boolean().optional(),
        rows: z
          .array(
            z.object({
              tailNumber: z.string().optional(),
              operator: z.string().optional(),
              aircraftType: z.string().optional()
            })
          )
          .min(1)
          .max(5000)
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
    const tailKey = (s: unknown) => norm(s).toLocaleUpperCase("ru-RU");

    const [operators, aircraftTypes, existingAircraft] = await Promise.all([
      app.prisma.operator.findMany(),
      app.prisma.aircraftType.findMany(),
      app.prisma.aircraft.findMany({ select: { tailNumber: true } })
    ]);

    const operatorByKey = new Map<string, (typeof operators)[number]>();
    for (const op of operators) {
      operatorByKey.set(key(op.name), op);
      operatorByKey.set(key(op.code), op);
    }

    const typeByKey = new Map<string, (typeof aircraftTypes)[number]>();
    for (const type of aircraftTypes) {
      typeByKey.set(key(type.name), type);
      if (type.icaoType) typeByKey.set(key(type.icaoType), type);
    }

    const existingTails = new Set(existingAircraft.map((a) => tailKey(a.tailNumber)));
    const seenInFile = new Set<string>();
    const toCreate: Array<{ tailNumber: string; operatorId: string; typeId: string; isActive: boolean }> = [];
    const previewRows: Array<{
      rowIndex: number;
      ok: boolean;
      tailNumber: string;
      operator: string;
      aircraftType: string;
      error?: string;
    }> = [];

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i]!;
      const rowIndex = i + 2;
      const tailNumber = tailKey(row.tailNumber);
      const operatorRaw = norm(row.operator);
      const aircraftTypeRaw = norm(row.aircraftType);
      let error = "";

      if (!tailNumber) error = "Не указан tailNumber";
      else if (tailNumber.length < 2 || tailNumber.length > 32) error = "tailNumber должен быть от 2 до 32 символов";
      else if (seenInFile.has(tailNumber)) error = `Дубль в файле: ${tailNumber}`;
      else if (existingTails.has(tailNumber)) error = `Борт уже есть в справочнике: ${tailNumber}`;

      const operator = operatorByKey.get(key(operatorRaw));
      if (!error && !operatorRaw) error = "Не указан operator";
      if (!error && !operator) error = `Не найден оператор: ${operatorRaw}`;

      const aircraftType = typeByKey.get(key(aircraftTypeRaw));
      if (!error && !aircraftTypeRaw) error = "Не указан aircraftType";
      if (!error && !aircraftType) error = `Не найден тип ВС: ${aircraftTypeRaw}`;

      seenInFile.add(tailNumber);
      previewRows.push({
        rowIndex,
        ok: !error,
        tailNumber,
        operator: operatorRaw,
        aircraftType: aircraftTypeRaw,
        ...(error ? { error } : {})
      });

      if (!error && operator && aircraftType) {
        toCreate.push({
          tailNumber,
          operatorId: operator.id,
          typeId: aircraftType.id,
          isActive: body.isActive ?? true
        });
      }
    }

    const summary = {
      dryRun: Boolean(body.dryRun),
      totalRows: body.rows.length,
      okRows: previewRows.filter((r) => r.ok).length,
      errorRows: previewRows.filter((r) => !r.ok).length
    };

    if (body.dryRun) {
      return { ok: true, summary, rows: previewRows };
    }

    const res = toCreate.length
      ? await app.prisma.aircraft.createMany({
          data: toCreate,
          skipDuplicates: true
        })
      : { count: 0 };

    return {
      ok: true,
      summary,
      rows: previewRows,
      created: res.count,
      skipped: body.rows.length - res.count
    };
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        tailNumber: z.string().trim().min(2).max(32),
        serialNumber: z.string().trim().min(1).max(64).optional(),
        operatorId: zUuid,
        typeId: zUuid,
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraft.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        tailNumber: z.string().trim().min(2).max(32).optional(),
        serialNumber: z.string().trim().min(1).max(64).nullable().optional(),
        operatorId: zUuid.optional(),
        typeId: zUuid.optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);

    return await app.prisma.aircraft.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.aircraft.delete({ where: { id } });
    return { ok: true };
  });
};

