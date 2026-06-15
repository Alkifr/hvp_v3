-- Optional planned and actual periods per event placement.

ALTER TABLE "EventPlacement" ADD COLUMN "budgetStartAt" TIMESTAMP(3);
ALTER TABLE "EventPlacement" ADD COLUMN "budgetEndAt" TIMESTAMP(3);
ALTER TABLE "EventPlacement" ADD COLUMN "actualStartAt" TIMESTAMP(3);
ALTER TABLE "EventPlacement" ADD COLUMN "actualEndAt" TIMESTAMP(3);
