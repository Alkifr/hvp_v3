-- AlterTable
ALTER TABLE "EventWorkPlanLine" ADD COLUMN     "plannedHeadcount" INTEGER;

-- CreateTable
CREATE TABLE "EventWorkActualLine" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "shiftId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "actualHeadcount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventWorkActualLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventWorkActualLine_eventId_date_idx" ON "EventWorkActualLine"("eventId", "date");

-- CreateIndex
CREATE INDEX "EventWorkActualLine_skillId_idx" ON "EventWorkActualLine"("skillId");

-- CreateIndex
CREATE INDEX "EventWorkActualLine_shiftId_idx" ON "EventWorkActualLine"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "EventWorkActualLine_eventId_date_shiftId_skillId_key" ON "EventWorkActualLine"("eventId", "date", "shiftId", "skillId");

-- AddForeignKey
ALTER TABLE "EventWorkActualLine" ADD CONSTRAINT "EventWorkActualLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventWorkActualLine" ADD CONSTRAINT "EventWorkActualLine_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventWorkActualLine" ADD CONSTRAINT "EventWorkActualLine_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
