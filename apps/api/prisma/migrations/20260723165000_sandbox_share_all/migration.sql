-- Общий доступ к песочнице для всех активных пользователей.
-- NULL = только владелец и явно добавленные участники.
ALTER TABLE "Sandbox"
ADD COLUMN "sharedWithAllRole" "SandboxMemberRole",
ADD CONSTRAINT "Sandbox_sharedWithAllRole_check"
CHECK ("sharedWithAllRole" IS NULL OR "sharedWithAllRole" IN ('EDITOR', 'VIEWER'));
