#!/bin/sh
set -eu
cd /app/apps/api
npx prisma migrate deploy --schema=prisma/schema.prisma
exec node dist/index.js
