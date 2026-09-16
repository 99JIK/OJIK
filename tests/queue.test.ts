import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { loadEnv } from "@ojik/core/env";
import { MAX_JUDGE_ATTEMPTS } from "@ojik/core";
import {
    createDb,
    claimNext,
    heartbeat,
    reclaimStale,
    enqueue,
    queueStats,
    submissions,
    type DbHandle,
} from "@ojik/db";

/**
 * 큐 동작 테스트. 실제 Postgres 가 필요하다.
 *
 * 워커는 리눅스에서만 돌지만 큐는 순수 DB 로직이라 어디서든 검증된다.
 * 여기가 통과하면 "제출이 유실되거나, 두 워커가 같은 걸 집거나, 죽은 워커가 큐를 막는" 일은 없다.
 *
 * 테이블을 비우므로 개발 DB 에서만 돌릴 것. submissions 와 submission_results 를 지운다.
 */

loadEnv();

const url = process.env.DATABASE_URL;
let h: DbHandle;

/**
 * 워커가 떠 있으면 테스트가 만든 큐 행을 가로채서 결과가 흔들린다.
 * 조용히 실패하면 원인을 찾는 데 오래 걸리므로 시작할 때 분명히 막는다.
 */
async function ensureNoLiveWorker(h: DbHandle): Promise<void> {
    const rows = await h.db.execute<{ id: string }>(sql`
        SELECT id FROM judge_workers WHERE last_seen_at > now() - interval '60 seconds'
    `);
    const live = Array.from(rows as Iterable<{ id: string }>);
    if (live.length > 0) {
        throw new Error(
            `워커가 돌고 있습니다 (${live.map((w) => w.id).join(", ")}).
` +
                `  테스트가 만든 제출을 워커가 가로채서 결과가 흔들립니다. 워커를 멈추고 다시 돌리세요.`,
        );
    }
}

before(async () => {
    if (!url) throw new Error("DATABASE_URL 이 없습니다. npm run infra:up 후 다시 돌리세요.");
    h = createDb(url, { max: 6 });
    await ensureNoLiveWorker(h);
    // 문제 1 과 사용자 2 가 있어야 한다. 없으면 시드가 안 돌아간 것
    const [p] = await h.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM problems`);
    const [u] = await h.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM users`);
    if (Number((p as any).n) === 0 || Number((u as any).n) === 0) {
        throw new Error("시드 데이터가 없습니다. npm run db:seed 를 먼저 돌리세요.");
    }
});

after(async () => {
    await clean();
    await h.close();
});

beforeEach(clean);

async function clean() {
    await h.db.execute(sql`DELETE FROM submission_results`);
    await h.db.execute(sql`DELETE FROM submissions`);
    await h.db.execute(sql`DELETE FROM judge_environments`);
    await h.db.execute(sql`UPDATE users SET solved_count = 0, submission_count = 0`);
    await h.db.execute(sql`UPDATE problems SET accepted_count = 0, submission_count = 0`);
}

const SRC = "int main(){return 0;}";

async function mk(n: number, priority = 0): Promise<number[]> {
    const [p] = await h.db.execute<{ id: number }>(sql`SELECT min(id)::int AS id FROM problems`);
    const [u] = await h.db.execute<{ id: number }>(sql`SELECT min(id)::int AS id FROM users`);
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
        const [r] = await h.db
            .insert(submissions)
            .values({
                problemId: Number((p as any).id),
                userId: Number((u as any).id),
                language: "c",
                sourceCode: SRC,
                sourceBytes: SRC.length,
                status: "queued",
                priority,
            })
            .returning({ id: submissions.id });
        ids.push(r!.id);
    }
    return ids;
}

async function row(id: number) {
    const [r] = await h.db.select().from(submissions).where(sql`id = ${id}`);
    return r!;
}

test("동시 claim 에서 같은 행을 두 번 집지 않는다", async () => {
    await mk(10);
    const [a, b, c] = await Promise.all([
        claimNext(h.db, "w-a", 4),
        claimNext(h.db, "w-b", 4),
        claimNext(h.db, "w-c", 4),
    ]);
    const all = [...a, ...b, ...c].map((s) => s.id);
    assert.equal(all.length, 10, "10건 전부 집혀야 한다");
    assert.equal(new Set(all).size, all.length, "중복 없이 나뉘어야 한다");

    const st = await queueStats(h.db);
    assert.deepEqual({ q: st.queued, j: st.judging }, { q: 0, j: 10 });
});

