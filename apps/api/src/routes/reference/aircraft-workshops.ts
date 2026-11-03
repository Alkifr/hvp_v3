import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { importAircraftWorkshopRows, syncAircraftWorkshopCatalog } from "../../lib/aircraftWorkshopImport.js";
import { assertAnyPermission } from "../../lib/rbac.js";
import { zUuid } from "../../lib/zod.js";

const zCheck = z.enum(["A", "C"]);
const zChoice = z.enum(["FIXED", "PRIMARY", "ALTERNATE"]);

const assignmentInclude = {
  aircraft: { select: { id: true, tailNumber: true, type: { select: { id: true, name: true, icaoType: true } }, operator: { select: { id: true, name: true, code: true } } } },
  workshop: { select: { id: true, code: true, name: true } },
  hangars: { include: { hangar: { select: { id: true, code: true, name: true } } } }
} as const;

const groupBody = z.object({
  aircraftIds: z.array(zUuid).min(1).max(500),
  checkKind: zCheck,
  workshopId: zUuid,
  hangarIds: z.array(zUuid).max(8).default([]),
  choice: zChoice.default("FIXED"),
  dependsOnCustomerPlan: z.boolean().default(false),
  replace: z.object({
    aircraftIds: z.array(zUuid).min(1).max(500),
    checkKind: zCheck,
    workshopId: zUuid
  }).optional()
});

