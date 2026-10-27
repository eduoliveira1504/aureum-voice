#!/usr/bin/env bash
# Daily backup on the VPS (PHASE3 block 3.18, item 8): pg_dump + the MinIO bucket (with each
# object's Content-Type, see media_archive.py) into ~/backups/<YYYY-MM-DD>/, checked before it
# counts, keeping the newest KEEP (default 7). Run by aureum-backup.timer (setup.sh backup);
# by hand: bash ~/aureum/infra/vps/backup.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
C=(docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml)
DEST="${BACKUP_DIR:-$HOME/backups}"
KEEP="${KEEP:-7}"
stamp="$(date +%F)"
tmp="$DEST/.partial-$stamp"

fail() { echo "FAILED $stamp: $*"; rm -rf "$tmp"; exit 1; }
trap 'fail "line $LINENO"' ERR

umask 077
mkdir -p "$DEST"
rm -rf "$tmp"
mkdir "$tmp"

"${C[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp/aureum-$stamp.dump"
"${C[@]}" exec -T api python - export < infra/vps/media_archive.py > "$tmp/minio-$stamp.tar" 2> "$tmp/media.log"

# A backup only counts if it opens.
tables="$("${C[@]}" exec -T postgres pg_restore --list < "$tmp/aureum-$stamp.dump" | grep -c 'TABLE DATA' || true)"
[ "${tables:-0}" -gt 0 ] || fail "the dump lists no table data"
objects="$(python3 -c 'import sys, tarfile; print(sum(1 for _ in tarfile.open(sys.argv[1])))' "$tmp/minio-$stamp.tar")" \
  || fail "the media tar doesn't open"

rm -f "$tmp/media.log"
rm -rf "${DEST:?}/$stamp"
mv "$tmp" "$DEST/$stamp"

# Keep the newest $KEEP days.
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' | sort | head -n "-$KEEP" | xargs -r rm -rf

echo "ok $stamp: $tables tables, $objects files, $(du -sh "$DEST/$stamp" | cut -f1)"
