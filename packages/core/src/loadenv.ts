import fs from "node:fs";
import path from "node:path";

/**
 * 저장소 루트의 .env 를 찾아 읽는다.
 *
 * npm workspace 스크립트는 cwd 가 각 워크스페이스 디렉터리라, cwd 의 .env 만 보는 방식으로는
 * 루트 파일을 못 찾는다. 앱마다 상대 경로를 박으면 디렉터리 깊이가 바뀔 때 조용히 깨진다.
 * 그래서 위로 올라가며 찾는다.
 *
 * node 22 의 process.loadEnvFile 을 쓴다. dotenv 의존성이 필요 없다.
 * 이미 설정된 환경변수는 덮어쓰지 않는다. 운영에서 systemd 나 컨테이너가 넘긴 값이 우선이다.
 */

/** .env 에 상대 경로로 적어도 되는 항목. .env 파일이 있는 자리를 기준으로 절대경로로 바꾼다 */
const PATH_VARS = ["DATA_DIR", "BOX_ROOT"] as const;

export interface LoadedEnv {
    /** 찾은 .env 경로. 못 찾았으면 null */
    file: string | null;
    /** 상대 경로의 기준이 된 디렉터리 */
    root: string;
}

export function loadEnv(startDir: string = process.cwd()): LoadedEnv {
    let dir = path.resolve(startDir);
    for (;;) {
        const candidate = path.join(dir, ".env");
        if (fs.existsSync(candidate)) {
            process.loadEnvFile(candidate);
            resolvePaths(dir);
            return { file: candidate, root: dir };
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            // .env 가 없어도 진행한다. 운영에서는 환경변수를 직접 주입하는 게 정상이다
            resolvePaths(process.cwd());
            return { file: null, root: process.cwd() };
        }
        dir = parent;
    }
}

/**
 * DATA_DIR 처럼 경로를 담는 변수를 절대경로로 고정한다.
 *
 * api 는 apps/api 에서, worker 는 apps/worker 에서 뜨는데 둘이 같은 DATA_DIR 을 봐야 한다.
 * 상대 경로를 그대로 두면 프로세스마다 다른 곳을 가리키고, 증상은 "채점은 도는데
 * 테스트케이스가 없다"로 나타난다. KOJ 에서 백엔드와 워커의 Static 경로가 어긋날 수 있던 것과
 * 같은 종류의 문제다.
 */
function resolvePaths(root: string): void {
    for (const key of PATH_VARS) {
        const v = process.env[key];
        if (v && !path.isAbsolute(v)) {
            process.env[key] = path.resolve(root, v);
        }
    }
}
