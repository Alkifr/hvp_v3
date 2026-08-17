-- New operational permission for digest compose/send (SMTP stays admin:mail).
INSERT INTO "Permission" ("id", "code", "name", "createdAt", "updatedAt")
SELECT '7c2e9d11-4f0a-4b6c-9d8e-0000mailsend', 'mail:send', 'Формирование и отправка email-рассылки', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'mail:send');

UPDATE "Permission"
SET "name" = 'SMTP и системные настройки почты', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'admin:mail';

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE p."code" = 'mail:send'
  AND r."code" IN ('PLANNER', 'ADMIN', 'SUPER_ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
