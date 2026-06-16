CREATE TYPE "EventPlanningKind" AS ENUM ('PLANNED', 'UNPLANNED');

ALTER TABLE "MaintenanceEvent"
  ADD COLUMN "planningKind" "EventPlanningKind" NOT NULL DEFAULT 'PLANNED';

UPDATE "MaintenanceEvent"
SET "planningKind" = CASE
  WHEN "budgetStartAt" IS NOT NULL AND "budgetEndAt" IS NOT NULL THEN 'PLANNED'::"EventPlanningKind"
  ELSE 'UNPLANNED'::"EventPlanningKind"
END;

CREATE INDEX "MaintenanceEvent_planningKind_idx" ON "MaintenanceEvent"("planningKind");
