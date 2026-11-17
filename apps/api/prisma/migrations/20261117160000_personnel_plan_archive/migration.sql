CREATE TABLE "PersonnelPlanArchive" (
  "id" TEXT NOT NULL,
  "weekStart" DATE NOT NULL,
  "periodFrom" DATE NOT NULL,
  "periodTo" DATE NOT NULL,
  "title" TEXT NOT NULL,
  "workshopLabel" TEXT NOT NULL,
  "eventCount" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelPlanArchive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonnelPlanArchive_createdAt_idx" ON "PersonnelPlanArchive"("createdAt");
CREATE INDEX "PersonnelPlanArchive_weekStart_idx" ON "PersonnelPlanArchive"("weekStart");

ALTER TABLE "PersonnelPlanArchive" ADD CONSTRAINT "PersonnelPlanArchive_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
