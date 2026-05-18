ALTER TABLE "MaintenanceEvent"
  ADD COLUMN "budgetStartAt" TIMESTAMP(3),
  ADD COLUMN "budgetEndAt" TIMESTAMP(3),
  ADD COLUMN "actualStartAt" TIMESTAMP(3),
  ADD COLUMN "actualEndAt" TIMESTAMP(3);

