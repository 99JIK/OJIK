import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { loadEnv } from "@ojik/core/env";
import { DEFAULT_PENALTY_MINUTES, SCORINGS } from "@ojik/core";
import { createDb, scoreboard, type DbHandle } from "@ojik/db";

/**
 * 순위표 질의. 실제 PostgreSQL 이 필요하다.
 *
 * 이 파일이 생긴 이유: raw SQL 에 Date 를 파라미터로 넘겨 postgres-js 가 죽는 버그가 있었다.
 * 타입체크는 통과하고 화면에서만 500 이 났다. 네 가지 채점 방식을 전부 한 번씩 돌려야 잡힌다.
 *
 * 테이블을 비우므로 개발 DB 에서만 돌릴 것.
 */

loadEnv();

let h: DbHandle;
let problemId = 0;
let userIds: number[] = [];
let collectionId = 0;
/**
 * 모든 시각의 기준. 경과 분을 floor 로 자르므로 밀리초가 섞이면 70 이 69 가 된다.
 * 한 시점을 못 박고 거기서만 계산해 흔들림을 없앤다.
 */
const START = new Date(Date.now() - 2 * 60 * 60 * 1000);
START.setMilliseconds(0);
START.setSeconds(0);

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
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 이 없습니다.");
    h = createDb(url, { max: 4 });
    await ensureNoLiveWorker(h);

    const [p] = await h.db.execute<{ id: number }>(sql`SELECT min(id)::int AS id FROM problems`);
    problemId = Number((p as { id: number }).id);
    if (!problemId) throw new Error("시드 데이터가 없습니다. npm run db:seed 를 먼저 돌리세요.");
});

after(async () => {
    await clean();
    await h.close();
});

beforeEach(async () => {
    await clean();

    // 사용자 둘과 컬렉션 하나를 새로 만든다. 시드 데이터에 기대지 않는다
    const rows = await h.db.execute<{ id: number }>(sql`
        INSERT INTO users (handle, password_hash) VALUES
            ('sb_alice', 'x'), ('sb_bob', 'x')
        RETURNING id
    `);
    userIds = (rows as { id: number }[]).map((r) => Number(r.id));

    const [col] = await h.db.execute<{ id: number }>(sql`
        INSERT INTO collections (slug, title, preset, timing, reveal, scoring, join_policy, visibility,
                                 starts_at, ends_at, penalty_minutes)
        VALUES ('sb-test', '순위표 테스트', 'contest', 'fixed', 'immediate', 'icpc', 'register', 'public',
                ${START.toISOString()}::timestamptz, now() + interval '2 hours', ${DEFAULT_PENALTY_MINUTES})
        RETURNING id
    `);
    collectionId = Number((col as { id: number }).id);

    await h.db.execute(sql`
        INSERT INTO collection_members (collection_id, user_id)
        VALUES (${collectionId}, ${userIds[0]!}), (${collectionId}, ${userIds[1]!})
    `);
    await h.db.execute(sql`
        INSERT INTO collection_items (collection_id, idx, kind, problem_id)
        VALUES (${collectionId}, 0, 'problem', ${problemId})
    `);
});

async function clean() {
    await h.db.execute(sql`DELETE FROM submission_results`);
    await h.db.execute(sql`DELETE FROM submissions`);
    await h.db.execute(sql`DELETE FROM collection_members WHERE collection_id IN (SELECT id FROM collections WHERE slug = 'sb-test')`);
    await h.db.execute(sql`DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE slug = 'sb-test')`);
    await h.db.execute(sql`DELETE FROM collections WHERE slug = 'sb-test'`);
    await h.db.execute(sql`DELETE FROM users WHERE handle LIKE 'sb_%'`);
}

/** 시작으로부터 minutesAfter 분 뒤에 제출한 것으로 박아 넣는다 */
async function submit(userId: number, verdict: string | null, minutesAfter: number, score = 0) {
    const at = new Date(START.getTime() + minutesAfter * 60_000);
    await h.db.execute(sql`
        INSERT INTO submissions (problem_id, user_id, collection_id, language, source_code, source_bytes,
                                 status, verdict, score, created_at)
        VALUES (${problemId}, ${userId}, ${collectionId}, 'c', 'x', 1,
                'done', ${verdict}::verdict, ${score}, ${at.toISOString()}::timestamptz)
    `);
}

const opts = (scoring: "none" | "progress" | "icpc" | "ioi", cutoff: Date | null = null) => ({
    collectionId,
    scoring,
    startsAt: START,
    cutoff,
    penaltyMinutes: DEFAULT_PENALTY_MINUTES,
});

