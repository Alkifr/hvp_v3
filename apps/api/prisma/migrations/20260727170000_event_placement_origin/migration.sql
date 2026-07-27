CREATE TYPE "EventPlacementOrigin" AS ENUM ('MANUAL', 'AUTO_GAP');

ALTER TABLE "EventPlacement"
ADD COLUMN "origin" "EventPlacementOrigin" NOT NULL DEFAULT 'MANUAL';

CREATE INDEX "EventPlacement_origin_idx" ON "EventPlacement"("origin");
