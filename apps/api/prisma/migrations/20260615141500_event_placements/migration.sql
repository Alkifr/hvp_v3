-- Multiple hangar placements per maintenance event.

CREATE TABLE "EventPlacement" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sandboxId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "hangarId" TEXT,
    "layoutId" TEXT,
    "standId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventPlacement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StandReservation" ADD COLUMN "placementId" TEXT;

-- Backfill existing one-hangar events as a single placement.
INSERT INTO "EventPlacement" (
    "id",
    "eventId",
    "sandboxId",
    "startAt",
    "endAt",
    "hangarId",
    "layoutId",
    "standId",
    "sortOrder",
    "createdAt",
    "updatedAt"
)
SELECT
    'placement_' || e."id",
    e."id",
    e."sandboxId",
    COALESCE(r."startAt", e."startAt"),
    COALESCE(r."endAt", e."endAt"),
    e."hangarId",
    COALESCE(r."layoutId", e."layoutId"),
    r."standId",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "MaintenanceEvent" e
LEFT JOIN "StandReservation" r ON r."eventId" = e."id";

UPDATE "StandReservation" r
SET "placementId" = p."id"
FROM "EventPlacement" p
WHERE p."eventId" = r."eventId"
  AND p."sortOrder" = 0;

DROP INDEX IF EXISTS "StandReservation_eventId_key";

CREATE UNIQUE INDEX "StandReservation_placementId_key" ON "StandReservation"("placementId");
CREATE INDEX "StandReservation_eventId_idx" ON "StandReservation"("eventId");
CREATE INDEX "EventPlacement_eventId_sortOrder_idx" ON "EventPlacement"("eventId", "sortOrder");
CREATE INDEX "EventPlacement_sandboxId_idx" ON "EventPlacement"("sandboxId");
CREATE INDEX "EventPlacement_hangarId_idx" ON "EventPlacement"("hangarId");
CREATE INDEX "EventPlacement_layoutId_idx" ON "EventPlacement"("layoutId");
CREATE INDEX "EventPlacement_standId_startAt_endAt_idx" ON "EventPlacement"("standId", "startAt", "endAt");

ALTER TABLE "EventPlacement" ADD CONSTRAINT "EventPlacement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPlacement" ADD CONSTRAINT "EventPlacement_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPlacement" ADD CONSTRAINT "EventPlacement_hangarId_fkey" FOREIGN KEY ("hangarId") REFERENCES "Hangar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventPlacement" ADD CONSTRAINT "EventPlacement_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "HangarLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventPlacement" ADD CONSTRAINT "EventPlacement_standId_fkey" FOREIGN KEY ("standId") REFERENCES "HangarStand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StandReservation" ADD CONSTRAINT "StandReservation_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "EventPlacement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
