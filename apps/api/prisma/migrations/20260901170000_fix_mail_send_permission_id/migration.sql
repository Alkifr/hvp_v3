-- mail:send was inserted with a non-hex suffix, so role PATCH failed z.string().uuid().
UPDATE "Permission"
SET "id" = '7c2e9d11-4f0a-4b6c-9d8e-00000000a11e'
WHERE "id" = '7c2e9d11-4f0a-4b6c-9d8e-0000mailsend';
