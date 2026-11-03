CREATE TYPE "AircraftCheckKind" AS ENUM ('A', 'C');
CREATE TYPE "AircraftWorkshopChoice" AS ENUM ('FIXED', 'PRIMARY', 'ALTERNATE');

CREATE TABLE "AircraftWorkshopAssignment" (
  "id" TEXT NOT NULL,
  "aircraftId" TEXT NOT NULL,
  "checkKind" "AircraftCheckKind" NOT NULL,
  "workshopId" TEXT NOT NULL,
  "choice" "AircraftWorkshopChoice" NOT NULL DEFAULT 'FIXED',
  "dependsOnCustomerPlan" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AircraftWorkshopAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AircraftWorkshopAssignment_aircraftId_checkKind_workshopId_key"
  ON "AircraftWorkshopAssignment"("aircraftId", "checkKind", "workshopId");
CREATE INDEX "AircraftWorkshopAssignment_workshopId_checkKind_idx"
  ON "AircraftWorkshopAssignment"("workshopId", "checkKind");
CREATE INDEX "AircraftWorkshopAssignment_checkKind_choice_idx"
  ON "AircraftWorkshopAssignment"("checkKind", "choice");

CREATE TABLE "AircraftWorkshopHangar" (
  "assignmentId" TEXT NOT NULL,
  "hangarId" TEXT NOT NULL,
  CONSTRAINT "AircraftWorkshopHangar_pkey" PRIMARY KEY ("assignmentId", "hangarId")
);
CREATE INDEX "AircraftWorkshopHangar_hangarId_idx" ON "AircraftWorkshopHangar"("hangarId");

ALTER TABLE "AircraftWorkshopAssignment"
  ADD CONSTRAINT "AircraftWorkshopAssignment_aircraftId_fkey"
  FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AircraftWorkshopAssignment"
  ADD CONSTRAINT "AircraftWorkshopAssignment_workshopId_fkey"
  FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AircraftWorkshopHangar"
  ADD CONSTRAINT "AircraftWorkshopHangar_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "AircraftWorkshopAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AircraftWorkshopHangar"
  ADD CONSTRAINT "AircraftWorkshopHangar_hangarId_fkey"
  FOREIGN KEY ("hangarId") REFERENCES "Hangar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
