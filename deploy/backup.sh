#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/backups/hvp-$(date +%Y%m%d-%H%M%S).dump}"
mkdir -p "$(dirname "$OUT")"
docker compose -f "$ROOT/deploy/docker-compose.yml" --env-file "$ROOT/.env" exec -T db \
  pg_dump -U hangar -Fc hangar_planning > "$OUT"
echo "Backup written: $OUT"
