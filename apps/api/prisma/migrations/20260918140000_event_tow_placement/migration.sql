-- EventTow: bind to a placement on split events

ALTER TABLE "EventTow" ADD COLUMN IF NOT EXISTS "placementId" TEXT;

CREATE INDEX IF NOT EXISTS "EventTow_placementId_idx" ON "EventTow"("placementId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EventTow_placementId_fkey'
  ) THEN
    ALTER TABLE "EventTow"
      ADD CONSTRAINT "EventTow_placementId_fkey"
      FOREIGN KEY ("placementId") REFERENCES "EventPlacement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
