-- Общий доступ к сохранённому отчёту для всех пользователей.
-- NULL = только владелец и явно добавленные участники.
ALTER TABLE "SavedReport"
ADD COLUMN "sharedWithAllRole" "ReportShareRole",
ADD CONSTRAINT "SavedReport_sharedWithAllRole_check"
CHECK ("sharedWithAllRole" IS NULL OR "sharedWithAllRole" IN ('EDITOR', 'VIEWER'));
