# 운영

개발 환경은 [`development.md`](development.md)를 봅니다. 이 문서는 서버에 올려서 계속 돌리는 쪽입니다.

## 서버 고르기

채점기가 요구하는 것이 선택지를 거의 결정합니다.

| 요구 | 이유 | 걸러지는 것 |
|---|---|---|
| 루트 권한 있는 리눅스 | `isolate`가 cgroup v2 위임과 privileged 컨테이너를 씁니다 | 공유 호스팅, LXC/OpenVZ VPS |
| 컨테이너 런타임 | 러너를 `Privileged: true`로 띄웁니다 | Fargate, Cloud Run, App Runner, Lambda |
| 전용 CPU 코어 | 시간 측정이 흔들리면 맞는 풀이가 시간 초과로 떨어집니다 | 버스터블 인스턴스 (AWS t 계열 등) |
| 한 대에 전부 | `DATA_DIR`을 API와 워커가 같은 실체로 봐야 합니다 | API와 워커 분리 배치 |

**`WORKER_CAPACITY × WORKER_TC_PARALLEL`이 코어 수를 넘으면 안 됩니다.** 여기서 말하는 코어는
물리 코어입니다. 클라우드의 vCPU는 보통 하이퍼스레드 한 가닥이라 두 개가 한 코어를 나눠 씁니다.
AWS라면 `--cpu-options ThreadsPerCore=1`로 끄는 쪽이 판정이 안정적입니다.

수강생 30~50명 수업 하나면 물리 4코어, 메모리 8GB, 디스크 80GB면 넉넉합니다. 러너 이미지가
전부 합쳐 2GB 안쪽이고 나머지는 Postgres와 테스트케이스입니다.

**ARM(Graviton 등)에서는 아직 안 됩니다.** [`Dockerfile.java`](../images/runner/Dockerfile.java)가
JVM 경로에 `amd64`를 박아 두고 있어 자바 러너 빌드가 실패합니다.

## 첫 설치

사용자와 디렉터리를 만듭니다. 서비스는 `ojik` 사용자로 돕니다.

```bash
sudo useradd -r -m -d /srv/ojik -s /bin/bash ojik
sudo usermod -aG docker ojik      # 워커가 도커 소켓에 붙어야 합니다
sudo -u ojik git clone <저장소> /srv/ojik
cd /srv/ojik
```

**`docker` 그룹은 사실상 루트 권한입니다.** 워커가 privileged 컨테이너를 띄워야 해서 피할 수
없습니다. 이 서버에 다른 서비스를 같이 올리지 않는 것이 안전합니다.

설정을 채웁니다.

```bash
sudo -u ojik cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"  # POSTGRES_PASSWORD
```

운영에서 반드시 바꿀 값입니다. 하나라도 빠뜨리면 그게 그대로 구멍이 됩니다.

| 항목 | 값 | 안 바꾸면 |
|---|---|---|
| `JWT_SECRET` | 32자 이상 임의값 | 누구나 관리자 토큰을 만듭니다 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | 직접 정함 | 운영 compose가 아예 안 뜹니다 |
| `DATABASE_URL` | 위 셋에 맞춤 | API가 DB에 못 붙습니다 |
| `HOST` | `127.0.0.1` | API가 nginx를 건너뛰고 바깥에 열립니다 |
| `COOKIE_SECURE` | `true` | 토큰 쿠키가 평문으로 오갑니다 |
| `CORS_ORIGINS` | 실제 도메인 | 브라우저가 API 호출을 막습니다 |
| `WORKER_CAPACITY` / `WORKER_TC_PARALLEL` | 곱이 코어 수 이하 | 측정 시간이 부풀어 오판정이 납니다 |

DB와 러너를 올립니다.

```bash
docker compose -f docker-compose.prod.yml up -d
npm ci --omit=dev
npm run db:migrate
npm run runners:build      # 처음엔 몇 분 걸립니다
npm run smoke:judge        # 이게 통과해야 채점이 됩니다
```

**`npm run db:seed`를 운영에서 돌리지 마세요.** `admin@example.com / admin1234`가 생깁니다.
첫 관리자는 웹에서 가입한 뒤 권한을 올립니다.

```bash
npm run set-role -- <handle> admin
```

박스 루트를 tmpfs로 올립니다. 채점 산출물은 전부 휘발성이라 디스크에 쓸 이유가 없고,
SSD 수명에도 좋습니다. `/etc/fstab`에 넣어 재부팅 후에도 남게 합니다.

```
tmpfs /srv/ojik/var/boxes tmpfs size=2g,mode=0755 0 0
```

## 서비스 등록

```bash
sudo cp deploy/ojik-api.service deploy/ojik-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ojik-api ojik-worker
sudo systemctl status ojik-api ojik-worker
```

웹은 정적 파일이라 빌드해서 nginx가 서빙할 자리에 둡니다.

