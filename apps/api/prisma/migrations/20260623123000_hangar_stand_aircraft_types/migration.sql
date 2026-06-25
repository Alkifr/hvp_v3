-- CreateTable
CREATE TABLE "HangarStandAircraftType" (
    "standId" TEXT NOT NULL,
    "aircraftTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HangarStandAircraftType_pkey" PRIMARY KEY ("standId","aircraftTypeId")
);

-- CreateIndex
CREATE INDEX "HangarStandAircraftType_aircraftTypeId_idx" ON "HangarStandAircraftType"("aircraftTypeId");

-- AddForeignKey
ALTER TABLE "HangarStandAircraftType" ADD CONSTRAINT "HangarStandAircraftType_standId_fkey" FOREIGN KEY ("standId") REFERENCES "HangarStand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HangarStandAircraftType" ADD CONSTRAINT "HangarStandAircraftType_aircraftTypeId_fkey" FOREIGN KEY ("aircraftTypeId") REFERENCES "AircraftType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