test("claim 결과가 camelCase 로 온다", async () => {
    // raw SQL 의 RETURNING 을 그대로 돌려주면 snake_case 라 judge.ts 가 전부 undefined 를 읽는다.
    // 워커가 통째로 못 도는 버그였다
    await mk(1);
    const [s] = await claimNext(h.db, "w-case", 1);
    assert.ok(s, "한 건은 집혀야 한다");
    assert.equal(typeof s.problemId, "number", "problemId 가 있어야 한다");
    assert.equal(typeof s.sourceCode, "string", "sourceCode 가 있어야 한다");
    assert.equal(s.claimedBy, "w-case");
    assert.equal(s.attempts, 1);
});

test("우선순위가 높은 것을 먼저 집는다", async () => {
    await mk(3, 0);
    const high = await mk(2, 100);
    const picked = await claimNext(h.db, "w-p", 2);
    assert.deepEqual(picked.map((s) => s.id).sort(), [...high].sort());
});

test("죽은 워커의 제출을 회수한다", async () => {
    const [id] = await mk(1);
    await claimNext(h.db, "w-dead", 1);
    await h.db.execute(sql`UPDATE submissions SET heartbeat_at = now() - interval '10 minutes' WHERE id = ${id}`);

    assert.equal(await reclaimStale(h.db), 1);
    const r = await row(id!);
    assert.equal(r.status, "queued");
    assert.equal(r.claimedBy, null);
});

test("살아 있는 워커의 제출은 뺏지 않는다", async () => {
    const [id] = await mk(1);
    await claimNext(h.db, "w-alive", 1);
    await heartbeat(h.db, "w-alive", [id!]);
    assert.equal(await reclaimStale(h.db), 0);
});

test("heartbeat 는 남의 제출을 건드리지 않는다", async () => {
    const ids = await mk(2);
    await claimNext(h.db, "w-1", 1);
    await claimNext(h.db, "w-2", 1);
    const before = await row(ids[1]!);
    await heartbeat(h.db, "w-1", ids);
    const after = await row(ids[1]!);
    assert.equal(after.heartbeatAt?.getTime(), before.heartbeatAt?.getTime(), "w-2 의 행이 갱신되면 안 된다");
});

test("시도 횟수를 넘기면 큐로 안 돌리고 확정한다", async () => {
    const [id] = await mk(1);
    for (let i = 0; i < MAX_JUDGE_ATTEMPTS; i++) {
        await claimNext(h.db, "w-x", 1);
        await h.db.execute(sql`UPDATE submissions SET heartbeat_at = now() - interval '10 minutes' WHERE id = ${id}`);
        await reclaimStale(h.db);
    }
    const r = await row(id!);
    // 특정 제출에서만 워커가 죽으면 무한히 돌며 큐를 막는다. 그걸 막는 장치
    assert.equal(r.status, "done");
    assert.equal(r.verdict, "internal_error");
    assert.ok(r.judgeError && r.judgeError.length > 0, "사유가 남아야 운영자가 추적한다");
    assert.equal((await queueStats(h.db)).queued, 0);
});

test("재채점이 상태와 이전 결과를 되돌린다", async () => {
    const [id] = await mk(1);
    await claimNext(h.db, "w-r", 1);
    await h.db.execute(sql`
        UPDATE submissions SET status = 'done', verdict = 'wrong_answer', score = 40, judged_at = now()
        WHERE id = ${id}
    `);
    await h.db.execute(sql`
        INSERT INTO submission_results (submission_id, idx, verdict, time_ms, memory_kb, points)
        VALUES (${id}, 0, 'wrong_answer', 10, 100, 0)
    `);

    await enqueue(h.db, [id!]);

    const r = await row(id!);
    assert.equal(r.status, "queued");
    assert.equal(r.verdict, null);
    assert.equal(r.score, 0);
    assert.equal(r.attempts, 0);
    assert.equal(r.judgedAt, null);

    const [cnt] = await h.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM submission_results WHERE submission_id = ${id}`,
    );
    // 이전 결과가 남으면 새 결과와 섞인다. KOJ 워커가 작업 디렉터리를 안 비워 생긴 문제와 같은 종류
    assert.equal(Number((cnt as any).n), 0);
});

test("NOTIFY 가 실제로 전달된다", async () => {
    const [id] = await mk(1);
    let got = false;
    await h.sql.listen("ojik_judge_queue", () => {
        got = true;
    });
    await enqueue(h.db, [id!]);
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(got, "알림이 안 오면 워커가 폴링 주기만큼 늦게 집는다");
});

test("빈 배열은 아무것도 하지 않는다", async () => {
    await mk(1);
    await enqueue(h.db, []);
    await heartbeat(h.db, "w", []);
    assert.deepEqual(await claimNext(h.db, "w", 0), []);
    assert.equal((await queueStats(h.db)).queued, 1);
});
