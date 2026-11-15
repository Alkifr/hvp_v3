-- Квалификация может быть видна в доступном ресурсе и при этом не входить в итог для плана.
ALTER TABLE "PersonnelCategory" ADD COLUMN "countsInPlannedResource" BOOLEAN NOT NULL DEFAULT true;

-- Уже неавторизованные (AM, SM) не меняют текущий расчёт, пока галочку не включат.
UPDATE "PersonnelCategory" SET "countsInPlannedResource" = false WHERE "isAuthorized" = false;