export const aircraftWorkshopRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertAnyPermission(req, ["ref:read", "personnel:read"]);
    const rows = await app.prisma.aircraftWorkshopAssignment.findMany({
      include: assignmentInclude,
      orderBy: [{ aircraft: { tailNumber: "asc" } }, { checkKind: "asc" }, { choice: "asc" }]
    });
    return rows.map(presentAssignment);
  });

  app.post("/sync", async (req) => {
    assertAnyPermission(req, ["ref:write", "personnel:write"]);
    const result = await syncAircraftWorkshopCatalog(app.prisma);
    return { ok: true, ...result };
  });

  app.post("/import", async (req) => {
    assertAnyPermission(req, ["ref:write", "personnel:write"]);
    const body = z
      .object({
        dryRun: z.boolean().optional(),
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000)
      })
      .parse(req.body);
    const result = await importAircraftWorkshopRows(app.prisma, body.rows, Boolean(body.dryRun));
    if (!result.ok) throw app.httpErrors.badRequest(result.error);
    return result;
  });

  app.post("/", async (req) => {
    assertAnyPermission(req, ["ref:write", "personnel:write"]);
    const body = z
      .object({
        aircraftId: zUuid,
        checkKind: zCheck,
        workshopId: zUuid,
        hangarIds: z.array(zUuid).max(8).default([]),
        choice: zChoice.default("FIXED"),
        dependsOnCustomerPlan: z.boolean().default(false),
        note: z.string().trim().max(500).nullable().optional()
      })
      .parse(req.body);
    const created = await app.prisma.aircraftWorkshopAssignment.create({
      data: {
        aircraftId: body.aircraftId,
        checkKind: body.checkKind,
        workshopId: body.workshopId,
        choice: body.choice,
        dependsOnCustomerPlan: body.dependsOnCustomerPlan,
        note: body.note ?? null,
        hangars: { create: body.hangarIds.map((hangarId) => ({ hangarId })) }
      },
      include: assignmentInclude
    });
    return presentAssignment(created);
  });

  app.post("/group", async (req) => {
    assertAnyPermission(req, ["ref:write", "personnel:write"]);
    const body = groupBody.parse(req.body);
    const aircraftIds = [...new Set(body.aircraftIds)];
    const hangarIds = [...new Set(body.hangarIds)];
    const known = await app.prisma.aircraft.findMany({ where: { id: { in: aircraftIds } }, select: { id: true } });
    if (known.length !== aircraftIds.length) throw app.httpErrors.badRequest("Неизвестный борт");
    const count = await app.prisma.$transaction(async (tx) => {
      if (body.replace) {
        const desired = new Set(aircraftIds);
        const moved = body.checkKind !== body.replace.checkKind || body.workshopId !== body.replace.workshopId;
        const removeIds = body.replace.aircraftIds.filter((id) => !desired.has(id) || moved);
        if (removeIds.length) {
          await tx.aircraftWorkshopAssignment.deleteMany({
            where: { aircraftId: { in: removeIds }, checkKind: body.replace.checkKind, workshopId: body.replace.workshopId }
          });
        }
      }
      const existing = await tx.aircraftWorkshopAssignment.findMany({
        where: { aircraftId: { in: aircraftIds }, checkKind: body.checkKind, workshopId: body.workshopId },
        select: { id: true, aircraftId: true }
      });
      const existingIds = new Set(existing.map((row) => row.aircraftId));
      const missing = aircraftIds.filter((id) => !existingIds.has(id));
      if (missing.length) {
        await tx.aircraftWorkshopAssignment.createMany({
          data: missing.map((aircraftId) => ({
            aircraftId,
            checkKind: body.checkKind,
            workshopId: body.workshopId,
            choice: body.choice,
            dependsOnCustomerPlan: body.dependsOnCustomerPlan
          }))
        });
      }
      if (existing.length) {
        await tx.aircraftWorkshopAssignment.updateMany({
          where: { id: { in: existing.map((row) => row.id) } },
          data: { choice: body.choice, dependsOnCustomerPlan: body.dependsOnCustomerPlan }
        });
      }
      const saved = await tx.aircraftWorkshopAssignment.findMany({
        where: { aircraftId: { in: aircraftIds }, checkKind: body.checkKind, workshopId: body.workshopId },
        select: { id: true }
      });
      await tx.aircraftWorkshopHangar.deleteMany({ where: { assignmentId: { in: saved.map((row) => row.id) } } });
      if (hangarIds.length && saved.length) {
        await tx.aircraftWorkshopHangar.createMany({
          data: saved.flatMap((row) => hangarIds.map((hangarId) => ({ assignmentId: row.id, hangarId })))
        });
      }
      return saved.length;
    }, { timeout: 60_000, maxWait: 10_000 });
    return { ok: true, count };
  });

  app.post("/group/delete", async (req) => {
    assertAnyPermission(req, ["ref:write", "personnel:write"]);
    const body = z.object({
      aircraftIds: z.array(zUuid).min(1).max(500),
      checkKind: zCheck,
      workshopId: zUuid
    }).parse(req.body);
    const result = await app.prisma.aircraftWorkshopAssignment.deleteMany({
      where: { aircraftId: { in: body.aircraftIds }, checkKind: body.checkKind, workshopId: body.workshopId }
    });
    return { ok: true, count: result.count };
  });

  app.patch("/:id", async (req) => {
    assertAnyPermission(req, ["ref:write", "personnel:write"]);
    const id = zUuid.parse((req.params as { id?: string }).id);
    const body = z
      .object({
        workshopId: zUuid.optional(),
        hangarIds: z.array(zUuid).max(8).optional(),
        choice: zChoice.optional(),
        dependsOnCustomerPlan: z.boolean().optional(),
        note: z.string().trim().max(500).nullable().optional()
      })
      .parse(req.body);
    const updated = await app.prisma.$transaction(async (tx) => {
      if (body.hangarIds) {
        await tx.aircraftWorkshopHangar.deleteMany({ where: { assignmentId: id } });
        if (body.hangarIds.length) {
          await tx.aircraftWorkshopHangar.createMany({
            data: body.hangarIds.map((hangarId) => ({ assignmentId: id, hangarId }))
          });
        }
      }
      return tx.aircraftWorkshopAssignment.update({
        where: { id },
        data: {
          ...(body.workshopId ? { workshopId: body.workshopId } : {}),
          ...(body.choice ? { choice: body.choice } : {}),
          ...(body.dependsOnCustomerPlan != null ? { dependsOnCustomerPlan: body.dependsOnCustomerPlan } : {}),
          ...(body.note !== undefined ? { note: body.note } : {})
        },
        include: assignmentInclude
      });
    }, { timeout: 30_000, maxWait: 10_000 });
    return presentAssignment(updated);
  });

  app.delete("/:id", async (req) => {
    assertAnyPermission(req, ["ref:write", "personnel:write"]);
    const id = zUuid.parse((req.params as { id?: string }).id);
    await app.prisma.aircraftWorkshopAssignment.delete({ where: { id } });
    return { ok: true };
  });
};

function presentAssignment(row: {
  id: string;
  checkKind: "A" | "C";
  choice: "FIXED" | "PRIMARY" | "ALTERNATE";
  dependsOnCustomerPlan: boolean;
  note: string | null;
  aircraft: { id: string; tailNumber: string; type: { id: string; name: string; icaoType: string | null }; operator: { id: string; name: string; code: string } };
  workshop: { id: string; code: string; name: string };
  hangars: Array<{ hangar: { id: string; code: string; name: string } }>;
}) {
  return {
    id: row.id,
    checkKind: row.checkKind,
    choice: row.choice,
    dependsOnCustomerPlan: row.dependsOnCustomerPlan,
    note: row.note,
    aircraft: {
      id: row.aircraft.id,
      tailNumber: row.aircraft.tailNumber,
      typeId: row.aircraft.type.id,
      typeName: row.aircraft.type.name || row.aircraft.type.icaoType || "—",
      operatorId: row.aircraft.operator.id,
      operatorName: row.aircraft.operator.name
    },
    workshop: row.workshop,
    hangars: row.hangars.map((link) => link.hangar)
  };
}
