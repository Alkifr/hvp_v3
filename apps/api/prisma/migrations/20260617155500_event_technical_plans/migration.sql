-- CreateEnum
CREATE TYPE "TechnicalPlanStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TechnicalNeedCategory" AS ENUM ('PERSONNEL', 'MATERIAL', 'TOOL', 'DOCUMENTATION', 'EQUIPMENT', 'CONTRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "TechnicalNeedStatus" AS ENUM ('NEEDED', 'REQUESTED', 'IN_PROGRESS', 'READY', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TechnicalStepStatus" AS ENUM ('NOT_STARTED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "EventTechnicalPlan" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sandboxId" TEXT,
    "status" "TechnicalPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "leadEngineer" TEXT,
    "readinessPct" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTechnicalPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTechnicalNeed" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sandboxId" TEXT,
    "category" "TechnicalNeedCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" TEXT,
    "requiredAt" TIMESTAMP(3),
    "responsible" TEXT,
    "status" "TechnicalNeedStatus" NOT NULL DEFAULT 'NEEDED',
    "isBlocker" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTechnicalNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTechnicalStep" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sandboxId" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "responsible" TEXT,
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "status" "TechnicalStepStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "isBlocker" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTechnicalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTechnicalStepDependency" (
    "predecessorStepId" TEXT NOT NULL,
    "successorStepId" TEXT NOT NULL,

    CONSTRAINT "EventTechnicalStepDependency_pkey" PRIMARY KEY ("predecessorStepId","successorStepId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventTechnicalPlan_eventId_key" ON "EventTechnicalPlan"("eventId");

-- CreateIndex
CREATE INDEX "EventTechnicalPlan_sandboxId_idx" ON "EventTechnicalPlan"("sandboxId");

-- CreateIndex
CREATE INDEX "EventTechnicalPlan_status_idx" ON "EventTechnicalPlan"("status");

-- CreateIndex
CREATE INDEX "EventTechnicalNeed_planId_idx" ON "EventTechnicalNeed"("planId");

-- CreateIndex
CREATE INDEX "EventTechnicalNeed_sandboxId_idx" ON "EventTechnicalNeed"("sandboxId");

-- CreateIndex
CREATE INDEX "EventTechnicalNeed_status_idx" ON "EventTechnicalNeed"("status");

-- CreateIndex
CREATE INDEX "EventTechnicalNeed_category_idx" ON "EventTechnicalNeed"("category");

-- CreateIndex
CREATE INDEX "EventTechnicalStep_planId_seq_idx" ON "EventTechnicalStep"("planId", "seq");

-- CreateIndex
CREATE INDEX "EventTechnicalStep_sandboxId_idx" ON "EventTechnicalStep"("sandboxId");

-- CreateIndex
CREATE INDEX "EventTechnicalStep_status_idx" ON "EventTechnicalStep"("status");

-- CreateIndex
CREATE INDEX "EventTechnicalStepDependency_successorStepId_idx" ON "EventTechnicalStepDependency"("successorStepId");

-- AddForeignKey
ALTER TABLE "EventTechnicalPlan" ADD CONSTRAINT "EventTechnicalPlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTechnicalPlan" ADD CONSTRAINT "EventTechnicalPlan_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTechnicalNeed" ADD CONSTRAINT "EventTechnicalNeed_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EventTechnicalPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTechnicalNeed" ADD CONSTRAINT "EventTechnicalNeed_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTechnicalStep" ADD CONSTRAINT "EventTechnicalStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EventTechnicalPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTechnicalStep" ADD CONSTRAINT "EventTechnicalStep_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTechnicalStepDependency" ADD CONSTRAINT "EventTechnicalStepDependency_predecessorStepId_fkey" FOREIGN KEY ("predecessorStepId") REFERENCES "EventTechnicalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTechnicalStepDependency" ADD CONSTRAINT "EventTechnicalStepDependency_successorStepId_fkey" FOREIGN KEY ("successorStepId") REFERENCES "EventTechnicalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
