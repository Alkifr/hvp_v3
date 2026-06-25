import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();

type StandPayload = {
  code: string;
  name: string;
  sourceExcelRow: number;
  sourceAircraftType: string;
  aircraftTypeIcaoTypes: string[];
};

type LayoutPayload = {
  code: string;
  name: string;
  stands: StandPayload[];
};

type HangarPayload = {
  code: string;
  name: string;
  layouts: LayoutPayload[];
};

type ImportPayload = {
  source: {
    file: string;
    sheet: string;
    loadedRows: number;
    skippedRows: number;
  };
  hangars: HangarPayload[];
};

function naturalKey(value: string): Array<string | number> {
  return value.split(/(\d+)/).map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

function compareNatural(a: string, b: string): number {
  const ak = naturalKey(a);
  const bk = naturalKey(b);
  const len = Math.max(ak.length, bk.length);
  for (let i = 0; i < len; i++) {
    const av = ak[i];
    const bv = bk[i];
    if (av == null) return -1;
    if (bv == null) return 1;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function geometryForStand(index: number, total: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: 5 + col * 17,
    y: 5 + row * 11,
    w: 14,
    h: 8,
    rotate: 0
  };
}

async function main() {
  const dataPath = path.resolve(process.cwd(), "prisma/hangar-aircraft-type-layouts.json");
  const payload = JSON.parse(fs.readFileSync(dataPath, "utf8")) as ImportPayload;
  const summary = { hangars: 0, layouts: 0, stands: 0, rules: 0 };
  const aircraftTypeByIcao = new Map(
    (await prisma.aircraftType.findMany({ select: { id: true, icaoType: true } }))
      .filter((aircraftType) => aircraftType.icaoType)
      .map((aircraftType) => [aircraftType.icaoType!, aircraftType])
  );

  for (const h of payload.hangars) {
    const hangar = await prisma.hangar.upsert({
        where: { code: h.code },
        update: { name: h.name, isActive: true },
        create: { code: h.code, name: h.name, isActive: true }
      });
      summary.hangars += 1;

      for (const l of h.layouts) {
        const layout = await prisma.hangarLayout.upsert({
          where: { hangarId_code: { hangarId: hangar.id, code: l.code } },
          update: {
            name: l.name,
            description: `${payload.source.file} / ${payload.source.sheet}`,
            widthMeters: 80,
            heightMeters: 50,
            isActive: true
          },
          create: {
            hangarId: hangar.id,
            code: l.code,
            name: l.name,
            description: `${payload.source.file} / ${payload.source.sheet}`,
            widthMeters: 80,
            heightMeters: 50,
            isActive: true
          }
        });
        summary.layouts += 1;

        const sortedStands = [...l.stands].sort((a, b) => compareNatural(a.code, b.code));
        const importedCodes = new Set(sortedStands.map((s) => s.code));
        await prisma.hangarStand.updateMany({
          where: { layoutId: layout.id, code: { notIn: Array.from(importedCodes) } },
          data: { isActive: false }
        });

        for (let index = 0; index < sortedStands.length; index++) {
          const s = sortedStands[index]!;
          const geometry = geometryForStand(index, sortedStands.length);
          const stand = await prisma.hangarStand.upsert({
            where: { layoutId_code: { layoutId: layout.id, code: s.code } },
            update: {
              name: s.name,
              bodyType: null,
              ...geometry,
              isActive: true
            },
            create: {
              layoutId: layout.id,
              code: s.code,
              name: s.name,
              bodyType: null,
              ...geometry,
              isActive: true
            }
          });
          summary.stands += 1;

          await prisma.hangarStandAircraftType.deleteMany({ where: { standId: stand.id } });
          if (s.aircraftTypeIcaoTypes.length === 0) continue;

          const aircraftTypes = s.aircraftTypeIcaoTypes.map((icaoType) => aircraftTypeByIcao.get(icaoType)).filter(Boolean);
          const missing = s.aircraftTypeIcaoTypes.filter((icaoType) => !aircraftTypeByIcao.has(icaoType));
          if (missing.length > 0) {
            throw new Error(`${h.code}/${l.code}/${s.code}: не найдены типы ВС ${missing.join(", ")}`);
          }

          await prisma.hangarStandAircraftType.createMany({
            data: aircraftTypes.map((aircraftType) => ({ standId: stand.id, aircraftTypeId: aircraftType.id })),
            skipDuplicates: true
          });
          summary.rules += aircraftTypes.length;
        }
      }
  }

  console.log("Imported hangar aircraft-type layouts");
  console.log(JSON.stringify({ source: payload.source, ...summary }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
