#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -ne 1 || "$1" != /* ]]; then
  echo "usage: $0 /absolute/private/backup-directory" >&2
  exit 2
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$project_root"
backup_root="$1"
mkdir -p "$backup_root"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$backup_root/incidentatlas-$timestamp"
mkdir -m 700 "$backup_dir"
: > "$backup_dir/INCOMPLETE"

api_was_running=0
worker_was_running=0
if [[ -n "$(docker compose ps --status running --quiet api)" ]]; then api_was_running=1; fi
if [[ -n "$(docker compose ps --status running --quiet worker)" ]]; then worker_was_running=1; fi

resume_services() {
  local result=$?
  trap - EXIT
  if (( api_was_running )); then docker compose start api >/dev/null || result=1; fi
  if (( worker_was_running )); then docker compose start worker >/dev/null || result=1; fi
  exit "$result"
}
trap resume_services EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Quiesce writes and cleanup so the database and artifact archive describe one
# consistent application state. Collectors continue to buffer locally.
docker compose stop --timeout 90 api worker

docker compose exec -T postgres sh -ec '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec pg_dump --format=custom --no-owner --no-privileges --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
' > "$backup_dir/postgres.dump"

docker compose run --rm --no-deps -T --entrypoint tar api \
  -cf - -C /var/lib/incidentatlas/artifacts . > "$backup_dir/artifacts.tar"

count_sql="SELECT item FROM (
  SELECT 'artifacts=' || count(*)::text AS item FROM artifacts UNION ALL
  SELECT 'audit_events=' || count(*)::text FROM audit_events UNION ALL
  SELECT 'collectors=' || count(*)::text FROM collectors UNION ALL
  SELECT 'events=' || count(*)::text FROM events UNION ALL
  SELECT 'hosts=' || count(*)::text FROM hosts UNION ALL
  SELECT 'incidents=' || count(*)::text FROM incidents UNION ALL
  SELECT 'organizations=' || count(*)::text FROM organizations
) counts ORDER BY item"
docker compose exec -T postgres sh -ec '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec psql -XAt --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "$1"
' sh "$count_sql" > "$backup_dir/row-counts.txt"

tar -tf "$backup_dir/artifacts.tar" >/dev/null
sha256sum "$backup_dir/postgres.dump" "$backup_dir/artifacts.tar" "$backup_dir/row-counts.txt" \
  > "$backup_dir/SHA256SUMS"
chmod 600 "$backup_dir"/*
rm -- "$backup_dir/INCOMPLETE"
echo "Backup written to $backup_dir"
