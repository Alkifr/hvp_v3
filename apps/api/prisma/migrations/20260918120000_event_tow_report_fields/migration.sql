-- EventTow: from/to stands, notes and report fields for РМ Буксировки

ALTER TABLE "EventTow" ADD COLUMN IF NOT EXISTS "fromStandId" TEXT;
ALTER TABLE "EventTow" ADD COLUMN IF NOT EXISTS "toStandId" TEXT;
ALTER TABLE "EventTow" ADD COLUMN IF NOT EXISTS "fromLabel" TEXT;
ALTER TABLE "EventTow" ADD COLUMN IF NOT EXISTS "toLabel" TEXT;
ALTER TABLE "EventTow" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "EventTow" ADD COLUMN IF NOT EXISTS "positionComment" TEXT;
ALTER TABLE "EventTow" ADD COLUMN IF NOT EXISTS "startChangeReason" TEXT;

CREATE INDEX IF NOT EXISTS "EventTow_fromStandId_idx" ON "EventTow"("fromStandId");
CREATE INDEX IF NOT EXISTS "EventTow_toStandId_idx" ON "EventTow"("toStandId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EventTow_fromStandId_fkey'
  ) THEN
    ALTER TABLE "EventTow"
      ADD CONSTRAINT "EventTow_fromStandId_fkey"
      FOREIGN KEY ("fromStandId") REFERENCES "HangarStand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EventTow_toStandId_fkey'
  ) THEN
    ALTER TABLE "EventTow"
      ADD CONSTRAINT "EventTow_toStandId_fkey"
      FOREIGN KEY ("toStandId") REFERENCES "HangarStand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
