import { sql } from "drizzle-orm";
import { loadEnv } from "@ojik/core/env";
import { createDb } from "@ojik/db";

loadEnv();

/**
 * 캐시 컬럼을 제출 테이블에서 다시 계산한다.
 *
 * users.solvedCount, problems.acceptedCount 는 채점 확정 시 증가만 시킨다.
 * 재채점으로 판정이 뒤집히거나 제출을 지우면 실제 값과 어긋난다. 그때 이걸 돌린다.
 *
 * 어긋난 게 정상은 아니지만, 매번 집계하는 것보다 캐시 + 주기적 정정이 싸다.
 * 무엇이 얼마나 틀렸는지 먼저 보여주고, --apply 를 줘야 실제로 고친다.
 */

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) {
    console.error("DATABASE_URL 이 없습니다.");
    process.exit(1);
}

const h = createDb(url, { max: 1 });

const userDrift = await h.db.execute<{ id: number; handle: string; cached: number; actual: number }>(sql`
    SELECT u.id, u.handle, u.solved_count AS cached,
           (SELECT count(DISTINCT s.problem_id)::int FROM submissions s
            WHERE s.user_id = u.id AND s.verdict = 'accepted') AS actual
    FROM users u
    WHERE u.solved_count <> (SELECT count(DISTINCT s.problem_id)::int FROM submissions s
                             WHERE s.user_id = u.id AND s.verdict = 'accepted')
    ORDER BY u.id
`);

const problemDrift = await h.db.execute<{ id: number; title: string; cached: number; actual: number }>(sql`
    SELECT p.id, p.title, p.accepted_count AS cached,
           (SELECT count(DISTINCT s.user_id)::int FROM submissions s
            WHERE s.problem_id = p.id AND s.verdict = 'accepted') AS actual
    FROM problems p
    WHERE p.accepted_count <> (SELECT count(DISTINCT s.user_id)::int FROM submissions s
                               WHERE s.problem_id = p.id AND s.verdict = 'accepted')
    ORDER BY p.id
`);

const users = userDrift as unknown as { id: number; handle: string; cached: number; actual: number }[];
const problems = problemDrift as unknown as { id: number; title: string; cached: number; actual: number }[];

console.log(`사용자 ${users.length}명, 문제 ${problems.length}개가 어긋났습니다.`);
for (const u of users.slice(0, 20)) {
    console.log(`  user ${u.handle}: ${u.cached} -> ${u.actual}`);
}
if (users.length > 20) console.log(`  ... 외 ${users.length - 20}명`);
for (const p of problems.slice(0, 20)) {
    console.log(`  problem ${p.id} ${p.title}: ${p.cached} -> ${p.actual}`);
}
if (problems.length > 20) console.log(`  ... 외 ${problems.length - 20}개`);

if (!apply) {
    console.log("\n실제로 고치려면 --apply 를 붙이세요.");
    await h.close();
    process.exit(0);
}

await h.db.transaction(async (tx) => {
    await tx.execute(sql`
        UPDATE users u SET
            solved_count = (SELECT count(DISTINCT s.problem_id)::int FROM submissions s
                            WHERE s.user_id = u.id AND s.verdict = 'accepted'),
            submission_count = (SELECT count(*)::int FROM submissions s WHERE s.user_id = u.id)
    `);
    await tx.execute(sql`
        UPDATE problems p SET
            accepted_count = (SELECT count(DISTINCT s.user_id)::int FROM submissions s
                              WHERE s.problem_id = p.id AND s.verdict = 'accepted'),
            submission_count = (SELECT count(*)::int FROM submissions s WHERE s.problem_id = p.id)
    `);
});

console.log("\n정정했습니다.");
await h.close();
