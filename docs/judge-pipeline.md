# 채점 파이프라인

[README](../README.md) | [아키텍처](architecture.md) | [KOJ와의 차이](koj-differences.md)

채점이 어떻게 도는지, 왜 그렇게 정했는지입니다.

## 큐

**제출 테이블이 곧 큐입니다.** 별도 메시지 브로커를 두지 않습니다.

```sql
WITH picked AS (
    SELECT id FROM submissions
    WHERE status = 'queued'
    ORDER BY priority DESC, id ASC
    LIMIT $n
    FOR UPDATE SKIP LOCKED
)
UPDATE submissions s
SET status = 'judging', claimed_by = $worker, claimed_at = now(),
    heartbeat_at = now(), attempts = s.attempts + 1
FROM picked WHERE s.id = picked.id
RETURNING s.*;
```

`SKIP LOCKED` 덕분에 워커 여럿이 동시에 불러도 같은 행을 두 번 집지 않습니다. 구현은
[`packages/db/src/queue.ts`](../packages/db/src/queue.ts)에 있습니다.

### 큐를 DB에 둔 근거

KOJ가 RabbitMQ로 겪은 문제들이 **구조적으로 사라집니다.**

| KOJ의 문제 | 여기서 |
|---|---|
| 메시지가 transient라 MQ 재시작에 유실 | 큐 상태가 행 자체다. 유실될 대상이 없다 |
| publish 실패로 `waiting` 고아 제출 누적 | INSERT가 곧 큐 등록이다. 둘이 어긋날 수 없다 |
| 재채점 수단 없음 | `status`를 `queued`로 되돌리는 UPDATE 한 줄 |
| 워커 급사 시 제출이 멈춤 | `heartbeat_at`이 끊긴 행을 다른 워커가 회수 |
| 컴포넌트 하나, 설정 파일 하나가 더 있음 | 없음 |

대신 포기한 것도 있습니다. **DB가 큐 부하를 같이 받습니다.** 대학 규모(피크에 분당 수백 건)에서
문제가 될 거라 보지 않지만, 이건 제가 측정한 값이 아니라 판단입니다. 실제로 병목이 되면 큐 부분만
별도 서비스로 떼는 건 [`queue.ts`](../packages/db/src/queue.ts)의 함수 서명만 유지하면 됩니다.

부분 인덱스로 큐 조회 비용을 제출 총량과 분리했습니다. 제출이 수백만 건 쌓여도 이 인덱스에는
`queued` 행만 들어갑니다.

```sql
CREATE INDEX submissions_queue_idx ON submissions (priority DESC, id ASC)
    WHERE status = 'queued';
```

### 지연

폴링 주기를 기다리지 않게 `LISTEN/NOTIFY`로 깨웁니다. 알림을 놓쳐도 `POLL_INTERVAL_MS` 폴링이
안전망이라 제출이 묻히지 않습니다. **알림 실패는 지연이지 유실이 아닙니다.**

### 임차(lease)와 회수

워커는 잡고 있는 제출에 15초마다 `heartbeat_at`을 찍습니다. 120초 동안 끊기면 다른 워커가
회수합니다. 시도 횟수가 3회를 넘으면 큐로 되돌리지 않고 `internal_error`로 확정합니다.
특정 제출에서만 워커가 죽는 경우 무한히 돌며 큐를 막기 때문입니다.

세 값은 [`packages/core/src/limits.ts`](../packages/core/src/limits.ts)에 있습니다. 15초와 120초는
**임의로 고른 값**입니다. 하트비트가 임차 만료보다 충분히 짧아야 한다는 제약만 지키면 됩니다.

## 상주 러너 풀

KOJ는 제출 한 건마다 `docker run`으로 컨테이너를 새로 띄웠고, 그 이미지에는 gcc, g++, JDK 24,
python, node, strace가 전부 들어 있었습니다.

여기서는 **언어별 컨테이너를 미리 올려 두고 isolate 박스만 빌려줍니다.**

```
ojik-runner-c-cpp   : gcc, g++, isolate
ojik-runner-python  : python3, isolate
ojik-runner-java    : openjdk-21-headless, isolate
```

