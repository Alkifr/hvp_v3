import type { PrismaClient } from "@prisma/client";

import { EDGE_TOW_NORM_CODE, EDGE_TOW_NORM_MINUTES, EDGE_TOW_NORM_NAME } from "./edgeTows.js";

type TowNormClient = Pick<PrismaClient, "towNorm">;

export async function ensureTowNorms(prisma: TowNormClient) {
  await prisma.towNorm.upsert({
    where: { code: EDGE_TOW_NORM_CODE },
    update: {},
    create: {
      code: EDGE_TOW_NORM_CODE,
      name: EDGE_TOW_NORM_NAME,
      minutes: EDGE_TOW_NORM_MINUTES,
      isActive: true
    }
  });
}
