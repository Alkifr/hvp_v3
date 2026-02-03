import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // eslint-disable-next-line no-console
  console.log("DATABASE_URL:", process.env.DATABASE_URL);

  const counts = {
    operator: await prisma.operator.count(),
    aircraftType: await prisma.aircraftType.count(),
    aircraft: await prisma.aircraft.count(),
    eventType: await prisma.eventType.count(),
    hangar: await prisma.hangar.count(),
    layout: await prisma.hangarLayout.count(),
    stand: await prisma.hangarStand.count(),
    event: await prisma.maintenanceEvent.count(),
    reservation: await prisma.standReservation.count()
  };

  // eslint-disable-next-line no-console
  console.table(counts);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