파이썬 제출이 JDK를 끌고 다니지 않습니다. 제출당 비용이 컨테이너 기동에서 디렉터리 하나
만들기로 바뀝니다.

구현은 [`apps/worker/src/pool.ts`](../apps/worker/src/pool.ts)입니다.

### 박스 배분

`isolate --box-id=N`은 컨테이너 안의 `/var/local/lib/isolate/N`을 씁니다. 워커는 이 경로를
호스트에서 bind mount하므로, 박스 파일을 `docker exec` 없이 **직접 읽고 씁니다.**

컨테이너마다 박스 루트를 따로 줍니다(`{BOX_ROOT}/{runner}-{replica}`). 같은 루트를 공유하면
컨테이너 간에 box id가 충돌합니다.

### 테스트케이스

문제별 디렉터리를 러너 컨테이너에 **읽기 전용으로 붙입니다.**

```
{DATA_DIR}/problems/{problemId}/tc/{idx}.in
{DATA_DIR}/problems/{problemId}/tc/{idx}.out
```

실행 직전에 그 케이스 **한 개만** 박스에 복사합니다. KOJ는 제출마다 테스트케이스 **전체**를
`cp -r`로 영구 디스크에 복사하고 지우지 않았습니다. static 볼륨이 46GB가 된 경로입니다.

`BOX_ROOT`를 tmpfs에 두면 이 복사는 메모리 안에서 끝납니다. 채점 산출물은 전부 휘발성이라
디스크에 남길 이유가 없습니다.

### 병렬성

두 축이 있습니다.

| 설정 | 뜻 |
|---|---|
| `WORKER_CAPACITY` | 동시에 채점할 **제출** 수 |
| `WORKER_TC_PARALLEL` | 한 제출 안에서 동시에 돌릴 **테스트케이스** 수 |

**둘의 곱이 CPU 코어 수를 넘으면 안 됩니다.** 넘으면 측정 시간이 서로 방해받아 부풀고, 멀쩡한
풀이가 시간 초과로 떨어집니다. 채점 시간의 재현성이 처리량보다 중요합니다.

제출 하나는 박스를 `min(TC_PARALLEL, 케이스 수)`개 빌립니다. 첫 박스에서 컴파일하고, 산출물을
나머지 박스로 **한 번씩만** 복사한 뒤 케이스를 나눠 돌립니다. 케이스마다 복사하면 정적 링크된
C 바이너리에선 그 비용이 실행보다 커집니다.

## 실행 제한

`isolate` 호출 규약은 [`apps/worker/src/isolate.ts`](../apps/worker/src/isolate.ts) 한 곳에만
있습니다.

| 플래그 | 용도 |
|---|---|
| `--time` | CPU 시간 |
| `--wall-time` | 벽시계 시간. sleep으로 CPU를 안 쓰며 버티는 걸 끊음 |
| `--extra-time=0.5` | 상한을 살짝 넘겼을 때의 유예. 이 구간에서 끝나면 측정값은 진짜 값이 남음 |
| `--cg-mem` | cgroup 메모리 |
| `--processes` | 프로세스/스레드 상한 |
| `--fsize` | 출력 파일 크기 상한 |

메모리를 주소공간(`--mem`)이 아니라 **cgroup으로 재는 이유**는 JVM 때문입니다. JVM은 가상
메모리를 크게 예약해서, 주소공간으로 재면 힙을 쓰기도 전에 죽습니다.

### 언어별 보정

인터프리터와 VM은 기동 비용이 있습니다. [`languages.ts`](../packages/core/src/languages.ts)에서
문제 제한에 비율과 고정값을 더합니다.

| 언어 | 시간 배율 | 추가 시간 | 추가 메모리 |
|---|---|---|---|
| C, C++ | 100% | 0 | 0 |
| Python | 300% | 2000 ms | 32 MB |
| Java | 200% | 2000 ms | 256 MB |

**이 값들은 관례를 따른 임의값입니다.** 측정으로 정한 게 아닙니다. 문제 세트에 맞춰 조정할
대상이고, 조정하면 그 언어의 기존 판정이 바뀝니다.

