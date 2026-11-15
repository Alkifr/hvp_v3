-- Цех может вести численность без привязки к типу ВС.
ALTER TABLE "Workshop" ADD COLUMN "withoutAircraftType" BOOLEAN NOT NULL DEFAULT false;

-- Пустой тип: одна строка численности на цех, смену, дату и категорию.
ALTER TABLE "PersonnelAvailability" ALTER COLUMN "aircraftTypeId" DROP NOT NULL;

-- Существующие уникальные индексы считают NULL различными и не защищают строки без типа.
-- Частичные индексы не трогают строки с типом и строки, где пуста категория или квалификация.
CREATE UNIQUE INDEX "PersonnelAvailability_untyped_category_key"
  ON "PersonnelAvailability" ("date", "workshopId", "shiftId", "categoryCode")
  WHERE "aircraftTypeId" IS NULL AND "categoryCode" IS NOT NULL;

CREATE UNIQUE INDEX "PersonnelAvailability_untyped_skill_key"
  ON "PersonnelAvailability" ("date", "workshopId", "shiftId", "skillId")
  WHERE "aircraftTypeId" IS NULL AND "skillId" IS NOT NULL;
