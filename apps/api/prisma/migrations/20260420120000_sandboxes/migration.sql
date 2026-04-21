-- Sandbox plans feature
-- Добавляет изолированные «песочницы» плана: копии событий + связанных сущностей
-- с собственным sandboxId. Прод = sandboxId IS NULL.

-- CreateEnum
CREATE TYPE "SandboxMemberRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateTable: Sandbox
CREATE TABLE "Sandbox" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sandbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Sandbox_ownerId_idx" ON "Sandbox"("ownerId");
ALTER TABLE "Sandbox" ADD CONSTRAINT "Sandbox_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: SandboxMember
CREATE TABLE "SandboxMember" (
    "sandboxId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SandboxMemberRole" NOT NULL DEFAULT 'EDITOR',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SandboxMember_pkey" PRIMARY KEY ("sandboxId", "userId")
);
CREATE INDEX "SandboxMember_userId_idx" ON "SandboxMember"("userId");
ALTER TABLE "SandboxMember" ADD CONSTRAINT "SandboxMember_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxMember" ADD CONSTRAINT "SandboxMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: добавляем sandboxId во все пер-планные таблицы + индексы + FK cascade
ALTER TABLE "MaintenanceEvent" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "MaintenanceEvent_sandboxId_idx" ON "MaintenanceEvent"("sandboxId");
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StandReservation" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "StandReservation_sandboxId_idx" ON "StandReservation"("sandboxId");
ALTER TABLE "StandReservation" ADD CONSTRAINT "StandReservation_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventTow" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "EventTow_sandboxId_idx" ON "EventTow"("sandboxId");
ALTER TABLE "EventTow" ADD CONSTRAINT "EventTow_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaintenanceEventAudit" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "MaintenanceEventAudit_sandboxId_idx" ON "MaintenanceEventAudit"("sandboxId");
ALTER TABLE "MaintenanceEventAudit" ADD CONSTRAINT "MaintenanceEventAudit_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventWorkPlanLine" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "EventWorkPlanLine_sandboxId_idx" ON "EventWorkPlanLine"("sandboxId");
ALTER TABLE "EventWorkPlanLine" ADD CONSTRAINT "EventWorkPlanLine_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventWorkActualLine" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "EventWorkActualLine_sandboxId_idx" ON "EventWorkActualLine"("sandboxId");
ALTER TABLE "EventWorkActualLine" ADD CONSTRAINT "EventWorkActualLine_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeEntry" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "TimeEntry_sandboxId_idx" ON "TimeEntry"("sandboxId");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialReservation" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "MaterialReservation_sandboxId_idx" ON "MaterialReservation"("sandboxId");
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialIssue" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "MaterialIssue_sandboxId_idx" ON "MaterialIssue"("sandboxId");
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD COLUMN "sandboxId" TEXT;
CREATE INDEX "StockMovement_sandboxId_idx" ON "StockMovement"("sandboxId");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sandboxId_fkey"
  FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
