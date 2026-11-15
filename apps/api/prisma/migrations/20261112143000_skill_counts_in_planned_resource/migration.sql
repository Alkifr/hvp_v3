-- Признак «в расчёт» живёт в справочнике квалификаций.
ALTER TABLE "Skill" ADD COLUMN "countsInPlannedResource" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "PersonnelCategory" DROP COLUMN "countsInPlannedResource";
