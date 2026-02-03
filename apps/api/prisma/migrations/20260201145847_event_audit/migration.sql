-- CreateEnum
CREATE TYPE "EventAuditAction" AS ENUM ('CREATE', 'UPDATE', 'RESERVE', 'UNRESERVE');

-- CreateTable
CREATE TABLE "MaintenanceEventAudit" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "action" "EventAuditAction" NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'browser',
    "reason" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceEventAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceEventAudit_eventId_createdAt_idx" ON "MaintenanceEventAudit"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "MaintenanceEventAudit" ADD CONSTRAINT "MaintenanceEventAudit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
