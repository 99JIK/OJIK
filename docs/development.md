# 개발 환경

[README](../README.md) | [아키텍처](architecture.md) | [채점 파이프라인](judge-pipeline.md)

## 준비물

| 항목 | 비고 |
|---|---|
| Node 22 이상 | `process.loadEnvFile`을 씁니다 |
| Docker | Postgres와 러너 컨테이너 |
| 리눅스 (워커만) | `isolate`가 cgroup과 네임스페이스를 직접 다룹니다 |

API와 웹은 Windows에서 그대로 돕니다. **워커만 리눅스가 필요합니다.**

## 첫 실행

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 출력값을 .env 의 JWT_SECRET 에 넣습니다

npm install
npm run infra:up
npm run db:migrate       # 마이그레이션 SQL 은 이미 저장소에 있습니다
npm run db:seed          # 개발용 계정과 문제 3개
npm test                 # 여기까지 통과하면 API 와 큐는 정상입니다
```

시드 계정은 `admin / admin1234`(관리자)와 `student / student1234`(일반)입니다.

창을 셋 열어 각각 띄웁니다.

```bash
npm run dev:api          # :3000
npm run dev:web          # :5173
npm run dev:worker
```

채점까지 돌리려면 러너 이미지를 한 번 빌드해야 합니다.

```bash
npm run runners:build
npm run smoke:judge      # isolate 가 제대로 도는지 확인
```

`smoke:judge`가 실패하면 채점은 반드시 실패합니다. 워커를 띄우기 전에 통과시키세요.

## Windows 에서의 워커 실행

`isolate`는 리눅스 커널 기능을 직접 쓰므로 Windows에서 네이티브로 돌지 않습니다. WSL2 안에서
띄웁니다.

```powershell
wsl --install -d Ubuntu     # 이미 있으면 건너뜁니다
wsl
```

WSL 셸 안에서:

```bash
# Windows 쪽 파일을 /mnt/c 로 쓰면 느리고 권한이 꼬입니다. 리눅스 파일시스템에 클론하세요
cd ~
git clone <저장소> oj
cd oj
npm install

