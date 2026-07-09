-- AlterTable
ALTER TABLE "MaintenanceEvent" ADD COLUMN "originEventId" TEXT;
ALTER TABLE "MaintenanceEvent" ADD COLUMN "sourceEventId" TEXT;
ALTER TABLE "MaintenanceEvent" ADD COLUMN "sourceSandboxId" TEXT;

-- CreateIndex
CREATE INDEX "MaintenanceEvent_originEventId_sandboxId_idx" ON "MaintenanceEvent"("originEventId", "sandboxId");
CREATE INDEX "MaintenanceEvent_sourceEventId_idx" ON "MaintenanceEvent"("sourceEventId");

-- Backfill lineage from audit CREATE.copiedFrom / promotedFrom (best-effort)
UPDATE "MaintenanceEvent" AS e
SET
  "sourceEventId" = COALESCE(
    e."sourceEventId",
    a.changes->'copiedFrom'->>'sourceEventId',
    a.changes->'promotedFrom'->>'sourceEventId'
  ),
  "sourceSandboxId" = COALESCE(
    e."sourceSandboxId",
    NULLIF(a.changes->'copiedFrom'->>'sourceSandboxId', ''),
    NULLIF(a.changes->'promotedFrom'->>'sourceSandboxId', '')
  ),
  "originEventId" = COALESCE(
    e."originEventId",
    CASE
      WHEN COALESCE(a.changes->'copiedFrom'->>'sourceSandboxId', a.changes->'promotedFrom'->>'sourceSandboxId') IS NULL
        THEN COALESCE(a.changes->'copiedFrom'->>'sourceEventId', a.changes->'promotedFrom'->>'sourceEventId')
      ELSE NULL
    END
  )
FROM (
  SELECT DISTINCT ON ("eventId")
    "eventId",
    changes
  FROM "MaintenanceEventAudit"
  WHERE action = 'CREATE'
    AND (
      changes ? 'copiedFrom'
      OR changes ? 'promotedFrom'
    )
  ORDER BY "eventId", "createdAt" ASC
) AS a
WHERE e.id = a."eventId"
  AND (
    e."sourceEventId" IS NULL
    OR e."originEventId" IS NULL
    OR e."sourceSandboxId" IS NULL
  );

-- Second pass: inherit originEventId through one hop (sandbox→sandbox copies)
UPDATE "MaintenanceEvent" AS child
SET "originEventId" = parent."originEventId"
FROM "MaintenanceEvent" AS parent
WHERE child."originEventId" IS NULL
  AND child."sourceEventId" = parent.id
  AND parent."originEventId" IS NOT NULL;
