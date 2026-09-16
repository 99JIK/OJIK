import os from "node:os";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { judgeEnvironments, type Db } from "@ojik/db";
import { config } from "./config";
import { log } from "./log";
import type { RunnerPool } from "./pool";

/**
 * 이 워커가 채점하는 환경을 기록하고 id 를 돌려준다.
 *
 * 시간과 메모리 값은 어떤 기계에서 어떤 컴파일러로 쟀는지를 모르면 해석할 수 없다.
 * 특히 성능 코어와 효율 코어가 섞인 CPU 에서는 같은 코드가 2배까지 차이 나므로,
 * 환경을 안 남기면 나중에 그 데이터로 아무것도 못 한다.
 *
 * 기동 때 한 번만 부른다. 이미지가 바뀌면 지문이 달라져 새 행이 생긴다.
 */
export async function resolveJudgeEnv(db: Db, pool: RunnerPool): Promise<number | null> {
    try {
        const desc = await pool.describeEnvironment();
        const parts = [config.WORKER_ID, os.hostname(), process.arch, desc.runnerImages, desc.isolateVersion];
        const fingerprint = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);

        const [row] = await db
            .insert(judgeEnvironments)
            .values({
                fingerprint,
                workerId: config.WORKER_ID,
                hostname: os.hostname(),
                arch: process.arch,
                runnerImages: desc.runnerImages,
                isolateVersion: desc.isolateVersion,
            })
            .onConflictDoUpdate({
                target: judgeEnvironments.fingerprint,
                set: { lastSeenAt: new Date() },
            })
            .returning({ id: judgeEnvironments.id });

        if (row) {
            log.info("judge environment", { id: row.id, fingerprint, arch: process.arch });
            return row.id;
        }

        // onConflictDoUpdate 가 아무것도 안 돌려준 경우. 기존 행을 찾는다
        const [existing] = await db
            .select({ id: judgeEnvironments.id })
            .from(judgeEnvironments)
            .where(eq(judgeEnvironments.fingerprint, fingerprint));
        return existing?.id ?? null;
    } catch (e) {
        // 환경 기록에 실패해도 채점은 돌아야 한다. 값이 null 이면 나중에 해석을 못 할 뿐이다
        log.warn("채점 환경을 기록하지 못했습니다", { err: e instanceof Error ? e.message : String(e) });
        return null;
    }
}

/** 오래된 환경을 정리할 일이 생기면 쓰는 자리. 지금은 안 지운다 */
export async function touchJudgeEnv(db: Db, id: number): Promise<void> {
    await db
        .update(judgeEnvironments)
        .set({ lastSeenAt: sql`now()` })
        .where(eq(judgeEnvironments.id, id));
}
