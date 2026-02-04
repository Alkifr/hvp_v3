-- CreateTable
CREATE TABLE "AircraftTypePalette" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "aircraftTypeId" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AircraftTypePalette_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AircraftTypePalette_operatorId_idx" ON "AircraftTypePalette"("operatorId");

-- CreateIndex
CREATE INDEX "AircraftTypePalette_aircraftTypeId_idx" ON "AircraftTypePalette"("aircraftTypeId");

-- CreateIndex
CREATE INDEX "AircraftTypePalette_isActive_idx" ON "AircraftTypePalette"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AircraftTypePalette_operatorId_aircraftTypeId_key" ON "AircraftTypePalette"("operatorId", "aircraftTypeId");

-- AddForeignKey
ALTER TABLE "AircraftTypePalette" ADD CONSTRAINT "AircraftTypePalette_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftTypePalette" ADD CONSTRAINT "AircraftTypePalette_aircraftTypeId_fkey" FOREIGN KEY ("aircraftTypeId") REFERENCES "AircraftType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

