#!/bin/sh
#
# 러너 컨테이너 기동 준비. isolate 가 쓸 cgroup 을 위임받아 둔다.
#
# isolate 2.x 는 cgroup v2 를 쓴다. 호스트에 systemd 가 있으면 isolate-cg-keeper 가
# 이 일을 해주지만 컨테이너 안에는 systemd 가 없다. 그래서 여기서 직접 한다.
#
# 실패하면 즉시 죽는다. 이 준비가 안 된 채로 컨테이너가 살아 있으면 모든 제출이
# internal_error 로 떨어지고, 원인은 로그를 봐야만 알 수 있다.
set -eu

CG=/sys/fs/cgroup

die() {
    echo "[ojik-runner] $1" >&2
    echo "[ojik-runner] 컨테이너는 --privileged 로 떠야 하고 호스트가 cgroup v2 여야 합니다." >&2
    exit 1
}

[ -f "$CG/cgroup.controllers" ] || die "cgroup v2 가 아닙니다 ($CG/cgroup.controllers 없음)."

# cgroup v2 의 no internal processes 규칙: 프로세스를 담고 있는 cgroup 은 하위로
# 컨트롤러를 넘길 수 없다. 컨테이너 init 을 leaf 로 옮겨서 루트를 비운다
mkdir -p "$CG/init"
while read -r pid; do
    echo "$pid" > "$CG/init/cgroup.procs" 2>/dev/null || true
done < "$CG/cgroup.procs"

# 실제로 쓸 수 있는 컨트롤러만 켠다. 호스트 커널 설정에 따라 없는 게 있다
want=""
for c in cpu memory pids; do
    case " $(cat "$CG/cgroup.controllers") " in
        *" $c "*) want="$want +$c" ;;
    esac
done
[ -n "$want" ] || die "쓸 수 있는 cgroup 컨트롤러가 없습니다."
case "$want" in
    *memory*) ;;
    *) die "memory 컨트롤러가 없습니다. --cg-mem 으로 메모리 제한을 걸 수 없습니다." ;;
esac

echo "$want" > "$CG/cgroup.subtree_control" 2>/dev/null ||
    die "cgroup 컨트롤러 위임 실패 ($want)."

# isolate 가 박스별 하위 그룹을 만들 자리. 설정 파일의 cg_root 와 같아야 한다
mkdir -p "$CG/isolate"
echo "$want" > "$CG/isolate/cgroup.subtree_control" 2>/dev/null ||
    die "isolate cgroup 위임 실패."

mkdir -p /run/isolate/locks /var/local/lib/isolate

# 설정이 온전한지 여기서 한 번 본다. 첫 제출에서 알게 되는 것보다 낫다
isolate --check-config || die "isolate 설정 파일이 올바르지 않습니다."

exec "$@"