test("네 가지 채점 방식이 모두 실행된다", async () => {
    // Date 를 raw SQL 파라미터로 넘기면 postgres-js 가 죽는다. 전부 한 번씩 돌려 확인한다
    for (const scoring of SCORINGS) {
        await scoreboard(h.db, opts(scoring));
    }
});

test("cutoff 에 Date 를 넘겨도 죽지 않는다", async () => {
    for (const scoring of SCORINGS) {
        await scoreboard(h.db, opts(scoring, new Date()));
    }
});

test("icpc: 푼 수로 세우고 동률은 페널티로 가른다", async () => {
    // alice: 시작 30분 뒤 정답, 오답 없음 -> 페널티 30
    await submit(userIds[0]!, "accepted", 30);
    // bob: 시작 70분 뒤 정답, 그 전에 오답 1회 -> 페널티 70 + 20 = 90
    await submit(userIds[1]!, "wrong_answer", 50);
    await submit(userIds[1]!, "accepted", 70);

    const rows = await scoreboard(h.db, opts("icpc"));
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.handle, "sb_alice", "페널티가 적은 쪽이 앞");
    assert.equal(rows[0]!.solved, 1);
    assert.equal(rows[1]!.solved, 1);
    assert.ok(rows[1]!.penalty > rows[0]!.penalty, "오답이 있던 쪽 페널티가 커야 한다");
});

test("icpc: 못 푼 문제의 오답은 페널티에 안 들어간다", async () => {
    await submit(userIds[0]!, "wrong_answer", 30);
    await submit(userIds[0]!, "wrong_answer", 50);

    const rows = await scoreboard(h.db, opts("icpc"));
    const alice = rows.find((r) => r.handle === "sb_alice")!;
    // 이게 ICPC 관례다. 안 지키면 시도만 해도 손해라 사람들이 제출을 안 한다
    assert.equal(alice.solved, 0);
    assert.equal(alice.penalty, 0);
});

test("icpc: 채점 오류는 페널티에서 뺀다", async () => {
    await submit(userIds[0]!, "internal_error", 30);
    await submit(userIds[0]!, "accepted", 50);

    const rows = await scoreboard(h.db, opts("icpc"));
    const alice = rows.find((r) => r.handle === "sb_alice")!;
    // 시작 50분 뒤 정답이므로 페널티는 50.
    // 앞선 internal_error 가 들어갔다면 50 + 20 = 70 이 됐을 것이다.
    // 채점기 문제로 학생이 손해 보면 안 된다
    assert.equal(alice.penalty, 50, "정답까지 걸린 시간만 (채점 오류 가산 없음)");
});

test("ioi: 문제별 최고 점수를 더한다", async () => {
    await submit(userIds[0]!, "wrong_answer", 30, 40);
    await submit(userIds[0]!, "wrong_answer", 60, 70);

    const rows = await scoreboard(h.db, opts("ioi"));
    const alice = rows.find((r) => r.handle === "sb_alice")!;
    // 마지막이 아니라 최고점. 맞힌 뒤 실수로 다시 제출해도 점수가 안 사라진다
    assert.equal(alice.score, 70);
});

test("progress: 컬렉션에 담긴 문제를 몇 개 풀었는지", async () => {
    await submit(userIds[0]!, "accepted", 10);
    await submit(userIds[0]!, "accepted", 20); // 같은 문제 두 번

    const rows = await scoreboard(h.db, opts("progress"));
    const alice = rows.find((r) => r.handle === "sb_alice")!;
    assert.equal(alice.solved, 1, "같은 문제를 여러 번 맞혀도 하나로 센다");
});

test("cutoff 이후 제출은 안 센다", async () => {
    await submit(userIds[0]!, "accepted", 60);

    const all = await scoreboard(h.db, opts("icpc"));
    assert.equal(all.find((r) => r.handle === "sb_alice")!.solved, 1);

    // 동결을 흉내낸다. 시작 30분 뒤까지만 집계하면 60분 뒤 정답은 안 보여야 한다
    const frozen = await scoreboard(h.db, opts("icpc", new Date(START.getTime() + 30 * 60_000)));
    assert.equal(frozen.find((r) => r.handle === "sb_alice")!.solved, 0);
});

test("참가자가 없으면 빈 목록", async () => {
    await h.db.execute(sql`DELETE FROM collection_members WHERE collection_id = ${collectionId}`);
    for (const scoring of SCORINGS) {
        const rows = await scoreboard(h.db, opts(scoring));
        assert.deepEqual(rows, []);
    }
});

test("scoring=none 은 질의를 돌리지 않는다", async () => {
    assert.deepEqual(await scoreboard(h.db, opts("none")), []);
});