```bash
npm run build
sudo -u ojik cp -r apps/web/build/. /srv/ojik/web/
```

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ojik
sudo ln -s /etc/nginx/sites-available/ojik /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d oj.example.com
```

certbot이 TLS 설정을 그 파일에 직접 써 넣습니다. 그 뒤에 `.env`의 `COOKIE_SECURE=true`를
확인하고 API를 재시작합니다.

## 방화벽

```bash
sudo ufw allow 22,80,443/tcp
sudo ufw enable
```

**도커의 포트 퍼블리싱은 UFW를 우회합니다.** iptables에 직접 들어가기 때문에, UFW로 막아 둬도
`ports: "5432:5432"` 같은 설정은 그대로 바깥에 열립니다. [`docker-compose.prod.yml`](../docker-compose.prod.yml)이
`127.0.0.1:`을 붙여 두는 이유가 이것입니다. 포트를 추가할 일이 있으면 매번 이걸 확인하세요.

확인하는 법은 UFW 상태가 아니라 실제로 뭐가 열렸는지를 보는 것입니다.

```bash
sudo ss -tlnp | grep -v 127.0.0.1
```

22, 80, 443 말고 다른 게 보이면 잘못된 것입니다.

## 배포

```bash
cd /srv/ojik
sudo -u ojik git pull
npm ci --omit=dev
npm run db:migrate              # 마이그레이션이 늘었을 때만
npm run build
sudo -u ojik cp -r apps/web/build/. /srv/ojik/web/
sudo systemctl restart ojik-api ojik-worker
```

**워커는 채점이 빈 때 재시작하세요.** 중간에 끊겨도 lease가 풀려 다음 워커가 회수하지만,
학생 입장에서는 결과가 늦게 나옵니다. 큐는 `/api/health`로 봅니다.

```bash
curl -s localhost:3000/api/health | jq
```

**러너 이미지나 isolate 버전을 올릴 때는 `npm run smoke:judge`를 먼저 통과시키세요.** 버전이
갈리면 플래그가 안 맞아 전 제출이 채점 오류가 됩니다.

## 백업

DB와 테스트케이스를 **한 묶음으로** 받아야 합니다. `testcases` 행이 파일의 sha256을 들고 있어서,
따로 받으면 복구했을 때 해시가 어긋납니다. `npm run check:data`가 어긋난 것을 알려 주기는 하지만
고쳐 주지는 않습니다.

```bash
sudo -u ojik /srv/ojik/deploy/backup.sh
sudo crontab -u ojik -e
# 0 4 * * * /srv/ojik/deploy/backup.sh >> /srv/ojik/var/backup.log 2>&1
```

기본 14일치를 남깁니다 (`BACKUP_KEEP_DAYS`). **받은 것을 다른 장비로 옮기세요.** 같은 디스크에
둔 백업은 디스크가 죽는 순간 같이 죽습니다.

복구는 서비스를 내리고 합니다.

```bash
sudo systemctl stop ojik-api ojik-worker
sudo -u ojik /srv/ojik/deploy/restore.sh /srv/ojik/var/backup/20261026-040000
sudo systemctl start ojik-api ojik-worker
```

**복구 연습을 한 번은 해 보세요.** 안 해 본 백업은 백업이 아닙니다.

## 들여다보기

```bash
journalctl -u ojik-api -f
journalctl -u ojik-worker -f
journalctl -u ojik-worker --since "1 hour ago" -p err

curl -s localhost:3000/api/health | jq     # 워커 생존, 큐 길이
npm run check:data                          # DB 해시와 실제 파일 대조
npm run recount                             # 캐시 컬럼 정정 (-- --apply 로 반영)
```

`/api/health`는 워커가 없고 큐에 쌓인 게 있으면 503을 줍니다. 감시 도구를 붙인다면 이 경로를
보면 됩니다.

## 증상별 1차 확인

| 증상 | 먼저 볼 곳 |
|---|---|
| 제출이 계속 "채점 중" | `systemctl status ojik-worker`. 워커가 없으면 큐에 쌓이기만 합니다 |
| 전 제출이 채점 오류 | `npm run smoke:judge`. 러너 이미지와 isolate 버전이 갈렸을 가능성 |
| 맞는 풀이가 시간 초과 | `WORKER_CAPACITY × WORKER_TC_PARALLEL`이 코어 수를 넘었는지. 또는 버스터블 인스턴스 |
| 새로고침하면 404 | nginx의 `try_files ... /index.html` 누락 |
| 로그인이 풀림 | `COOKIE_SECURE`와 실제 프로토콜 불일치 |
| API 호출이 CORS로 막힘 | `CORS_ORIGINS`에 실제 도메인이 있는지 |
| 디스크가 찼다 | `var/backup`, journal, 도커 로그 순으로 봅니다 |

## 아직 없는 것

운영을 시작하기 전에 알고 있어야 하는 구멍입니다.

- **비밀번호 변경과 재설정이 없습니다.** 명단 업로드로 만든 계정은 임시 비밀번호를 계속 씁니다.
  잊으면 DB를 직접 고쳐야 합니다
- **로그인 시도 제한이 없습니다.** 사전 공격을 막는 장치가 없습니다
- **가입이 열려 있습니다.** 이메일 인증도 도메인 제한도 없습니다
- **계정 정지가 없습니다.** 막으려면 지워야 하고, 지우면 제출 기록이 같이 사라집니다
- **감사 로그가 없습니다.** 누가 문제를 지웠는지 남지 않습니다

처음에는 비공개로 두고 아는 사람만 쓰는 편이 안전합니다.
