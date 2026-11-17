CREATE TABLE IF NOT EXISTS "TowRegistryMailTemplate" (
  "id" TEXT NOT NULL,
  "subjectTemplate" TEXT NOT NULL DEFAULT 'Реестр буксировок {{period}}',
  "bodyTemplate" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TowRegistryMailTemplate_pkey" PRIMARY KEY ("id")
);
