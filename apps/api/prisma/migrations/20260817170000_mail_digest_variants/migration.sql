-- CreateTable
CREATE TABLE "MailDigestVariant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subjectTemplate" TEXT NOT NULL DEFAULT 'Изменения плана ТО',
    "description" TEXT,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "periodMode" TEXT NOT NULL DEFAULT 'last7',
    "periodCustomFrom" TEXT,
    "periodCustomTo" TEXT,
    "scheduleMode" TEXT NOT NULL DEFAULT 'manual',
    "scheduleTime" TEXT NOT NULL DEFAULT '09:00',
    "scheduleWeekdays" JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
    "scheduleMonthDay" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastAutoSentAt" TIMESTAMP(3),
    "columns" JSONB NOT NULL DEFAULT '["kind","aircraftType","aircraft","title","detail","previous"]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailDigestVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailDigestVariant_updatedAt_idx" ON "MailDigestVariant"("updatedAt");

-- Migrate the singleton compose settings into the first variant.
INSERT INTO "MailDigestVariant" (
    "id",
    "name",
    "subjectTemplate",
    "description",
    "recipients",
    "periodMode",
    "periodCustomFrom",
    "periodCustomTo",
    "scheduleMode",
    "scheduleTime",
    "scheduleWeekdays",
    "scheduleMonthDay",
    "isActive",
    "lastAutoSentAt",
    "columns",
    "createdAt",
    "updatedAt"
)
SELECT
    'a11e0000-0000-4000-8000-000000000001',
    CASE
        WHEN COALESCE(NULLIF(BTRIM("subjectTemplate"), ''), '') <> '' THEN BTRIM("subjectTemplate")
        ELSE 'Изменения плана ТО'
    END,
    COALESCE(NULLIF(BTRIM("subjectTemplate"), ''), 'Изменения плана ТО'),
    "description",
    "recipients",
    COALESCE(NULLIF("periodMode", ''), 'last7'),
    "periodCustomFrom",
    "periodCustomTo",
    COALESCE(NULLIF("scheduleMode", ''), 'manual'),
    COALESCE(NULLIF("scheduleTime", ''), '09:00'),
    "scheduleWeekdays",
    "scheduleMonthDay",
    "isActive",
    "lastAutoSentAt",
    "columns",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "MailDigestSettings"
WHERE "id" = 'default';

-- AlterTable
ALTER TABLE "MailDigestSendLog" ADD COLUMN "variantId" TEXT;
ALTER TABLE "MailDigestSendLog" ADD COLUMN "variantName" TEXT;

UPDATE "MailDigestSendLog"
SET
    "variantId" = (SELECT "id" FROM "MailDigestVariant" ORDER BY "createdAt" ASC LIMIT 1),
    "variantName" = (SELECT "name" FROM "MailDigestVariant" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "variantId" IS NULL;

-- AddForeignKey
ALTER TABLE "MailDigestSendLog" ADD CONSTRAINT "MailDigestSendLog_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "MailDigestVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "MailDigestSendLog_variantId_createdAt_idx" ON "MailDigestSendLog"("variantId", "createdAt");

-- Drop compose columns from SMTP singleton.
ALTER TABLE "MailDigestSettings" DROP COLUMN "recipients";
ALTER TABLE "MailDigestSettings" DROP COLUMN "subjectTemplate";
ALTER TABLE "MailDigestSettings" DROP COLUMN "description";
ALTER TABLE "MailDigestSettings" DROP COLUMN "periodMode";
ALTER TABLE "MailDigestSettings" DROP COLUMN "periodCustomFrom";
ALTER TABLE "MailDigestSettings" DROP COLUMN "periodCustomTo";
ALTER TABLE "MailDigestSettings" DROP COLUMN "scheduleMode";
ALTER TABLE "MailDigestSettings" DROP COLUMN "scheduleTime";
ALTER TABLE "MailDigestSettings" DROP COLUMN "scheduleWeekdays";
ALTER TABLE "MailDigestSettings" DROP COLUMN "scheduleMonthDay";
ALTER TABLE "MailDigestSettings" DROP COLUMN "isActive";
ALTER TABLE "MailDigestSettings" DROP COLUMN "lastAutoSentAt";
ALTER TABLE "MailDigestSettings" DROP COLUMN "columns";
