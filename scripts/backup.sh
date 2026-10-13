#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?}" "${AGE_RECIPIENT:?}" "${R2_ENDPOINT:?}" "${R2_BACKUP_BUCKET:?}"
task_backup="$(mktemp)"
trap 'rm -f -- "$task_backup"' EXIT
docker run --rm -e DATABASE_URL postgres:17-alpine sh -c 'exec pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl' | age -r "$AGE_RECIPIENT" > "$task_backup"
task_limit="${BACKUP_STORAGE_LIMIT_BYTES:-3221225472}"
if [ "$(wc -c < "$task_backup")" -gt "$task_limit" ]; then
  echo 'Backup exceeds storage budget; upload stopped' >&2
  exit 1
fi
BACKUP_RESERVED_BYTES="$(wc -c < "$task_backup")" python3 scripts/prune-backups.py
aws s3 cp "$task_backup" "s3://$R2_BACKUP_BUCKET/database/$(date -u +%Y-%m-%dT%H-%M-%SZ).dump.age" --endpoint-url "$R2_ENDPOINT" --only-show-errors
python3 scripts/prune-backups.py
# Set an R2 lifecycle expiry of seven days on the database/ prefix.
