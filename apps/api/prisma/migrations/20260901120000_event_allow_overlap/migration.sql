-- AlterTable
ALTER TABLE "MaintenanceEvent" ADD COLUMN "allowOverlap" BOOLEAN NOT NULL DEFAULT false;

-- События, которые уже пересекаются по месту с другим активным слотом
UPDATE "MaintenanceEvent" SET "allowOverlap" = true
WHERE id IN (
  SELECT DISTINCT a."eventId"
  FROM "StandReservation" a
  INNER JOIN "StandReservation" b
    ON a."standId" = b."standId"
    AND a."eventId" <> b."eventId"
    AND a."startAt" < b."endAt"
    AND a."endAt" > b."startAt"
    AND ((a."sandboxId" IS NULL AND b."sandboxId" IS NULL) OR a."sandboxId" = b."sandboxId")
  INNER JOIN "MaintenanceEvent" ea ON ea.id = a."eventId"
  INNER JOIN "MaintenanceEvent" eb ON eb.id = b."eventId"
  WHERE ea.status NOT IN ('CANCELLED', 'DELETED')
    AND eb.status NOT IN ('CANCELLED', 'DELETED')
);

-- События, которые уже пересекаются по другой схеме того же ангара
UPDATE "MaintenanceEvent" SET "allowOverlap" = true
WHERE id IN (
  SELECT DISTINCT a."eventId"
  FROM "StandReservation" a
  INNER JOIN "HangarLayout" la ON la.id = a."layoutId"
  INNER JOIN "StandReservation" b
    ON a."eventId" <> b."eventId"
    AND a."layoutId" <> b."layoutId"
    AND a."startAt" < b."endAt"
    AND a."endAt" > b."startAt"
    AND ((a."sandboxId" IS NULL AND b."sandboxId" IS NULL) OR a."sandboxId" = b."sandboxId")
  INNER JOIN "HangarLayout" lb ON lb.id = b."layoutId" AND lb."hangarId" = la."hangarId"
  INNER JOIN "MaintenanceEvent" ea ON ea.id = a."eventId"
  INNER JOIN "MaintenanceEvent" eb ON eb.id = b."eventId"
  WHERE ea.status NOT IN ('CANCELLED', 'DELETED')
    AND eb.status NOT IN ('CANCELLED', 'DELETED')
);
