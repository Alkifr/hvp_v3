CREATE TABLE "PersonnelAvailabilityChange" (
  "id" TEXT NOT NULL,
  "workshopId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "shiftId" TEXT NOT NULL,
  "aircraftTypeId" TEXT NOT NULL,
  "categoryCode" TEXT NOT NULL,
  "skillId" TEXT,
  "headcountFrom" INTEGER,
  "headcountTo" INTEGER,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelAvailabilityChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonnelAvailabilityChange_workshopId_createdAt_idx"
  ON "PersonnelAvailabilityChange"("workshopId", "createdAt");
CREATE INDEX "PersonnelAvailabilityChange_workshopId_date_idx"
  ON "PersonnelAvailabilityChange"("workshopId", "date");

ALTER TABLE "PersonnelAvailabilityChange"
  ADD CONSTRAINT "PersonnelAvailabilityChange_workshopId_fkey"
  FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelAvailabilityChange"
  ADD CONSTRAINT "PersonnelAvailabilityChange_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
