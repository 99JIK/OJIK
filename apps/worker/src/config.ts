import os from "node:os";
import { z } from "zod";
import { loadEnv } from "@ojik/core/env";

loadEnv();

// 설정은 env 하나로만 받는다. 파일 탐색 규칙이 없으니 "어느 디렉터리에서 띄웠냐"에 따라
// 동작이 달라질 여지가 없다. KOJ 워커는 viper.AddConfigPath(".") 하나뿐이라
// WorkingDirectory 가 어긋나면 빈 설정으로 떠서 MQ 장애처럼 보였다.

const Schema = z.object({
    DATABASE_URL: z.string().min(1),

    /** 이 워커의 식별자. 제출의 claimed_by 에 박히므로 사람이 알아볼 수 있어야 한다 */
    WORKER_ID: z.string().min(1).default(`${os.hostname()}-${process.pid}`),

    /** 동시에 채점할 제출 수. CPU 코어 수를 넘기면 시간 측정이 서로를 방해한다 */
    WORKER_CAPACITY: z.coerce.number().int().positive().default(2),

    /** 한 제출 안에서 테스트케이스를 몇 개까지 동시에 돌릴지.
     *  CAPACITY * TC_PARALLEL 이 코어 수를 넘지 않게 잡을 것. 넘으면 측정 시간이 부풀어
     *  멀쩡한 풀이가 시간 초과로 떨어진다 */
    WORKER_TC_PARALLEL: z.coerce.number().int().positive().default(2),

    /** 테스트케이스 원본. 문제당 {DATA_DIR}/problems/{id}/tc/{idx}.in|.out.
     *  러너 컨테이너에 읽기 전용으로 붙는다. 제출마다 복사하지 않는다 */
    DATA_DIR: z.string().min(1),

    /** isolate 박스 루트. 러너 컨테이너의 /var/local/lib/isolate 와 같은 실체여야 한다.
     *  tmpfs 를 권장한다. 채점 산출물은 전부 휘발성이고 디스크에 남길 이유가 없다 */
    BOX_ROOT: z.string().min(1),

    /** 러너 이미지 태그 접두어. ojik-runner-c-cpp 처럼 뒤에 runner id 가 붙는다 */
    RUNNER_IMAGE_PREFIX: z.string().default("ojik-runner"),
    RUNNER_CONTAINER_PREFIX: z.string().default("ojik-runner"),

    /** 러너 이미지 하나당 띄울 컨테이너 수. 보통 1 이면 충분하다.
     *  isolate 박스가 컨테이너 안에서 갈라지므로 병렬성은 박스 수로 낸다 */
    RUNNER_REPLICAS: z.coerce.number().int().positive().default(1),

    /**
     * 이 워커가 쓸 isolate 박스 id 의 시작값.
     *
     * 샌드박스 uid 는 isolate 설정의 first_uid + box_id 다. privileged 컨테이너는 호스트 uid
     * 공간을 공유하므로, 박스 id 가 겹치면 컨테이너가 달라도 같은 uid 를 쓴다.
     * RLIMIT_NPROC 은 uid 단위라 java 가 스레드를 많이 띄우면 같은 uid 를 쓰는 python 제출이
     * execve 에서 EAGAIN 으로 죽는다. 간헐적이라 원인 찾기가 아주 나쁘다.
     *
     * 그래서 박스 id 는 러너와 replica 를 가로질러 전역으로 겹치지 않게 배분한다.
     * 한 호스트에 워커를 여럿 띄우면 워커마다 이 값을 달리 줘야 한다.
     * 상한은 러너 이미지 설정의 num_boxes(1000)다.
     */
    BOX_ID_BASE: z.coerce.number().int().min(0).default(0),

    /** 비워 두면 플랫폼에 맞게 고른다. 자세한 건 dockerEndpoints() */
    DOCKER_SOCKET: z.string().optional(),
    /** dockerode 는 DOCKER_HOST 를 직접 안 본다. 여기서 받아 후보 목록에 넣는다 */
    DOCKER_HOST: z.string().optional(),

    /** 큐에 아무것도 없을 때 다시 볼 때까지의 간격.
     *  NOTIFY 로 깨우므로 이 값이 지연을 결정하진 않는다. 알림을 놓쳤을 때의 안전망 */
    POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
    // 조용히 계속 가지 않는다. 빈 설정으로 떠서 엉뚱한 곳에서 죽는 게 제일 나쁘다
    console.error("설정이 올바르지 않습니다:");
    for (const issue of parsed.error.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

/**
 * docker 엔진에 붙을 후보 목록. 앞에서부터 시도한다.
 *
 * Windows 의 Docker Desktop 은 유닉스 소켓이 아니라 named pipe 를 쓴다.
 * 파이프 이름도 버전에 따라 갈려서(docker_engine, dockerDesktopLinuxEngine) 하나로 못 박는다.
 * DOCKER_SOCKET 을 명시하면 그것만 쓴다.
 */
export function dockerEndpoints(): { socketPath: string }[] {
    if (config.DOCKER_SOCKET) return [{ socketPath: config.DOCKER_SOCKET }];

    if (process.platform === "win32") {
        return [
            { socketPath: "//./pipe/dockerDesktopLinuxEngine" },
            { socketPath: "//./pipe/docker_engine" },
        ];
    }
    return [{ socketPath: "/var/run/docker.sock" }];
}
