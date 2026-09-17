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

/**
 * 본문에 넣는 그림.
 *
 * 레이아웃: {DATA_DIR}/uploads/{sha 앞 2글자}/{sha}.{ext}
 *
 * 이름이 내용 해시라서 같은 그림을 여러 번 올려도 한 벌만 남는다. 앞 2글자로 한 단계
 * 나누는 건 디렉터리 하나에 파일이 수만 개 쌓이는 걸 피하려는 것이다.
 *
 * DB 에 행을 안 만든다. 본문의 마크다운이 곧 참조이고, 그걸 세어서 고아 파일을 지우는
 * 일은 지금 규모에서 필요 없다. 파일이 남는 쪽이 본문에서 그림이 사라지는 것보다 낫다.
 */
export function uploadPath(name: string): string {
    return path.join(env.DATA_DIR, "uploads", name.slice(0, 2), name);
}

export async function writeUpload(name: string, buf: Buffer): Promise<void> {
    const p = uploadPath(name);
    await fs.mkdir(path.dirname(p), { recursive: true });
    // 내용 해시라 이미 있으면 같은 파일이다. 다시 쓸 이유가 없다
    try {
        await fs.access(p);
        return;
    } catch {
        await fs.writeFile(p, buf);
    }
}

export async function readUpload(name: string): Promise<Buffer | null> {
    try {
        return await fs.readFile(uploadPath(name));
    } catch {
        return null;
    }
}
