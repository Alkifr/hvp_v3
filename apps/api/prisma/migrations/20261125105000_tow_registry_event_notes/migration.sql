-- Ручные примечание, позиция и причина реестра буксировок у события без назначенной буксировки.

ALTER TABLE "MaintenanceEvent" ADD COLUMN IF NOT EXISTS "towRegistryNotes" TEXT;
ALTER TABLE "MaintenanceEvent" ADD COLUMN IF NOT EXISTS "towRegistryPosition" TEXT;
ALTER TABLE "MaintenanceEvent" ADD COLUMN IF NOT EXISTS "towRegistryStartReason" TEXT;
