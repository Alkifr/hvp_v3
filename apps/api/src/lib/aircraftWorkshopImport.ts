import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  expandWorkshopAssignment,
  tailDigits,
  type AircraftWorkshopSourceRow
} from "./aircraftWorkshopCatalog.js";
import { classifyAircraftWorkshopImport, readWorkshopImportRecords } from "./aircraftWorkshopImportPlan.js";

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "aircraftWorkshopSource.json");

export function loadAircraftWorkshopSource(): AircraftWorkshopSourceRow[] {
  return JSON.parse(readFileSync(sourcePath, "utf8")) as AircraftWorkshopSourceRow[];
}

function hangarIdForCode(
  code: string,
  hangars: Array<{ id: string; code: string; name: string }>
) {
  const number = code.replace(/\D/g, "");
  return hangars.find(
    (hangar) =>
      hangar.code.toUpperCase() === `H${number}` ||
      hangar.code === number ||
      hangar.name.trim() === `Ангар ${number}`
  )?.id;
}

export async function syncAircraftWorkshopCatalog(prisma: PrismaClient) {
  const drafts = loadAircraftWorkshopSource().flatMap(expandWorkshopAssignment);
  const aircraft = await prisma.aircraft.findMany({ select: { id: true, tailNumber: true } });
  const hangars = await prisma.hangar.findMany({ select: { id: true, code: true, name: true } });
  const existingWorkshops = await prisma.workshop.findMany({ select: { id: true, code: true } });
  const workshopByCode = new Map(existingWorkshops.map((row) => [row.code.toUpperCase(), row]));
  const missingCodes = [...new Set(drafts.map((row) => row.workshopCode))].filter(
    (code) => !workshopByCode.has(code.toUpperCase())
  );
  if (missingCodes.length) {
    await prisma.workshop.createMany({
      data: missingCodes.map((code) => ({ code, name: code })),
      skipDuplicates: true
    });
    const created = await prisma.workshop.findMany({
      where: { code: { in: missingCodes } },
      select: { id: true, code: true }
    });
    for (const row of created) workshopByCode.set(row.code.toUpperCase(), row);
  }

  const byTail = new Map<string, string>();
  for (const row of aircraft) {
    const digits = tailDigits(row.tailNumber);
    if (digits && !byTail.has(digits)) byTail.set(digits, row.id);
  }

  const wanted = new Map<
    string,
    {
      aircraftId: string;
      checkKind: "A" | "C";
      workshopId: string;
      choice: "FIXED" | "PRIMARY" | "ALTERNATE";
      dependsOnCustomerPlan: boolean;
      note: string | null;
      hangarIds: string[];
    }
  >();
  let skipped = 0;
  for (const draft of drafts) {
    const aircraftId = byTail.get(tailDigits(draft.tail));
    const workshop = workshopByCode.get(draft.workshopCode.toUpperCase());
    if (!aircraftId || !workshop) {
      skipped += 1;
      continue;
    }
    const key = `${aircraftId}|${draft.check}|${workshop.id}`;
    wanted.set(key, {
      aircraftId,
      checkKind: draft.check,
      workshopId: workshop.id,
      choice: draft.choice,
      dependsOnCustomerPlan: draft.dependsOnCustomerPlan,
      note: draft.note,
      hangarIds: [...new Set(draft.hangarCodes.map((code) => hangarIdForCode(code, hangars)).filter((id): id is string => Boolean(id)))]
    });
  }

  const rows = [...wanted.values()];
  await prisma.$transaction(
    async (tx) => {
      await tx.aircraftWorkshopHangar.deleteMany();
      await tx.aircraftWorkshopAssignment.deleteMany();
      const created = rows.length
        ? await tx.aircraftWorkshopAssignment.createManyAndReturn({
            data: rows.map(({ hangarIds: _hangarIds, ...row }) => row)
          })
        : [];
      const idByKey = new Map(created.map((row) => [`${row.aircraftId}|${row.checkKind}|${row.workshopId}`, row.id]));
      const links: Prisma.AircraftWorkshopHangarCreateManyInput[] = [];
      for (const row of rows) {
        const assignmentId = idByKey.get(`${row.aircraftId}|${row.checkKind}|${row.workshopId}`);
        if (!assignmentId) continue;
        for (const hangarId of row.hangarIds) links.push({ assignmentId, hangarId });
      }
      if (links.length) await tx.aircraftWorkshopHangar.createMany({ data: links });
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  return {
    assignments: rows.length,
    skipped,
    workshopsCreated: missingCodes
  };
}

export async function importAircraftWorkshopRows(
  prisma: PrismaClient,
  records: Array<Record<string, unknown>>,
  dryRun: boolean
) {
  const read = readWorkshopImportRecords(records);
  if ("error" in read) return { ok: false as const, error: read.error };
  const [aircraft, workshops, hangars, existing] = await Promise.all([
    prisma.aircraft.findMany({
      select: {
        id: true,
        tailNumber: true,
        type: { select: { name: true, icaoType: true } },
        operator: { select: { name: true, code: true } }
      }
    }),
    prisma.workshop.findMany({ select: { id: true, code: true, name: true } }),
    prisma.hangar.findMany({ select: { id: true, code: true, name: true } }),
    prisma.aircraftWorkshopAssignment.findMany({
      select: {
        aircraftId: true,
        checkKind: true,
        workshopId: true,
        choice: true,
        dependsOnCustomerPlan: true,
        note: true,
        hangars: { select: { hangarId: true } }
      }
    })
  ]);
  const classified = classifyAircraftWorkshopImport({
    rows: read.rows,
    aircraft: aircraft.map((row) => ({
      id: row.id,
      tailNumber: row.tailNumber,
      typeName: row.type?.name ?? "",
      icaoType: row.type?.icaoType ?? null,
      operatorName: row.operator?.name ?? "",
      operatorCode: row.operator?.code ?? ""
    })),
    workshops,
    hangars,
    existing: existing.map((row) => ({
      aircraftId: row.aircraftId,
      checkKind: row.checkKind,
      workshopId: row.workshopId,
      choice: row.choice,
      dependsOnCustomerPlan: row.dependsOnCustomerPlan,
      note: row.note,
      hangarIds: row.hangars.map((link) => link.hangarId)
    }))
  });
  const summary = { ...classified.summary, dryRun };
  if (dryRun) return { ok: true as const, summary, rows: classified.rows };

  if (classified.summary.workshopsToCreate.length) {
    await prisma.workshop.createMany({
      data: classified.summary.workshopsToCreate.map((code) => ({ code, name: code })),
      skipDuplicates: true
    });
  }
  const workshopIds = new Map(
    (await prisma.workshop.findMany({ select: { id: true, code: true } })).map((row) => [row.code.toUpperCase(), row.id])
  );
  if (classified.actions.length) {
    await prisma.$transaction(
      async (tx) => {
        for (const action of classified.actions) {
          const workshopId = workshopIds.get(action.workshopCode.toUpperCase());
          if (!workshopId) throw new Error(`Цех не найден: ${action.workshopCode}`);
          const current = await tx.aircraftWorkshopAssignment.findFirst({
            where: { aircraftId: action.aircraftId, checkKind: action.checkKind, workshopId },
            select: { id: true }
          });
          const saved = current
            ? await tx.aircraftWorkshopAssignment.update({
                where: { id: current.id },
                data: {
                  choice: action.choice,
                  dependsOnCustomerPlan: action.dependsOnCustomerPlan,
                  note: action.note
                },
                select: { id: true }
              })
            : await tx.aircraftWorkshopAssignment.create({
                data: {
                  aircraftId: action.aircraftId,
                  checkKind: action.checkKind,
                  workshopId,
                  choice: action.choice,
                  dependsOnCustomerPlan: action.dependsOnCustomerPlan,
                  note: action.note
                },
                select: { id: true }
              });
          await tx.aircraftWorkshopHangar.deleteMany({ where: { assignmentId: saved.id } });
          if (action.hangarIds.length) {
            await tx.aircraftWorkshopHangar.createMany({
              data: [...new Set(action.hangarIds)].map((hangarId) => ({ assignmentId: saved.id, hangarId }))
            });
          }
        }
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
  }
  return {
    ok: true as const,
    summary,
    rows: classified.rows,
    created: classified.actions.filter((row) => row.mode === "create").length,
    updated: classified.actions.filter((row) => row.mode === "update").length,
    workshopsCreated: classified.summary.workshopsToCreate
  };
}
