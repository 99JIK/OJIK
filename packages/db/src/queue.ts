import { sql, eq, and, inArray, asc, desc } from "drizzle-orm";
import { MAX_JUDGE_ATTEMPTS, JUDGE_LEASE_TIMEOUT_MS } from "@ojik/core";
import type { Db } from "./client";
import { submissions, submissionResults, type Submission } from "./schema/submissions";

/** 워커를 깨우는 LISTEN/NOTIFY 채널. 폴링 주기를 기다리지 않게 한다 */
export const QUEUE_CHANNEL = "ojik_judge_queue";

/**
 * 배열 파라미터는 = ANY(...) 로 넘기지 않는다.
 *
 * drizzle 의 sql 템플릿이 배열을 파라미터로 넘기면 postgres-js 가 원소를 문자열로 직렬화하려다
 * 숫자 배열에서 터진다(ERR_INVALID_ARG_TYPE). inArray 는 IN (?, ?, ?) 로 펼쳐서 이 경로를 피한다.
 * 이걸 모르고 raw SQL 로 ANY 를 쓰면 재채점과 heartbeat 가 통째로 죽는다.
 */

/**
 * 큐에 넣는 유일한 경로. 신규 제출의 재등록과 재채점이 같은 함수를 쓴다.
 * NOTIFY 를 여기서만 치므로 "큐에는 넣었는데 워커가 안 깨는" 경우가 안 생긴다.
 *
 * 트랜잭션 안에서 부르면 NOTIFY 도 커밋 시점에 나간다. 롤백되면 알림도 안 나감.
 */
export async function enqueue(db: Db, submissionIds: number[]): Promise<void> {
    if (submissionIds.length === 0) return;

    await db
        .update(submissions)
        .set({
            status: "queued",
            verdict: null,
            score: 0,
            judgedCount: 0,
            maxTimeMs: null,
            maxMemoryKb: null,
            compileOutput: null,
            judgeError: null,
            attempts: 0,
            claimedBy: null,
            claimedAt: null,
            heartbeatAt: null,
            judgedAt: null,
            queuedAt: new Date(),
        })
        .where(inArray(submissions.id, submissionIds));

    // 재채점이면 이전 결과가 남아 있다. 지우지 않으면 새 결과와 섞인다.
    // KOJ 워커는 작업 디렉터리를 안 비워서 정확히 이 문제가 있었다
    await db.delete(submissionResults).where(inArray(submissionResults.submissionId, submissionIds));

    await notifyQueue(db);
}

/**
 * 큐에서 최대 limit 건을 집어 이 워커 소유로 표시한다.
 * SKIP LOCKED 라 여러 워커가 동시에 불러도 같은 행을 두 번 집지 않는다.
 * 잠금은 UPDATE 커밋과 함께 풀리고, 그 뒤로는 status='judging' 이 소유권을 나타낸다.
 *
 * UPDATE 는 raw SQL 이라 결과 컬럼이 snake_case 로 나온다. 그대로 돌려주면 호출부가
 * sub.problemId 를 읽었을 때 undefined 가 된다. 그래서 id 만 받아 오고 본문은
 * 쿼리 빌더로 다시 읽는다. 이미 우리 소유로 확정된 행이라 그 사이에 바뀌지 않는다.
 */
export async function claimNext(db: Db, workerId: string, limit: number): Promise<Submission[]> {
    if (limit <= 0) return [];

    const claimed = await db.execute<{ id: number }>(sql`
        WITH picked AS (
            SELECT id FROM submissions
            WHERE status = 'queued'
            ORDER BY priority DESC, id ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE submissions s
        SET status = 'judging',
            claimed_by = ${workerId},
            claimed_at = now(),
            heartbeat_at = now(),
            attempts = s.attempts + 1
        FROM picked
        WHERE s.id = picked.id
        RETURNING s.id
    `);

    const ids = (claimed as unknown as { id: number }[]).map((r) => r.id);
    if (ids.length === 0) return [];

    return db
        .select()
        .from(submissions)
        .where(inArray(submissions.id, ids))
        .orderBy(desc(submissions.priority), asc(submissions.id));
}

/** 잡고 있는 제출들이 아직 살아 있다고 알린다. 이게 끊기면 다른 워커가 회수한다 */
export async function heartbeat(db: Db, workerId: string, submissionIds: number[]): Promise<void> {
    if (submissionIds.length === 0) return;
    await db
        .update(submissions)
        .set({ heartbeatAt: new Date() })
        .where(
            and(
                inArray(submissions.id, submissionIds),
                eq(submissions.claimedBy, workerId),
                eq(submissions.status, "judging"),
            ),
        );
}

/**
 * 죽은 워커가 잡고 있던 제출을 회수한다.
 * 시도 횟수가 상한을 넘었으면 큐로 되돌리지 않고 internal_error 로 확정한다.
 * 안 그러면 특정 제출에서만 워커가 죽는 경우 무한히 돌며 큐를 막는다.
 */
export async function reclaimStale(db: Db, timeoutMs = JUDGE_LEASE_TIMEOUT_MS): Promise<number> {
    const rows = await db.execute<{ id: number }>(sql`
        UPDATE submissions
        SET status = CASE WHEN attempts >= ${MAX_JUDGE_ATTEMPTS} THEN 'done'::submission_status ELSE 'queued'::submission_status END,
            verdict = CASE WHEN attempts >= ${MAX_JUDGE_ATTEMPTS} THEN 'internal_error'::verdict ELSE NULL END,
            judge_error = CASE WHEN attempts >= ${MAX_JUDGE_ATTEMPTS}
                               THEN 'lease expired after ' || attempts || ' attempts (last worker: ' || coalesce(claimed_by, '?') || ')'
                               ELSE judge_error END,
            judged_at = CASE WHEN attempts >= ${MAX_JUDGE_ATTEMPTS} THEN now() ELSE NULL END,
            claimed_by = NULL,
            claimed_at = NULL,
            heartbeat_at = NULL,
            queued_at = now()
        WHERE status = 'judging'
          AND heartbeat_at < now() - make_interval(secs => ${timeoutMs / 1000})
        RETURNING id
    `);
    const reclaimed = rows as unknown as { id: number }[];
    if (reclaimed.length > 0) await notifyQueue(db);
    return reclaimed.length;
}

/** 대기 현황. 화면과 헬스체크가 같은 값을 본다 */
export async function queueStats(
    db: Db,
): Promise<{ queued: number; judging: number; oldestQueuedSec: number }> {
    const rows = await db.execute<{ queued: string; judging: string; oldest: string | null }>(sql`
        SELECT
            count(*) FILTER (WHERE status = 'queued')  AS queued,
            count(*) FILTER (WHERE status = 'judging') AS judging,
            extract(epoch FROM now() - min(queued_at) FILTER (WHERE status = 'queued')) AS oldest
        FROM submissions
    `);
    const r = (rows as unknown as { queued: string; judging: string; oldest: string | null }[])[0];
    return {
        queued: Number(r?.queued ?? 0),
        judging: Number(r?.judging ?? 0),
        oldestQueuedSec: Math.round(Number(r?.oldest ?? 0)),
    };
}

/** 워커를 깨우기만 한다. 신규 제출은 이미 status='queued' 로 들어가므로 UPDATE 가 필요 없다 */
export async function notifyQueue(db: Db): Promise<void> {
    await db.execute(sql`SELECT pg_notify(${QUEUE_CHANNEL}, '')`);
}
