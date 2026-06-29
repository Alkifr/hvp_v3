-- Add configurable body-type priority rules for mass planning placement scoring.
INSERT INTO "OptimizationScoreRule" ("id", "profileId", "code", "name", "category", "scope", "value", "unit", "isActive", "updatedAt")
SELECT rule."id", profile."id", rule."code", rule."name", rule."category"::"OptimizationScoreCategory", rule."scope"::"OptimizationScoreScope", rule."value", rule."unit"::"OptimizationScoreUnit", true, CURRENT_TIMESTAMP
FROM "OptimizationProfile" profile
CROSS JOIN (
  VALUES
    ('8ed06f3e-0a98-42df-8d07-76005a9ef111', 'wide_body_placement_priority', 'Приоритет размещения широкофюзеляжного ВС', 'REWARD', 'PRIORITY', 150, 'POINTS'),
    ('8ed06f3e-0a98-42df-8d07-76005a9ef112', 'narrow_body_placement_priority', 'Приоритет размещения узкофюзеляжного ВС', 'REWARD', 'PRIORITY', 50, 'POINTS')
) AS rule("id", "code", "name", "category", "scope", "value", "unit")
WHERE profile."code" = 'DEFAULT'
ON CONFLICT ("profileId", "code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "scope" = EXCLUDED."scope",
  "unit" = EXCLUDED."unit",
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = CURRENT_TIMESTAMP;
