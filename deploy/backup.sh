#!/usr/bin/env bash
#
# DB 와 테스트케이스를 한 묶음으로 받는다.
#
#   sudo -u ojik /srv/ojik/deploy/backup.sh
#   sudo -u ojik /srv/ojik/deploy/backup.sh /mnt/backup
#
# cron 예시 (매일 새벽 4시):
#   0 4 * * * /srv/ojik/deploy/backup.sh >> /var/log/ojik-backup.log 2>&1
#
# 둘을 반드시 같이 받아야 한다. DB 의 testcases 행은 파일의 sha256 을 들고 있고,
# 따로 받으면 복구했을 때 해시가 어긋난다. check:data 가 어긋난 걸 알려 주기는 하지만
# 고쳐 주지는 않는다.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/var/backup}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

# shellcheck disable=SC1091
set -a; . "$ROOT/.env"; set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
DIR="$OUT/$STAMP"
mkdir -p "$DIR"

echo "[$(date +%H:%M:%S)] 백업 시작 -> $DIR"

# DB 를 먼저 받는다.
#
# 순서가 중요하다. 파일을 먼저 받고 DB 를 나중에 받으면, 그 사이에 등록된 문제가
# "DB 에는 있는데 파일이 없는" 상태로 들어온다. 복구하면 그 문제의 채점이 깨진다.
# 반대 순서면 "파일은 있는데 DB 에 없는" 고아 파일이 되고, 그건 아무 해가 없다.
echo "  pg_dump..."
docker exec ojik-db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
    > "$DIR/db.dump"

echo "  테스트케이스와 업로드..."
tar -czf "$DIR/data.tar.gz" -C "$ROOT/var" data

# 복구할 때 무엇으로 받은 것인지 알아야 한다. 마이그레이션 버전이 다르면 그냥 못 넣는다
{
    echo "stamp=$STAMP"
    echo "git=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "db_size=$(stat -c%s "$DIR/db.dump")"
    echo "data_size=$(stat -c%s "$DIR/data.tar.gz")"
} > "$DIR/MANIFEST"

echo "[$(date +%H:%M:%S)] 완료: $(du -sh "$DIR" | cut -f1)"

# 오래된 것 정리. 지우기 전에 방금 것이 멀쩡한지 보고 지운다.
# 순서가 반대면 백업이 실패한 날 오래된 것까지 같이 사라진다
if [ -s "$DIR/db.dump" ] && [ -s "$DIR/data.tar.gz" ]; then
    find "$OUT" -maxdepth 1 -type d -name '20*' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
else
    echo "경고: 백업 파일이 비어 있습니다. 오래된 백업을 지우지 않았습니다." >&2
    exit 1
fi
