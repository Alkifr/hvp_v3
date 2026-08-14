-- Editable auto-status flags for the event status catalog.

ALTER TABLE "EventStatusCatalog"
  ADD COLUMN "allowsAutoInProgress" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "manualOnly" BOOLEAN NOT NULL DEFAULT false;

UPDATE "EventStatusCatalog"
SET "allowsAutoInProgress" = true,
    "manualOnly" = false
WHERE "code" IN ('APPROVED_BY_EXECUTOR', 'APPROVED_BY_CUSTOMER');

UPDATE "EventStatusCatalog"
SET "allowsAutoInProgress" = false,
    "manualOnly" = false
WHERE "code" IN ('IN_PROGRESS', 'DONE');

UPDATE "EventStatusCatalog"
SET "allowsAutoInProgress" = false,
    "manualOnly" = true
WHERE "code" IN (
  'PENDING_EXECUTOR_APPROVAL',
  'PENDING_CUSTOMER_APPROVAL',
  'CANCELLED',
  'DELETED'
);