# 박스 루트를 tmpfs 로 올립니다. 채점 산출물은 전부 휘발성입니다
sudo mkdir -p /var/oj/boxes
sudo mount -t tmpfs -o size=2g tmpfs /var/oj/boxes
```

`.env`에서 워커 쪽 경로를 WSL 경로로 맞춥니다.

```
DATABASE_URL=postgres://oj:oj@localhost:55432/oj
DATA_DIR=/home/<사용자>/oj/var/data
BOX_ROOT=/var/oj/boxes
```

**주의: `DATA_DIR`이 API와 워커에서 같은 실체를 가리켜야 합니다.** API를 Windows에서, 워커를
WSL에서 띄우면 서로 다른 파일시스템을 봅니다. 셋 중 하나를 고르세요.

1. API도 WSL 안에서 띄운다. 가장 단순합니다.
2. 저장소를 `/mnt/c/...`에 두고 양쪽이 같은 경로를 보게 한다. 느립니다.
3. 채점은 서버에서만 돌리고 로컬에서는 화면 작업만 한다.

**1번을 권합니다.** Postgres는 Docker Desktop이 WSL2 위에서 도니 `localhost:55432`로 양쪽에서
붙습니다.

부팅할 때마다 tmpfs를 다시 올려야 합니다. `/etc/fstab`에 넣거나 워커 실행 스크립트 앞에
붙이세요.

## 흔한 문제

### password 인증 실패 (28P01)

```
PostgresError: 사용자 "oj"의 password 인증이 실패했습니다
```

컨테이너를 방금 만들었는데 이게 나오면 **연결이 우리 컨테이너로 안 가고 있는 것**입니다.
개발 PC 에 PostgreSQL 이 설치돼 있으면 그쪽이 5432 를 잡고, 도커가 같은 포트 바인딩에
성공해도 `localhost` 연결은 네이티브 쪽으로 갑니다. 거기엔 `oj` 계정이 없으니 인증 실패입니다.

```powershell
netstat -ano | findstr :5432
```

리스너가 둘이면 이 경우입니다. 기본 설정이 `POSTGRES_PORT=55432` 인 이유입니다. 그래도
겹치면 `.env` 에서 다른 값으로 바꾸고 `npm run infra:up` 을 다시 돌리세요. `DATABASE_URL`
의 포트도 같이 고쳐야 합니다.

컨테이너가 진짜 우리 것인지 확인하는 방법입니다.

```bash
docker exec ojik-db psql -U oj -d oj -c "select 1"
```

이게 되는데 앱에서만 안 되면 포트 문제가 맞습니다.

### 채점이 안 돈다

순서대로 봅니다.

```bash
curl http://localhost:3000/api/health
```

`workers`가 비어 있으면 워커가 안 떠 있거나 DB에 등록을 못 한 것입니다. `queue.queued`가 쌓여
있는데 워커가 `alive: true`면 채점이 실패하고 있는 것이므로 워커 로그를 봅니다.

### 전 제출이 internal_error

```bash
npm run smoke:judge
```

대개 러너 이미지가 없거나 `isolate` 플래그가 안 맞는 경우입니다. `docker images | grep ojik-runner`로
이미지 존재를 먼저 확인하세요.

### 테스트케이스가 없다고 나온다

```bash
npm run check:data
```

DB의 sha256과 실제 파일을 대조합니다. 파일 없음과 내용 다름을 구분해 알려줍니다.
`DATA_DIR`이 API와 워커에서 다른 곳을 가리키는 경우가 대부분입니다.

### 맞힌 문제 수가 이상하다

재채점으로 판정이 뒤집히면 캐시 컬럼이 어긋납니다.

```bash
npm run recount            # 무엇이 틀렸는지만 보여줌
npm run recount -- --apply # 실제로 정정
```

### 시간 초과가 들쭉날쭉하다

`WORKER_CAPACITY * WORKER_TC_PARALLEL`이 CPU 코어 수를 넘었을 가능성이 큽니다. 채점 프로세스가
서로 CPU를 뺏으면 측정 시간이 부풀어 멀쩡한 풀이가 떨어집니다. 둘의 곱을 코어 수 이하로
낮추세요.

## 번들 크기

라우트별 첫 로드를 재는 방법입니다. 프레임워크를 바꾸거나 무거운 의존성을 추가할 때 확인합니다.

```bash
cd apps/web && npx vite build
```

빌드 후 `build/_app/immutable/nodes/*.js`가 라우트별 진입점이고, 거기서 따라가는 정적 import의
gzip 합계가 그 라우트의 첫 로드입니다.

2026-09-15 기준 측정값은 라우트별 **32-40 KB gzip**입니다. CodeMirror(약 93 KB gzip)는 제출
에디터가 실제로 그려질 때만 받아 오므로 이 수치에 안 들어갑니다. 문제를 읽기만 하는 방문자는
에디터를 내려받지 않습니다.

## 스키마 변경

```bash
# 1. packages/db/src/schema/ 를 고칩니다
# 2. 마이그레이션 SQL 을 생성합니다
npm run db:generate
# 3. 생성된 packages/db/drizzle/*.sql 을 읽어 봅니다. 의도한 것만 들어 있는지 확인
# 4. 적용합니다
npm run db:migrate
# 5. 생성된 SQL 파일과 스냅샷을 함께 커밋합니다
```

**생성된 SQL을 읽지 않고 넘기지 마세요.** 컬럼 이름을 바꾸면 drizzle-kit이 `drop` + `add`로
해석해 데이터가 날아갈 수 있습니다. 그런 경우 SQL 파일을 손으로 `ALTER ... RENAME`으로 고칩니다.

기동 시 자동 마이그레이션은 하지 않습니다. 배포와 스키마 변경을 분리해야 되돌릴 수 있습니다.

## 언어 추가

[`packages/core/src/languages.ts`](../packages/core/src/languages.ts)에 항목 하나를 넣습니다.
그게 전부입니다. API 검증, 워커 실행, 프론트 선택지, PG enum이 전부 여기서 나옵니다.

새 런타임이 필요하면 [`images/runner/`](../images/runner/)에 `Dockerfile.<runner>`를 추가하고
`RunnerId`에 그 이름을 더합니다.

```bash
npm run db:generate    # language enum 에 값이 추가되므로 마이그레이션이 필요합니다
npm run runners:build
```

KOJ는 같은 작업에 6곳을 고쳐야 했고 어느 하나를 빠뜨려도 조용히 깨졌습니다.
