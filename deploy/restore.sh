#!/usr/bin/env bash
#
# 백업 하나를 되돌린다. 지금 데이터를 전부 덮어쓴다.
#
#   sudo systemctl stop ojik-api ojik-worker
#   sudo -u ojik /srv/ojik/deploy/restore.sh /srv/ojik/var/backup/20261026-040000
#   sudo systemctl start ojik-api ojik-worker
#
# 서비스를 먼저 내려야 한다. 켜 둔 채로 되돌리면 복구 중인 DB 에 새 제출이 들어와
# 파일과 어긋난다.

set -euo pipefail

SRC="${1:?되돌릴 백업 디렉터리를 주세요}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ -s "$SRC/db.dump" ] || { echo "db.dump 가 없습니다: $SRC" >&2; exit 1; }
[ -s "$SRC/data.tar.gz" ] || { echo "data.tar.gz 가 없습니다: $SRC" >&2; exit 1; }

# shellcheck disable=SC1091
set -a; . "$ROOT/.env"; set +a

cat "$SRC/MANIFEST" 2>/dev/null || true
read -rp "지금 데이터를 전부 덮어씁니다. 계속하려면 yes 를 치세요: " ans
[ "$ans" = "yes" ] || { echo "취소했습니다."; exit 1; }

echo "DB 복구..."
docker exec -i ojik-db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --clean --if-exists --no-owner < "$SRC/db.dump"

echo "파일 복구..."
rm -rf "$ROOT/var/data"
tar -xzf "$SRC/data.tar.gz" -C "$ROOT/var"

echo "대조..."
cd "$ROOT" && npm run check:data
