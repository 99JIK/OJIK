import type { StepLimits } from "@ojik/core";

/**
 * isolate 호출 규약. 플래그 집합을 여기 한 곳에만 둔다.
 *
 * 대상은 isolate 2.7 이고 images/runner/Dockerfile.base 에서 그 태그로 고정한다.
 * 1.x 는 cgroup v1 전용이라 요즘 커널에서 안 뜬다.
 *
 * 아래 플래그는 2.7 의 --help 로 확인한 것이다. 버전을 올릴 때는
 * npm run smoke:judge 를 먼저 통과시킬 것. 그게 이 파일의 함수를 그대로 불러서 검증한다.
 */

export interface IsolateRunOptions {
    boxId: number;
    argv: string[];
    limits: StepLimits;
    /** 박스 디렉터리 기준 상대 경로. 없으면 /dev/null */
    stdinFile?: string;
    stdoutFile: string;
    stderrFile: string;
    /** 박스 밖 경로. isolate 가 여기에 실행 통계를 쓴다 */
    metaPath: string;
    /** 프로그램이 만들 수 있는 파일 크기 상한 KB. 출력 폭주를 파일 단계에서 끊는다 */
    fsizeKb: number;
    /** 추가로 열어 줄 디렉터리. "밖경로:안경로:옵션" 이 아니라 isolate 표기 그대로 */
    dirs?: string[];
    env?: Record<string, string>;
}

export function initArgs(boxId: number): string[] {
    return ["--cg", `--box-id=${boxId}`, "--init"];
}

export function cleanupArgs(boxId: number): string[] {
    return ["--cg", `--box-id=${boxId}`, "--cleanup"];
}

export function runArgs(o: IsolateRunOptions): string[] {
    const a = [
        "--cg",
        `--box-id=${o.boxId}`,
        `--processes=${o.limits.procLimit}`,
        // isolate 는 초 단위 실수를 받는다
        `--time=${(o.limits.timeMs / 1000).toFixed(3)}`,
        `--wall-time=${(o.limits.wallMs / 1000).toFixed(3)}`,
        // CPU 상한을 살짝 넘겼을 때 바로 죽이지 않고 조금 더 준다.
        // 이 구간에서 끝나면 TLE 로 보고되지만 측정 시간은 진짜 값이 남는다
        "--extra-time=0.5",
        // 주소공간(--mem)이 아니라 cgroup 메모리. JVM 은 가상메모리를 크게 잡아서
        // --mem 으로 재면 힙을 쓰기도 전에 죽는다
        `--cg-mem=${o.limits.memoryKb}`,
        `--fsize=${o.fsizeKb}`,
        `--meta=${o.metaPath}`,
        `--stdout=${o.stdoutFile}`,
        `--stderr=${o.stderrFile}`,
    ];
    if (o.stdinFile) a.push(`--stdin=${o.stdinFile}`);
    for (const d of o.dirs ?? []) a.push(`--dir=${d}`);

    // isolate 기본 환경은 거의 비어 있다. PATH 가 없으면 java 가 자기 헬퍼를 못 찾는다
    const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/box", ...(o.env ?? {}) };
    for (const [k, v] of Object.entries(env)) a.push(`--env=${k}=${v}`);

    a.push("--run", "--", ...o.argv);
    return a;
}

/** isolate meta 파일. key:value 한 줄씩 */
export interface IsolateMeta {
    /** CPU 시간 초 */
    time: number;
    /** 벽시계 시간 초 */
    timeWall: number;
    /** cgroup 이 잰 최대 메모리 KB. 없으면 max-rss 로 대체 */
    memoryKb: number;
    exitcode: number | null;
    /** 죽인 시그널 번호 */
    exitsig: number | null;
    /** OK 면 없음. TO 시간초과, SG 시그널, RE 비정상 종료, XX isolate 내부 오류 */
    status: "TO" | "SG" | "RE" | "XX" | null;
    message: string;
    killed: boolean;
}

export function parseMeta(text: string): IsolateMeta {
    const m = new Map<string, string>();
    for (const line of text.split("\n")) {
        const i = line.indexOf(":");
        if (i > 0) m.set(line.slice(0, i), line.slice(i + 1));
    }
    const num = (k: string): number => {
        const v = m.get(k);
        return v === undefined ? 0 : Number(v);
    };
    const cgMem = num("cg-mem");
    const status = m.get("status");
    return {
        time: num("time"),
        timeWall: num("time-wall"),
        memoryKb: cgMem > 0 ? cgMem : num("max-rss"),
        exitcode: m.has("exitcode") ? num("exitcode") : null,
        exitsig: m.has("exitsig") ? num("exitsig") : null,
        status: status === "TO" || status === "SG" || status === "RE" || status === "XX" ? status : null,
        message: m.get("message") ?? "",
        killed: m.get("killed") === "1",
    };
}

export type RunOutcome =
    | "ok"
    | "time_limit_exceeded"
    | "memory_limit_exceeded"
    | "runtime_error"
    | "output_limit_exceeded"
    | "internal_error";

/**
 * meta 를 판정으로 옮긴다. isolate 는 메모리 초과를 따로 알려주지 않고
 * OOM killer 가 보낸 시그널로만 나타난다. 그래서 상한 근처인지를 같이 본다.
 *
 * 임계 95% 는 임의로 고른 값이다. cgroup 이 보고하는 최대값이 상한과 정확히 같지 않은
 * 경우가 있어서 여유를 둔 것이지, 이 숫자에 근거가 있는 건 아니다.
 */
export function classify(meta: IsolateMeta, limits: StepLimits): RunOutcome {
    if (meta.status === "XX") return "internal_error";
    if (meta.status === "TO") return "time_limit_exceeded";

    const nearMemLimit = meta.memoryKb >= limits.memoryKb * 0.95;

    if (meta.status === "SG") {
        // SIGKILL(9) 이면서 메모리 상한 근처면 OOM 으로 본다
        if (nearMemLimit) return "memory_limit_exceeded";
        // SIGXFSZ(25) 는 --fsize 초과. 출력 폭주
        if (meta.exitsig === 25) return "output_limit_exceeded";
        return "runtime_error";
    }
    if (meta.status === "RE") {
        if (nearMemLimit) return "memory_limit_exceeded";
        return "runtime_error";
    }

    // status 가 없어도 CPU 시간이 상한을 넘겨 있으면 TLE. extra-time 구간에서 끝난 경우
    if (meta.time * 1000 > limits.timeMs) return "time_limit_exceeded";
    if (meta.exitcode !== null && meta.exitcode !== 0) return "runtime_error";
    return "ok";
}
