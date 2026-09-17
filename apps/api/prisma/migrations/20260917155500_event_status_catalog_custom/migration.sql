-- Allow custom event statuses beyond the former EventStatus enum.

ALTER TABLE "MaintenanceEvent" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "MaintenanceEvent" ALTER COLUMN "status" TYPE TEXT USING "status"::text;
ALTER TABLE "MaintenanceEvent" ALTER COLUMN "status" SET DEFAULT 'PENDING_EXECUTOR_APPROVAL';

ALTER TABLE "EventStatusCatalog" ALTER COLUMN "code" TYPE TEXT USING "code"::text;

DROP TYPE "EventStatus";
