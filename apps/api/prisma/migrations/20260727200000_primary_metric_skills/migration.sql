-- Квалификации под подразделения первичной таблицы (ME/AV/INT/NDT/SHOP/CAB_REP).
-- Legacy MECH/AVIO оставляем, но деактивируем.

INSERT INTO "Skill" ("id", "code", "name", "isActive", "createdAt", "updatedAt")
VALUES
  ('a1000001-0001-4000-8000-000000000001', 'ME', 'ME (Mechanic)', true, NOW(), NOW()),
  ('a1000001-0001-4000-8000-000000000002', 'AV', 'AV (Avionics)', true, NOW(), NOW()),
  ('a1000001-0001-4000-8000-000000000003', 'INT', 'INT (Interior)', true, NOW(), NOW()),
  ('a1000001-0001-4000-8000-000000000004', 'NDT', 'NDT / BORO', true, NOW(), NOW()),
  ('a1000001-0001-4000-8000-000000000005', 'SHOP', 'SHOP', true, NOW(), NOW()),
  ('a1000001-0001-4000-8000-000000000006', 'CAB_REP', 'CabRep', true, NOW(), NOW())
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "isActive" = true,
  "updatedAt" = NOW();

UPDATE "Skill"
SET "isActive" = false, "updatedAt" = NOW()
WHERE "code" IN ('MECH', 'AVIO');
