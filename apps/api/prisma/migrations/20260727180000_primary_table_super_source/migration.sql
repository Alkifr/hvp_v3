-- CreateEnum
CREATE TYPE "PrimaryMetricBlock" AS ENUM (
  'WP_PLAN_MPS',
  'WP_ACTUAL',
  'FIXED_COST_PLAN',
  'TM_PLAN',
  'ACCESS_LABOR_PLAN',
  'NRC_PLAN',
  'ADD_PLAN',
  'FIXED_COST_ACTUAL',
  'TM_ACTUAL',
  'NRC_ACTUAL',
  'ADD_ACTUAL',
  'LABOR_BUDGET'
);

CREATE TYPE "PrimaryMetricDepartment" AS ENUM ('ME', 'AV', 'INT', 'NDT', 'SHOP', 'CAB_REP');
CREATE TYPE "PrimaryMetricSource" AS ENUM ('MANUAL', 'IMPORT', 'MPS', 'SAP');

-- Core primary-table extensions
CREATE TABLE "EventPrimaryExtension" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sandboxId" TEXT,
  "fleetCode" TEXT,
  "externalExecution" BOOLEAN,
  "normalizedForm" TEXT,
  "normalizedFormDetail" TEXT,
  "stationCode" TEXT,
  "phaseKind" TEXT,
  "agreementStatus" TEXT,
  "iiCCheckFact" BOOLEAN,
  "wpNumberFact" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventPrimaryExtension_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventCustomerSlot" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sandboxId" TEXT,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "dlFlag" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventCustomerSlot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventSlotDeviation" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sandboxId" TEXT,
  "kind" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventSlotDeviation_pkey" PRIMARY KEY ("id")
);

-- Typed metric matrix
CREATE TABLE "EventReportMetric" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sandboxId" TEXT,
  "block" "PrimaryMetricBlock" NOT NULL,
  "department" "PrimaryMetricDepartment" NOT NULL,
  "manHours" DECIMAL(18,4),
  "costAmount" DECIMAL(18,4),
  "currency" TEXT,
  "source" "PrimaryMetricSource" NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventReportMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventReportScalar" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sandboxId" TEXT,
  "metricKey" TEXT NOT NULL,
  "valueNum" DECIMAL(18,4),
  "valueText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventReportScalar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventPtoRollingEntry" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sandboxId" TEXT,
  "externalKey" TEXT,
  "status" TEXT,
  "kippHours" DECIMAL(18,4),
  "laborTotal" DECIMAL(18,4),
  "amount" DECIMAL(18,4),
  "category" TEXT,
  "comments" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventPtoRollingEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventACheckAnalysis" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sandboxId" TEXT,
  "status" TEXT,
  "quantity" INTEGER,
  "program" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventACheckAnalysis_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "EventPrimaryExtension_eventId_key" ON "EventPrimaryExtension"("eventId");
CREATE INDEX "EventPrimaryExtension_sandboxId_idx" ON "EventPrimaryExtension"("sandboxId");
CREATE INDEX "EventPrimaryExtension_fleetCode_idx" ON "EventPrimaryExtension"("fleetCode");
CREATE INDEX "EventPrimaryExtension_normalizedForm_idx" ON "EventPrimaryExtension"("normalizedForm");

CREATE UNIQUE INDEX "EventCustomerSlot_eventId_key" ON "EventCustomerSlot"("eventId");
CREATE INDEX "EventCustomerSlot_sandboxId_idx" ON "EventCustomerSlot"("sandboxId");
CREATE INDEX "EventCustomerSlot_startAt_endAt_idx" ON "EventCustomerSlot"("startAt", "endAt");

CREATE UNIQUE INDEX "EventSlotDeviation_eventId_kind_key" ON "EventSlotDeviation"("eventId", "kind");
CREATE INDEX "EventSlotDeviation_sandboxId_idx" ON "EventSlotDeviation"("sandboxId");
CREATE INDEX "EventSlotDeviation_kind_idx" ON "EventSlotDeviation"("kind");

CREATE UNIQUE INDEX "EventReportMetric_eventId_block_department_key"
  ON "EventReportMetric"("eventId", "block", "department");
CREATE INDEX "EventReportMetric_sandboxId_block_idx" ON "EventReportMetric"("sandboxId", "block");
CREATE INDEX "EventReportMetric_eventId_idx" ON "EventReportMetric"("eventId");

CREATE UNIQUE INDEX "EventReportScalar_eventId_metricKey_key" ON "EventReportScalar"("eventId", "metricKey");
CREATE INDEX "EventReportScalar_sandboxId_metricKey_idx" ON "EventReportScalar"("sandboxId", "metricKey");
CREATE INDEX "EventReportScalar_eventId_idx" ON "EventReportScalar"("eventId");

CREATE INDEX "EventPtoRollingEntry_eventId_idx" ON "EventPtoRollingEntry"("eventId");
CREATE INDEX "EventPtoRollingEntry_sandboxId_idx" ON "EventPtoRollingEntry"("sandboxId");
CREATE INDEX "EventPtoRollingEntry_externalKey_idx" ON "EventPtoRollingEntry"("externalKey");

CREATE UNIQUE INDEX "EventACheckAnalysis_eventId_key" ON "EventACheckAnalysis"("eventId");
CREATE INDEX "EventACheckAnalysis_sandboxId_idx" ON "EventACheckAnalysis"("sandboxId");
CREATE INDEX "MaintenanceEvent_sandboxId_startAt_id_idx" ON "MaintenanceEvent"("sandboxId", "startAt", "id");

-- Foreign keys
ALTER TABLE "EventPrimaryExtension" ADD CONSTRAINT "EventPrimaryExtension_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPrimaryExtension" ADD CONSTRAINT "EventPrimaryExtension_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventCustomerSlot" ADD CONSTRAINT "EventCustomerSlot_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCustomerSlot" ADD CONSTRAINT "EventCustomerSlot_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventSlotDeviation" ADD CONSTRAINT "EventSlotDeviation_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventSlotDeviation" ADD CONSTRAINT "EventSlotDeviation_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventReportMetric" ADD CONSTRAINT "EventReportMetric_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventReportMetric" ADD CONSTRAINT "EventReportMetric_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventReportScalar" ADD CONSTRAINT "EventReportScalar_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventReportScalar" ADD CONSTRAINT "EventReportScalar_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventPtoRollingEntry" ADD CONSTRAINT "EventPtoRollingEntry_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPtoRollingEntry" ADD CONSTRAINT "EventPtoRollingEntry_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventACheckAnalysis" ADD CONSTRAINT "EventACheckAnalysis_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventACheckAnalysis" ADD CONSTRAINT "EventACheckAnalysis_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
