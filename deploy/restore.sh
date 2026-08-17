#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP="${1:?Usage: deploy/restore.sh path/to/backup.dump}"
if [[ ! -f "$DUMP" ]]; then
  echo "File not found: $DUMP" >&2
  exit 1
fi
echo "Restoring $DUMP into stack database (this replaces current data)…"
docker compose -f "$ROOT/deploy/docker-compose.yml" --env-file "$ROOT/.env" exec -T db \
  pg_restore -U hangar -d hangar_planning --clean --if-exists --no-owner < "$DUMP"
echo "Restore finished. Restart API if needed: docker compose -f deploy/docker-compose.yml restart api"
