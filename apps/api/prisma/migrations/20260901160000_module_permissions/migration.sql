-- Module-level permissions + readable names. Existing events:read/write stay as data access.

INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '8a1b0c2d-1111-4e5f-8a90-000000000001', 'gantt:read', 'План (Гантт): просмотр', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'gantt:read');

INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '8a1b0c2d-1111-4e5f-8a90-000000000002', 'gantt:write', 'План (Гантт): редактирование', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'gantt:write');

INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '8a1b0c2d-2222-4e5f-8a90-000000000001', 'hangar:read', 'Ангар (схема): просмотр', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'hangar:read');

INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '8a1b0c2d-2222-4e5f-8a90-000000000002', 'hangar:write', 'Ангар (схема): редактирование', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'hangar:write');

INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '8a1b0c2d-3333-4e5f-8a90-000000000001', 'analytics:read', 'Аналитика: просмотр', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'analytics:read');

INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '8a1b0c2d-4444-4e5f-8a90-000000000001', 'itp:read', 'РМ ИТП: просмотр', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'itp:read');

INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '8a1b0c2d-5555-4e5f-8a90-000000000001', 'import:write', 'Импорт / массовое планирование: запуск', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'import:write');

UPDATE "Permission" SET "name" = 'События: просмотр данных', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'events:read';
UPDATE "Permission" SET "name" = 'События: изменение данных', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'events:write';
UPDATE "Permission" SET "name" = 'Справочники: просмотр', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'ref:read';
UPDATE "Permission" SET "name" = 'Справочники: редактирование', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'ref:write';
UPDATE "Permission" SET "name" = 'Администрирование: пользователи', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'admin:users';
UPDATE "Permission" SET "name" = 'Администрирование: роли', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'admin:roles';
UPDATE "Permission" SET "name" = 'Администрирование: очистка контура', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'admin:cleanup';
UPDATE "Permission" SET "name" = 'Администрирование: SMTP', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'admin:mail';
UPDATE "Permission" SET "name" = 'Рассылка: отправка', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'mail:send';
UPDATE "Permission" SET "name" = 'Трудоёмкость: просмотр', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'resources:read';
UPDATE "Permission" SET "name" = 'Трудоёмкость: план / бюджет', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'resources:plan';
UPDATE "Permission" SET "name" = 'Трудоёмкость: факт', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'resources:actual';
UPDATE "Permission" SET "name" = 'Персонал и смены: просмотр', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'workforce:read';
UPDATE "Permission" SET "name" = 'Персонал и смены: редактирование', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'workforce:write';
UPDATE "Permission" SET "name" = 'Склад: просмотр', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'warehouse:read';
UPDATE "Permission" SET "name" = 'Склад: редактирование', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'warehouse:write';

-- Roles that already had events:read get the same modules they used to see.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE p."code" IN ('gantt:read', 'hangar:read', 'analytics:read', 'itp:read')
  AND EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" ev ON ev."id" = rp."permissionId" AND ev."code" = 'events:read'
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
WHERE p."code" IN ('gantt:write', 'hangar:write', 'import:write')
  AND EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" ev ON ev."id" = rp."permissionId" AND ev."code" = 'events:write'
    WHERE rp."roleId" = r."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
