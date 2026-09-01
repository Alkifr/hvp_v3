-- User start page and muted bell notification kinds.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "homePage" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mutedNotificationKinds" JSONB NOT NULL DEFAULT '[]';
