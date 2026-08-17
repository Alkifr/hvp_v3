import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();

async function main() {
  const raw = process.env.DATABASE_CLOUD_URL ?? "";
  console.log("DATABASE_CLOUD_URL:", raw.replace(/:([^:@/?#]+)@/, ":***@"));

  const counts = {
    operator: await prisma.operator.count(),
    aircraftType: await prisma.aircraftType.count(),
    aircraft: await prisma.aircraft.count(),
    eventType: await prisma.eventType.count(),
    hangar: await prisma.hangar.count(),
    layout: await prisma.hangarLayout.count(),
    stand: await prisma.hangarStand.count(),
    event: await prisma.maintenanceEvent.count(),
    placement: await prisma.eventPlacement.count(),
    reservation: await prisma.standReservation.count()
  };

  console.table(counts);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