Java는 `-XX:+UseSerialGC`로 돌립니다. 병렬 GC 스레드가 CPU 시간 측정을 흔들어서 같은 코드가
돌 때마다 다른 시간이 나오기 때문입니다.

## 판정

### 상태와 판정의 분리

`status`는 채점이 어디까지 갔는지, `verdict`는 결과입니다.

| status | 뜻 |
|---|---|
| `queued` | 큐 대기 |
| `judging` | 채점 중. `judgedCount / totalCount`로 진행률 표시 |
| `done` | 완료. 이때만 `verdict`에 값이 있음 |
| `canceled` | 취소 |

KOJ는 둘을 섞어서, 시간 초과나 런타임 에러가 최종적으로 `wrong_answer`로 뭉개졌습니다. 유형별
개수는 따로 저장했지만 학생 화면에 보이는 건 오답이었습니다.

### 집계

테스트케이스 결과 중 **가장 나쁜 것 하나**가 제출의 판정입니다. 서열은
[`verdict.ts`](../packages/core/src/verdict.ts)의 `SEVERITY`에 있습니다.

`stopOnFirstFail`이 켜져 있으면 첫 오답에서 나머지를 중단합니다. **이건 자원 절약이지 판정
규칙이 아닙니다.** 부분점수를 주려면 문제 설정에서 꺼야 합니다.

### 출력 비교

세 가지 중 문제마다 고릅니다.

| 방식 | 규칙 |
|---|---|
| `exact` | 바이트 단위 완전 일치 |
| `trim` | 줄 끝 공백 무시, 끝의 빈 줄 무시. **기본값** |
| `float` | 토큰 단위. 숫자는 오차 허용, 나머지는 완전 일치 |

기본을 `trim`으로 둔 이유는 "줄 끝 공백 때문에 틀렸습니다"가 반복되기 때문입니다. BOJ도 같은
규칙입니다.

`float`는 상대오차와 절대오차 중 **하나만 만족하면** 통과입니다. 값이 0 근처일 때 상대오차만
보면 사실상 완전 일치를 요구하게 됩니다.

## 보안 경계

솔직하게 적습니다. 경계가 두 겹입니다.

**안쪽은 isolate**입니다. 네임스페이스, seccomp, rlimit, cgroup으로 제출 코드를 가둡니다.
IOI 채점에 쓰이는 도구고, 이 계층은 신뢰할 만합니다.

**바깥쪽 컨테이너는 `--privileged`로 뜹니다.** isolate가 마운트 네임스페이스와 cgroup을 직접
다뤄야 하기 때문입니다. 이건 **바깥 경계가 그만큼 약하다**는 뜻입니다. isolate를 뚫으면
privileged 컨테이너 안이고, 거기서 호스트로 나가는 건 일반 컨테이너보다 쉽습니다.

완화 요소는 `--network none`(러너 컨테이너에 네트워크 없음)과 테스트케이스가 읽기 전용으로만
붙는다는 점입니다.

대학 실습과 교내 대회 수준에서는 표준적인 절충이고 KOJ도 같은 수준이었습니다. 위협 모델이
더 엄격하다면 선택지는 이렇습니다.

1. 러너를 **전용 VM**에 격리해서 privileged 컨테이너가 뚫려도 다른 서비스에 닿지 않게 합니다.
   가장 현실적입니다.
2. 제출마다 `docker run`으로 돌리고 콜드 스타트를 감수합니다. 바깥 경계는 단단해지지만 KOJ의
   성능 문제로 돌아갑니다.
3. gVisor나 Firecracker를 씁니다. 운영 복잡도가 크게 올라갑니다.

## 검증되지 않은 부분

정직하게 표시해 둡니다.

`isolate.ts`의 플래그 집합은 **isolate 1.10.1 문서를 보고 쓴 것이고 아직 실물로 확인하지
않았습니다.** 이미지를 빌드해서 [`scripts/smoke-judge.sh`](../scripts/smoke-judge.sh)를 돌리면
확인됩니다. isolate 2.x는 `--cg`를 없애는 등 플래그가 갈리므로,
[`Dockerfile.base`](../images/runner/Dockerfile.base)에서 버전을 고정해 뒀습니다. 그 태그를
올릴 때는 스모크 테스트를 먼저 돌려야 합니다.
