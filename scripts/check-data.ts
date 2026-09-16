import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { asc } from "drizzle-orm";
import { loadEnv } from "@ojik/core/env";
import { createDb, testcases, problems } from "@ojik/db";

loadEnv();

/**
 * DB 의 테스트케이스 행과 실제 파일이 맞는지 본다.
 *
 * KOJ 는 DB 에 경로 문자열만 들고 있어서, 백업에서 DB 만 되돌리면 행은 있고 파일은 없는
 * 상태가 되는데 그걸 알아챌 방법이 없었다. 여기서는 sha256 을 들고 있으니 세 가지를 구분한다.
 * 파일 없음, 내용 다름, 정상.
 *
 * 아무것도 고치지 않는다. 읽기만 한다.
 */

const url = process.env.DATABASE_URL;
const dataDir = process.env.DATA_DIR;
if (!url || !dataDir) {
    console.error("DATABASE_URL 과 DATA_DIR 이 필요합니다.");
    process.exit(1);
}

const h = createDb(url, { max: 1 });

const rows = await h.db.select().from(testcases).orderBy(asc(testcases.problemId), asc(testcases.idx));
const problemRows = await h.db.select({ id: problems.id, title: problems.title }).from(problems);
const titles = new Map(problemRows.map((p) => [p.id, p.title]));

let ok = 0;
const missing: string[] = [];
const mismatched: string[] = [];

async function verify(
    problemId: number,
    idx: number,
    kind: "in" | "out",
    expectedSha: string,
    expectedBytes: number,
): Promise<void> {
    const file = path.join(dataDir!, "problems", String(problemId), "tc", `${idx}.${kind}`);
    let buf: Buffer;
    try {
        buf = await fs.readFile(file);
    } catch {
        missing.push(`문제 ${problemId} (${titles.get(problemId) ?? "?"}) tc ${idx}.${kind}`);
        return;
    }
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== expectedSha || buf.length !== expectedBytes) {
        mismatched.push(
            `문제 ${problemId} tc ${idx}.${kind}: DB ${expectedBytes}B/${expectedSha.slice(0, 12)}, 파일 ${buf.length}B/${sha.slice(0, 12)}`,
        );
        return;
    }
    ok++;
}

for (const t of rows) {
    await verify(t.problemId, t.idx, "in", t.inputSha256, t.inputBytes);
    await verify(t.problemId, t.idx, "out", t.outputSha256, t.outputBytes);
}

// 반대 방향도 본다. DB 에 없는데 디스크에 남은 문제 디렉터리
const orphanDirs: string[] = [];
const problemsRoot = path.join(dataDir, "problems");
try {
    const known = new Set(problemRows.map((p) => String(p.id)));
    for (const entry of await fs.readdir(problemsRoot)) {
        if (!known.has(entry)) orphanDirs.push(entry);
    }
} catch {
    // 디렉터리가 아직 없으면 넘어간다
}

console.log(`정상 ${ok}개 파일`);
if (missing.length) {
    console.log(`\n파일 없음 ${missing.length}건:`);
    for (const m of missing.slice(0, 50)) console.log(`  ${m}`);
    if (missing.length > 50) console.log(`  ... 외 ${missing.length - 50}건`);
}
if (mismatched.length) {
    console.log(`\n내용 다름 ${mismatched.length}건:`);
    for (const m of mismatched.slice(0, 50)) console.log(`  ${m}`);
}
if (orphanDirs.length) {
    console.log(`\nDB 에 없는 문제 디렉터리 ${orphanDirs.length}개: ${orphanDirs.slice(0, 20).join(", ")}`);
    console.log("문제를 지웠는데 파일이 남은 경우입니다. 지워도 됩니다.");
}

await h.close();
// 파일이 없거나 다르면 채점이 틀리게 돈다. 종료 코드로 알린다
process.exit(missing.length + mismatched.length > 0 ? 1 : 0);
