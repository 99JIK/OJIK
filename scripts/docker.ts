import { spawn } from "node:child_process";

/**
 * docker CLI 호출 헬퍼.
 *
 * 셸을 거치지 않고 docker 를 직접 실행한다. npm 스크립트에서 bash 를 부르면
 * Windows 에서 PATH 의 bash 가 Git Bash 가 아니라 WSL 런처(System32\\bash.exe)로 잡힌다.
 * WSL 이 설정돼 있지 않으면 거기서 매달린다. KOJ 운영 스크립트도 같은 덫을 밟았다.
 */

export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

export function docker(args: string[], opts: { inherit?: boolean; input?: string } = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const p = spawn("docker", args, {
            stdio: [opts.input !== undefined ? "pipe" : "ignore", opts.inherit ? "inherit" : "pipe", opts.inherit ? "inherit" : "pipe"],
            // shell:false 가 기본. 인자가 셸 해석을 안 거치므로 따옴표 걱정이 없다
            shell: false,
        });

        let stdout = "";
        let stderr = "";
        p.stdout?.on("data", (c) => (stdout += c));
        p.stderr?.on("data", (c) => (stderr += c));

        if (opts.input !== undefined) {
            p.stdin!.end(opts.input);
        }

        p.on("error", (e) => {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                reject(new Error("docker 명령을 찾을 수 없습니다. Docker Desktop 이 실행 중인지 확인하세요."));
                return;
            }
            reject(e);
        });
        p.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}

/** 실패하면 던진다. 성공을 전제로 하는 단계에 쓴다 */
export async function dockerOrThrow(args: string[], what: string): Promise<RunResult> {
    const r = await docker(args);
    if (r.code !== 0) {
        throw new Error(`${what} 실패 (exit ${r.code})\n${r.stderr || r.stdout}`);
    }
    return r;
}

export async function imageExists(tag: string): Promise<boolean> {
    return (await docker(["image", "inspect", tag])).code === 0;
}

export async function removeContainer(name: string): Promise<void> {
    await docker(["rm", "-f", name]);
}
