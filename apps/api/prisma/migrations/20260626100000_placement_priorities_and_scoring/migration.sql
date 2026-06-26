-- CreateEnum
CREATE TYPE "OptimizationScoreCategory" AS ENUM ('REWARD', 'PENALTY', 'LIMIT');

-- CreateEnum
CREATE TYPE "OptimizationScoreUnit" AS ENUM ('POINTS', 'POINTS_PER_HOUR', 'HOURS', 'BOOLEAN', 'MULTIPLIER');

-- CreateEnum
CREATE TYPE "OptimizationScoreScope" AS ENUM ('NEW_EVENT', 'EXISTING_EVENT', 'PLACEMENT', 'LAYOUT', 'STAND', 'TOW', 'PRIORITY');

-- CreateTable
CREATE TABLE "PlacementPriorityRule" (
    "id" TEXT NOT NULL,
    "hangarId" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "standId" TEXT NOT NULL,
    "priorityScore" INTEGER NOT NULL DEFAULT 500,
    "sourceEventName" TEXT,
    "sourceAircraftTypeText" TEXT,
    "conditionText" TEXT,
    "comment" TEXT,
    "source" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementPriorityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementPriorityRuleEventType" (
    "ruleId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementPriorityRuleEventType_pkey" PRIMARY KEY ("ruleId","eventTypeId")
);

-- CreateTable
CREATE TABLE "PlacementPriorityRuleAircraftType" (
    "ruleId" TEXT NOT NULL,
    "aircraftTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementPriorityRuleAircraftType_pkey" PRIMARY KEY ("ruleId","aircraftTypeId")
);

-- CreateTable
CREATE TABLE "OptimizationProfile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationScoreRule" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "OptimizationScoreCategory" NOT NULL,
    "scope" "OptimizationScoreScope" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" "OptimizationScoreUnit" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationScoreRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlacementPriorityRule_hangarId_idx" ON "PlacementPriorityRule"("hangarId");

-- CreateIndex
CREATE INDEX "PlacementPriorityRule_layoutId_idx" ON "PlacementPriorityRule"("layoutId");

-- CreateIndex
CREATE INDEX "PlacementPriorityRule_standId_idx" ON "PlacementPriorityRule"("standId");

-- CreateIndex
CREATE INDEX "PlacementPriorityRule_isActive_idx" ON "PlacementPriorityRule"("isActive");

-- CreateIndex
CREATE INDEX "PlacementPriorityRuleEventType_eventTypeId_idx" ON "PlacementPriorityRuleEventType"("eventTypeId");

-- CreateIndex
CREATE INDEX "PlacementPriorityRuleAircraftType_aircraftTypeId_idx" ON "PlacementPriorityRuleAircraftType"("aircraftTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "OptimizationProfile_code_key" ON "OptimizationProfile"("code");

-- CreateIndex
CREATE INDEX "OptimizationProfile_isActive_idx" ON "OptimizationProfile"("isActive");

-- CreateIndex
CREATE INDEX "OptimizationProfile_isDefault_idx" ON "OptimizationProfile"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "OptimizationScoreRule_profileId_code_key" ON "OptimizationScoreRule"("profileId", "code");

-- CreateIndex
CREATE INDEX "OptimizationScoreRule_profileId_idx" ON "OptimizationScoreRule"("profileId");

-- CreateIndex
CREATE INDEX "OptimizationScoreRule_category_idx" ON "OptimizationScoreRule"("category");

-- CreateIndex
CREATE INDEX "OptimizationScoreRule_scope_idx" ON "OptimizationScoreRule"("scope");

-- CreateIndex
CREATE INDEX "OptimizationScoreRule_isActive_idx" ON "OptimizationScoreRule"("isActive");

-- AddForeignKey
ALTER TABLE "PlacementPriorityRule" ADD CONSTRAINT "PlacementPriorityRule_hangarId_fkey" FOREIGN KEY ("hangarId") REFERENCES "Hangar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementPriorityRule" ADD CONSTRAINT "PlacementPriorityRule_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "HangarLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementPriorityRule" ADD CONSTRAINT "PlacementPriorityRule_standId_fkey" FOREIGN KEY ("standId") REFERENCES "HangarStand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementPriorityRuleEventType" ADD CONSTRAINT "PlacementPriorityRuleEventType_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PlacementPriorityRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementPriorityRuleEventType" ADD CONSTRAINT "PlacementPriorityRuleEventType_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementPriorityRuleAircraftType" ADD CONSTRAINT "PlacementPriorityRuleAircraftType_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PlacementPriorityRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementPriorityRuleAircraftType" ADD CONSTRAINT "PlacementPriorityRuleAircraftType_aircraftTypeId_fkey" FOREIGN KEY ("aircraftTypeId") REFERENCES "AircraftType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationScoreRule" ADD CONSTRAINT "OptimizationScoreRule_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "OptimizationProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default optimization profile and score rules.
WITH profile AS (
  INSERT INTO "OptimizationProfile" ("id", "code", "name", "description", "isDefault", "isActive", "updatedAt")
  VALUES ('8ed06f3e-0a98-42df-8d07-76005a9ef001', 'DEFAULT', 'Базовый профиль', 'Стартовые веса для массового планирования.', true, true, CURRENT_TIMESTAMP)
  RETURNING "id"
)
INSERT INTO "OptimizationScoreRule" ("id", "profileId", "code", "name", "category", "scope", "value", "unit", "isActive", "updatedAt")
SELECT rule."id", profile."id", rule."code", rule."name", rule."category"::"OptimizationScoreCategory", rule."scope"::"OptimizationScoreScope", rule."value", rule."unit"::"OptimizationScoreUnit", true, CURRENT_TIMESTAMP
FROM profile
CROSS JOIN (
  VALUES
    ('8ed06f3e-0a98-42df-8d07-76005a9ef101', 'placed_new_event', 'Размещено новое событие', 'REWARD', 'NEW_EVENT', 10000, 'POINTS'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef102', 'unplaced_new_event', 'Новое событие не размещено', 'PENALTY', 'NEW_EVENT', -20000, 'POINTS'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef103', 'placement_priority_match', 'Совпадение с приоритетом размещения', 'REWARD', 'PRIORITY', 500, 'POINTS'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef104', 'preferred_hangar_match', 'Совпадение с приоритетным ангаром', 'REWARD', 'PLACEMENT', 200, 'POINTS'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef105', 'existing_event_shift_base', 'Факт сдвига существующего события', 'PENALTY', 'EXISTING_EVENT', -300, 'POINTS'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef106', 'existing_event_shift_per_hour', 'Сдвиг существующего события за час', 'PENALTY', 'EXISTING_EVENT', -20, 'POINTS_PER_HOUR'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef107', 'change_hangar', 'Смена ангара существующего события', 'PENALTY', 'PLACEMENT', -1000, 'POINTS'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef108', 'change_stand', 'Смена места существующего события', 'PENALTY', 'STAND', -300, 'POINTS'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef109', 'max_existing_event_shift_hours', 'Максимальный сдвиг существующего события', 'LIMIT', 'EXISTING_EVENT', 12, 'HOURS'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef110', 'max_confirmed_event_shift_hours', 'Максимальный сдвиг подтвержденного события', 'LIMIT', 'EXISTING_EVENT', 4, 'HOURS')
) AS rule("id", "code", "name", "category", "scope", "value", "unit");
