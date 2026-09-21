-- РМ Буксировки module permissions

INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '8a1b0c2d-6666-4e5f-8a90-000000000001', 'tows:read', 'РМ Буксировки: просмотр', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'tows:read');

INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '8a1b0c2d-6666-4e5f-8a90-000000000002', 'tows:write', 'РМ Буксировки: редактирование', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'tows:write');

UPDATE "Permission"
SET "name" = 'Can view РМ Буксировки', "appLabel" = 'event', "model" = 'EventTow', "action" = 'view', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'tows:read';

UPDATE "Permission"
SET "name" = 'Can change РМ Буксировки', "appLabel" = 'event', "model" = 'EventTow', "action" = 'change', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'tows:write';

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE p."code" = 'tows:read'
  AND EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" ev ON ev."id" = rp."permissionId" AND ev."code" IN ('events:read', 'gantt:read', 'itp:read')
    WHERE rp."roleId" = r."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE p."code" = 'tows:write'
  AND EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" ev ON ev."id" = rp."permissionId" AND ev."code" IN ('events:write', 'gantt:write')
    WHERE rp."roleId" = r."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
