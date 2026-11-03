CREATE TYPE "PersonnelCategoryCode" AS ENUM (
  'B1', 'LBMM', 'B2', 'LBMA', 'AM', 'SM', 'NDT', 'SHOP', 'INT', 'CAB_REP', 'PAINT'
);
CREATE TYPE "PersonnelAuthorizationGroup" AS ENUM ('ME', 'AV', 'SHARED', 'DIRECT');

CREATE TABLE "PersonnelCategory" (
  "code" "PersonnelCategoryCode" NOT NULL,
  "name" TEXT NOT NULL,
  "authorizationGroup" "PersonnelAuthorizationGroup" NOT NULL,
  "department" "PrimaryMetricDepartment",
  "isAuthorized" BOOLEAN NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelCategory_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "PersonnelWorkshopCategory" (
  "workshopId" TEXT NOT NULL,
  "categoryCode" "PersonnelCategoryCode" NOT NULL,
  "department" "PrimaryMetricDepartment",
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelWorkshopCategory_pkey" PRIMARY KEY ("workshopId", "categoryCode")
);
CREATE INDEX "PersonnelWorkshopCategory_categoryCode_idx" ON "PersonnelWorkshopCategory"("categoryCode");

CREATE TABLE "PersonnelAvailability" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "workshopId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "aircraftTypeId" TEXT NOT NULL,
  "categoryCode" "PersonnelCategoryCode" NOT NULL,
  "headcount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelAvailability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonnelAvailability_date_workshopId_shiftId_aircraftTypeId_categoryCode_key"
  ON "PersonnelAvailability"("date", "workshopId", "shiftId", "aircraftTypeId", "categoryCode");
CREATE INDEX "PersonnelAvailability_workshopId_date_idx" ON "PersonnelAvailability"("workshopId", "date");
CREATE INDEX "PersonnelAvailability_aircraftTypeId_date_idx" ON "PersonnelAvailability"("aircraftTypeId", "date");

CREATE TABLE "PersonnelHoursNorm" (
  "id" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "hours" DECIMAL(8,3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelHoursNorm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonnelHoursNorm_effectiveFrom_key" ON "PersonnelHoursNorm"("effectiveFrom");

CREATE TABLE "PersonnelAircraftTypeMpsFactor" (
  "id" TEXT NOT NULL,
  "aircraftTypeId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "factor" DECIMAL(8,4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelAircraftTypeMpsFactor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonnelAircraftTypeMpsFactor_aircraftTypeId_effectiveFrom_key"
  ON "PersonnelAircraftTypeMpsFactor"("aircraftTypeId", "effectiveFrom");
CREATE INDEX "PersonnelAircraftTypeMpsFactor_aircraftTypeId_effectiveFrom_idx"
  ON "PersonnelAircraftTypeMpsFactor"("aircraftTypeId", "effectiveFrom");

CREATE TABLE "PersonnelPlanningWeek" (
  "id" TEXT NOT NULL,
  "workshopId" TEXT NOT NULL,
  "weekStart" DATE NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "isLocked" BOOLEAN NOT NULL DEFAULT false,
  "lockedAt" TIMESTAMP(3),
  "lockedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelPlanningWeek_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonnelPlanningWeek_workshopId_weekStart_key"
  ON "PersonnelPlanningWeek"("workshopId", "weekStart");
CREATE INDEX "PersonnelPlanningWeek_weekStart_isLocked_idx" ON "PersonnelPlanningWeek"("weekStart", "isLocked");

CREATE TABLE "PersonnelPlanningSnapshot" (
  "id" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelPlanningSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonnelPlanningSnapshot_weekId_version_key"
  ON "PersonnelPlanningSnapshot"("weekId", "version");
CREATE INDEX "PersonnelPlanningSnapshot_createdAt_idx" ON "PersonnelPlanningSnapshot"("createdAt");

ALTER TABLE "PersonnelWorkshopCategory" ADD CONSTRAINT "PersonnelWorkshopCategory_workshopId_fkey"
  FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelWorkshopCategory" ADD CONSTRAINT "PersonnelWorkshopCategory_categoryCode_fkey"
  FOREIGN KEY ("categoryCode") REFERENCES "PersonnelCategory"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelAvailability" ADD CONSTRAINT "PersonnelAvailability_workshopId_fkey"
  FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelAvailability" ADD CONSTRAINT "PersonnelAvailability_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonnelAvailability" ADD CONSTRAINT "PersonnelAvailability_aircraftTypeId_fkey"
  FOREIGN KEY ("aircraftTypeId") REFERENCES "AircraftType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonnelAvailability" ADD CONSTRAINT "PersonnelAvailability_categoryCode_fkey"
  FOREIGN KEY ("categoryCode") REFERENCES "PersonnelCategory"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonnelAircraftTypeMpsFactor" ADD CONSTRAINT "PersonnelAircraftTypeMpsFactor_aircraftTypeId_fkey"
  FOREIGN KEY ("aircraftTypeId") REFERENCES "AircraftType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelPlanningWeek" ADD CONSTRAINT "PersonnelPlanningWeek_workshopId_fkey"
  FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelPlanningWeek" ADD CONSTRAINT "PersonnelPlanningWeek_lockedById_fkey"
  FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonnelPlanningSnapshot" ADD CONSTRAINT "PersonnelPlanningSnapshot_weekId_fkey"
  FOREIGN KEY ("weekId") REFERENCES "PersonnelPlanningWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelPlanningSnapshot" ADD CONSTRAINT "PersonnelPlanningSnapshot_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PersonnelCategory"
  ("code", "name", "authorizationGroup", "department", "isAuthorized", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('B1', 'B1', 'ME', 'ME', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('LBMM', 'LBMM', 'ME', 'ME', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('B2', 'B2', 'AV', 'AV', true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('LBMA', 'LBMA', 'AV', 'AV', true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AM', 'AM', 'SHARED', NULL, false, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('SM', 'SM', 'SHARED', NULL, false, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('NDT', 'NDT', 'DIRECT', 'NDT', true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('SHOP', 'SHOP', 'DIRECT', 'SHOP', true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('INT', 'INT', 'DIRECT', 'INT', true, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CAB_REP', 'CabRep', 'DIRECT', 'CAB_REP', true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('PAINT', 'Paint', 'DIRECT', 'PAINT', true, 110, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "PersonnelWorkshopCategory" ("workshopId", "categoryCode", "department", "createdAt", "updatedAt")
SELECT w."id", c."code", c."department", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Workshop" w
JOIN "PersonnelCategory" c ON (
  ((UPPER(w."code") = 'PTO' OR UPPER(w."name") LIKE '%ПТО%') AND c."code" IN ('B1', 'LBMM', 'B2', 'LBMA', 'AM', 'SM')) OR
  ((UPPER(w."code") = 'SDRK' OR UPPER(w."name") LIKE '%СДРК%') AND c."code" IN ('NDT', 'SHOP')) OR
  ((UPPER(w."code") = 'SOIO' OR UPPER(w."name") LIKE '%СОИО%') AND c."code" = 'INT') OR
  ((UPPER(w."code") = 'CRIO' OR UPPER(w."name") LIKE '%ЦРИО%') AND c."code" = 'CAB_REP') OR
  ((UPPER(w."code") = 'LKP' OR UPPER(w."name") LIKE '%ЛКП%') AND c."code" = 'PAINT')
)
ON CONFLICT ("workshopId", "categoryCode") DO NOTHING;

INSERT INTO "PersonnelHoursNorm" ("id", "effectiveFrom", "hours", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000011', DATE '1970-01-01', 11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("effectiveFrom") DO NOTHING;
