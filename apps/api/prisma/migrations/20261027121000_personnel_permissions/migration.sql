-- РМ планирования персонала: экранные права и безопасные дефолты системных ролей.
INSERT INTO "Permission" ("id", "code", "name", "appLabel", "model", "action", "createdAt", "updatedAt")
SELECT '9b2c1d3e-7777-4e5f-8a90-000000000001', 'personnel:read',
       'Can view планирование персонала', 'personnel', 'PersonnelAvailability', 'view',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'personnel:read');

INSERT INTO "Permission" ("id", "code", "name", "appLabel", "model", "action", "createdAt", "updatedAt")
SELECT '9b2c1d3e-7777-4e5f-8a90-000000000002', 'personnel:write',
       'Can change планирование персонала', 'personnel', 'PersonnelAvailability', 'change',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'personnel:write');

INSERT INTO "Permission" ("id", "code", "name", "appLabel", "model", "action", "createdAt", "updatedAt")
SELECT '9b2c1d3e-7777-4e5f-8a90-000000000003', 'personnel:lock',
       'Can lock неделю планирования персонала', 'personnel', 'PersonnelPlanningWeek', 'custom',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'personnel:lock');

INSERT INTO "Permission" ("id", "code", "name", "appLabel", "model", "action", "createdAt", "updatedAt")
SELECT '9b2c1d3e-7777-4e5f-8a90-000000000004', 'personnel:unlock',
       'Can unlock неделю планирования персонала', 'personnel', 'PersonnelPlanningWeek', 'custom',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'personnel:unlock');

UPDATE "Permission"
SET "name" = CASE "code"
      WHEN 'personnel:read' THEN 'Can view планирование персонала'
      WHEN 'personnel:write' THEN 'Can change планирование персонала'
      WHEN 'personnel:lock' THEN 'Can lock неделю планирования персонала'
      WHEN 'personnel:unlock' THEN 'Can unlock неделю планирования персонала'
    END,
    "appLabel" = 'personnel',
    "model" = CASE WHEN "code" IN ('personnel:read', 'personnel:write')
      THEN 'PersonnelAvailability' ELSE 'PersonnelPlanningWeek' END,
    "action" = CASE "code"
      WHEN 'personnel:read' THEN 'view'
      WHEN 'personnel:write' THEN 'change'
      ELSE 'custom'
    END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('personnel:read', 'personnel:write', 'personnel:lock', 'personnel:unlock');

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'personnel:read'
WHERE r."code" IN ('ADMIN', 'SUPER_ADMIN', 'PLANNER', 'VIEWER')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('personnel:write', 'personnel:lock', 'personnel:unlock')
WHERE r."code" IN ('ADMIN', 'SUPER_ADMIN', 'PLANNER')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
