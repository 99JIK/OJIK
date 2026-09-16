import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { env } from "./env";

/**
 * 테스트케이스 파일 저장.
 *
 * 레이아웃: {DATA_DIR}/problems/{problemId}/tc/{idx}.in, {idx}.out
 * 워커가 이 디렉터리를 러너 컨테이너에 읽기 전용으로 붙인다. 제출마다 복사하지 않는다.
 *
 * DB 에는 경로가 아니라 sha256 과 크기를 넣는다. 경로 문자열만 들고 있으면 백업에서
 * DB 만 되돌렸을 때 행은 있고 파일은 없는 상태를 알아챌 방법이 없다. 해시가 있으면
 * scripts/check-data.ts 가 어긋난 지점을 짚어 준다.
 */

export function problemTcDir(problemId: number): string {
    return path.join(env.DATA_DIR, "problems", String(problemId), "tc");
}

export function sha256(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex");
}

export interface StoredFile {
    sha256: string;
    bytes: number;
}

export async function writeTestcaseFile(
    problemId: number,
    idx: number,
    kind: "in" | "out",
    content: string,
): Promise<StoredFile> {
    const dir = problemTcDir(problemId);
    await fs.mkdir(dir, { recursive: true });
    // 개행을 LF 로 통일한다. Windows 에서 만든 파일이 섞이면 기본 checker 로도 틀리게 나온다
    const normalized = content.replace(/\r\n?/g, "\n");
    const buf = Buffer.from(normalized, "utf8");
    await fs.writeFile(path.join(dir, `${idx}.${kind}`), buf);
    return { sha256: sha256(buf), bytes: buf.length };
}

export async function readTestcaseFile(
    problemId: number,
    idx: number,
    kind: "in" | "out",
): Promise<string> {
    return fs.readFile(path.join(problemTcDir(problemId), `${idx}.${kind}`), "utf8");
}

/** 테스트케이스 전체 교체 전에 비운다. 남은 파일이 새 순번과 섞이면 엉뚱한 걸 채점한다 */
export async function clearTestcaseDir(problemId: number): Promise<void> {
    await fs.rm(problemTcDir(problemId), { recursive: true, force: true });
    await fs.mkdir(problemTcDir(problemId), { recursive: true });
}

export async function removeProblemData(problemId: number): Promise<void> {
    await fs.rm(path.join(env.DATA_DIR, "problems", String(problemId)), {
        recursive: true,
        force: true,
    });
}
