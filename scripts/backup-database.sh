#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
umask 077
mkdir -p data/backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="data/backups/postgres-${stamp}.dump"
trap 'rm -f -- "$target.tmp"' EXIT
docker compose exec -T database sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$target.tmp"
test -s "$target.tmp"
mv -- "$target.tmp" "$target"
printf 'Database backup: %s\n' "$target"
printf 'Keep the existing DATA_ENCRYPTION_KEY from .env with this backup in a secure location.\n'
