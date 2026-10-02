#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "usage: $0 /path/to/incidentatlas-backup-directory" >&2
  exit 2
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$project_root"
backup_dir="$(cd "$1" && pwd)"
if [[ -e "$backup_dir/INCOMPLETE" ]]; then
  echo "backup directory is marked incomplete" >&2
  exit 1
fi
if ! (cd "$backup_dir" && sha256sum --check --status SHA256SUMS); then
  echo "backup checksum verification failed" >&2
  exit 1
fi

python3 - "$backup_dir/artifacts.tar" <<'PY'
import hashlib
import re
import sys
import tarfile

with tarfile.open(sys.argv[1], "r:") as archive:
    for member in archive:
        name = member.name.removeprefix("./")
        if name in ("", ".") and member.isdir():
            continue
        if member.isdir():
            if not re.fullmatch(r"[a-f0-9]{2}", name):
                raise SystemExit("artifact archive contains an unexpected directory")
            continue
        parts = name.split("/")
        if len(parts) != 2 or not re.fullmatch(r"[a-f0-9]{64}", parts[1]) or parts[0] != parts[1][:2] or not member.isfile():
            raise SystemExit("artifact archive contains an unexpected path or file type")
        if member.size > 1_048_576:
            raise SystemExit("artifact archive contains an object larger than the configured limit")
        stream = archive.extractfile(member)
        if stream is None:
            raise SystemExit("artifact archive entry could not be read")
        digest = hashlib.sha256()
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
        if digest.hexdigest() != parts[1]:
            raise SystemExit("artifact content digest does not match its object name")
PY

restore_db="incidentatlas_restore_verify_${RANDOM}_${RANDOM}"
drop_restore_db() {
  local result=$?
  trap - EXIT
  docker compose exec -T postgres sh -ec '
    export PGPASSWORD="$POSTGRES_PASSWORD"
    exec dropdb --if-exists --username "$POSTGRES_USER" "$1"
  ' sh "$restore_db" >/dev/null || result=1
  exit "$result"
}
trap drop_restore_db EXIT

docker compose exec -T postgres sh -ec '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec createdb --username "$POSTGRES_USER" "$1"
' sh "$restore_db"
docker compose exec -T postgres sh -ec '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec pg_restore --exit-on-error --no-owner --no-privileges --username "$POSTGRES_USER" --dbname "$1"
' sh "$restore_db" < "$backup_dir/postgres.dump"

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
  exec psql -XAt --username "$POSTGRES_USER" --dbname "$1" -c "$2"
' sh "$restore_db" "$count_sql" > "$backup_dir/restore-counts.txt"
if ! diff -u "$backup_dir/row-counts.txt" "$backup_dir/restore-counts.txt"; then
  echo "restored database counts do not match the backup manifest" >&2
  exit 1
fi
rm "$backup_dir/restore-counts.txt"
echo "Database restore and artifact digest verification passed"
