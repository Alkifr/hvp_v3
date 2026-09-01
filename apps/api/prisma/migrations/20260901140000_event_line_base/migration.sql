-- CreateEnum
CREATE TYPE "EventLineBase" AS ENUM ('LINE', 'BASE');

-- AlterTable
ALTER TABLE "Workshop" ADD COLUMN "defaultLineBase" "EventLineBase";

-- AlterTable
ALTER TABLE "MaintenanceEvent" ADD COLUMN "lineBase" "EventLineBase";

-- CreateIndex
CREATE INDEX "MaintenanceEvent_lineBase_idx" ON "MaintenanceEvent"("lineBase");

-- Backfill from workshop default when it is already set
UPDATE "MaintenanceEvent" AS e
SET "lineBase" = w."defaultLineBase"
FROM "Workshop" AS w
WHERE e."workshopId" = w.id
  AND e."lineBase" IS NULL
  AND w."defaultLineBase" IS NOT NULL;
