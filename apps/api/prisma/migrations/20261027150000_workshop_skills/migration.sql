CREATE TABLE "WorkshopSkill" (
  "workshopId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkshopSkill_pkey" PRIMARY KEY ("workshopId", "skillId")
);
CREATE INDEX "WorkshopSkill_skillId_idx" ON "WorkshopSkill"("skillId");

ALTER TABLE "WorkshopSkill"
  ADD CONSTRAINT "WorkshopSkill_workshopId_fkey"
  FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopSkill"
  ADD CONSTRAINT "WorkshopSkill_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonnelAvailability" ALTER COLUMN "categoryCode" DROP NOT NULL;
ALTER TABLE "PersonnelAvailability" ADD COLUMN "skillId" TEXT;
CREATE UNIQUE INDEX "PersonnelAvailability_date_workshopId_shiftId_aircraftTypeId_skillId_key"
  ON "PersonnelAvailability"("date", "workshopId", "shiftId", "aircraftTypeId", "skillId");
ALTER TABLE "PersonnelAvailability"
  ADD CONSTRAINT "PersonnelAvailability_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
