-- AlterTable
ALTER TABLE "MaintenanceEvent" ADD COLUMN IF NOT EXISTS "deadlineAt" TIMESTAMP(3);
