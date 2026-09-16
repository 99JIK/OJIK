import { loadEnv } from "@ojik/core/env";
import { SOLUTION_LIMITS, dailyWriteLimit } from "@ojik/core";
import { sql } from "drizzle-orm";
import { createDb } from "@ojik/db";

/**
 * 풀이 공유의 접근 규칙과 하루 한도를 실제 API 로 확인한다.
 *
 * 여기서 보는 건 세 가지다.
 *   1. 안 맞힌 사람은 읽지도 쓰지도 못한다
 *   2. 맞히면 열린다
 *   3. 하루 한도와 링크 제한이 실제로 막는다
 *
 * 순수 계산은 tests/solutions.test.ts 가 본다. 이건 권한과 한도가 라우트에 제대로
 * 붙어 있는지를 본다. 규칙은 맞는데 미들웨어를 빠뜨리는 게 흔한 실수라서다.
 *
 * API 와 워커가 떠 있어야 한다. 시작할 때 테스트 계정이 오늘 쓴 글과 댓글을 지우므로
 * 개발 DB 에서만 쓸 것. 안 지우면 한도 검사가 한도를 채워 놔서 다음 실행이 바로 429 가 된다.
 */
loadEnv();

const BASE = `http://localhost:${process.env.PORT ?? 3000}/api`;

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = "") {
    if (cond) {
        console.log(`  [OK]   ${name}`);
        pass++;
    } else {
        console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ""}`);
        fail++;
    }
}

interface Session {
    cookie: string;
}

async function login(email: string, password: string): Promise<Session> {
    const r = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(`로그인 실패 ${email}: ${r.status} ${await r.text()}`);
    const sc = r.headers.get("set-cookie");
    if (!sc) throw new Error("쿠키를 못 받았습니다");
    return { cookie: sc.split(";")[0]! };
}

/** 상태 코드까지 봐야 해서 call 을 따로 둔다. 실패가 정상인 경우가 많다 */
async function req<T>(
    s: Session,
    path: string,
    init?: RequestInit,
): Promise<{ status: number; body: T | { error?: string } }> {
    const r = await fetch(BASE + path, {
        ...init,
        headers: { "content-type": "application/json", cookie: s.cookie, ...init?.headers },
    });
    const t = await r.text();
    return { status: r.status, body: t ? JSON.parse(t) : {} };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitJudged(s: Session, id: number): Promise<string | null> {
    for (let i = 0; i < 150; i++) {
        const r = await req<{ submission: { status: string; verdict: string | null } }>(s, `/submissions/${id}`);
        const sub = (r.body as { submission: { status: string; verdict: string | null } }).submission;
        if (sub.status === "done") return sub.verdict;
        if (sub.status === "error") return "internal_error";
        await sleep(400);
    }
    return null;
}

/**
 * 테스트 계정을 처음 상태로 되돌린다.
 *
 * 이걸 안 하면 두 번째 실행부터 결과가 달라진다. 한도 검사가 하루 한도를 다 채우고 끝나므로
 * 다음 실행은 첫 글쓰기부터 429 고, 앞선 실행에서 맞힌 문제는 "안 맞힌 사람" 검사에 못 쓴다.
 * 한도는 하루 단위라 그냥 다시 돌려서는 못 고친다.
 *
 * API 로는 지울 수단이 없어 DB 를 직접 만진다. 캐시 컬럼은 scripts/recount.ts 와 같은 식으로
 * 다시 센다. 개발 DB 전용이라는 게 여기서 나온다.
 */
async function resetStudent(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 이 없습니다.");
    const h = createDb(url, { max: 2 });
    const who = sql`(SELECT user_id FROM user_emails WHERE email = 'student@example.com')`;
    try {
        await h.db.transaction(async (tx) => {
            await tx.execute(sql`DELETE FROM solution_comments WHERE user_id IN ${who}`);
            await tx.execute(sql`DELETE FROM solutions WHERE user_id IN ${who}`);
            await tx.execute(sql`DELETE FROM submissions WHERE user_id IN ${who}`);
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
    } finally {
        await h.close();
    }
}

async function main() {
    await resetStudent();

    const admin = await login("admin@example.com", "admin1234");
    const student = await login("student@example.com", "student1234");

    // 아직 아무도 안 푼 문제를 하나 고른다. 이미 푼 문제면 1번 검사가 무의미해진다
    const list = await req<{ problems: Array<{ id: number; title: string }> }>(student, "/problems?limit=50");
    const problems = (list.body as { problems: Array<{ id: number; title: string }> }).problems;

    // 아래 확인용 소스(입력의 모든 수를 더함)로 맞힐 수 있는 문제를 고른다.
    // 아무거나 집으면 오답이 나서 "맞힌 뒤" 검사가 통째로 건너뛰어진다
    let target: { id: number; title: string } | null = null;
    for (const p of problems) {
        const d = await req<{ samples: Array<{ input: string; output: string }> }>(student, `/problems/${p.id}`);
        const samples = (d.body as { samples?: Array<{ input: string; output: string }> }).samples ?? [];
        if (samples.length === 0) continue;
        const solvable = samples.every((t) => {
            const nums = t.input.trim().split(/\s+/).map(Number);
            if (nums.some(Number.isNaN)) return false;
            return String(nums.reduce((a, b) => a + b, 0)) === t.output.trim();
        });
        if (solvable) {
            target = p;
            break;
        }
    }
    if (!target) {
        console.log("  [SKIP] 확인용 소스로 맞힐 수 있는 문제가 없습니다. npm run db:seed 를 먼저 돌리세요.");
        process.exit(0);
    }
    console.log(`문제 ${target.id} "${target.title}" 로 확인합니다.\n`);

    console.log("== 안 맞힌 사람 ==");
    {
        const r = await req(student, `/solutions?problemId=${target.id}`);
        ok("목록을 못 본다 (403)", r.status === 403, `${r.status}`);

        const w = await req(student, "/solutions", {
            method: "POST",
            body: JSON.stringify({ problemId: target.id, title: "미리 쓰기", body: "안 풀고 씁니다" }),
        });
        ok("글도 못 쓴다 (403)", w.status === 403, `${w.status}`);
    }

    console.log("\n== staff 는 안 풀어도 읽는다 ==");
    {
        const r = await req(admin, `/solutions?problemId=${target.id}`);
        ok("admin 은 목록을 본다 (200)", r.status === 200, `${r.status}`);
    }

    console.log("\n== 맞힌 뒤 ==");
    {
        const sub = await req<{ submission: { id: number } }>(student, "/submissions", {
            method: "POST",
            body: JSON.stringify({
                problemId: target.id,
                language: "python3",
                sourceCode: "import sys\nprint(sum(map(int, sys.stdin.read().split())))\n",
            }),
        });
        if (sub.status !== 201) {
            console.log(`  [SKIP] 제출이 안 됐습니다 (${sub.status}). 워커가 떠 있는지 보세요.`);
            process.exit(fail === 0 ? 0 : 1);
        }
        const verdict = await waitJudged(student, (sub.body as { submission: { id: number } }).submission.id);
        if (verdict !== "accepted") {
            console.log(`  [SKIP] 이 문제는 A+B 가 아닙니다 (${verdict}). 확인용 소스가 안 맞습니다.`);
            process.exit(fail === 0 ? 0 : 1);
        }

        const r = await req(student, `/solutions?problemId=${target.id}`);
        ok("목록이 열린다 (200)", r.status === 200, `${r.status}`);

        const w = await req<{ solution: { id: number } }>(student, "/solutions", {
            method: "POST",
            body: JSON.stringify({ problemId: target.id, title: "이분 탐색", body: "정렬 후 이분 탐색" }),
        });
        ok("글을 쓸 수 있다 (201)", w.status === 201, `${w.status}`);

        const sid = (w.body as { solution?: { id: number } }).solution?.id;
        if (sid) {
            const cm = await req(student, `/solutions/${sid}/comments`, {
                method: "POST",
                body: JSON.stringify({ body: "잘 봤습니다" }),
            });
            ok("댓글을 달 수 있다 (201)", cm.status === 201, `${cm.status}`);

            const d = await req<{ solution: { commentCount: number } }>(student, `/solutions/${sid}`);
            const cnt = (d.body as { solution: { commentCount: number } }).solution.commentCount;
            ok("댓글 수 캐시가 맞다", cnt === 1, `${cnt}`);
        }
    }

    console.log("\n== 링크 제한 ==");
    {
        const me = await req<{ user: { solvedCount: number } }>(student, "/auth/me");
        const solved = (me.body as { user?: { solvedCount: number } }).user?.solvedCount ?? 0;

        const r = await req(student, "/solutions", {
            method: "POST",
            body: JSON.stringify({
                problemId: target.id,
                title: "링크 글",
                body: "여기 참고 https://example.com",
            }),
        });
        if (solved < SOLUTION_LIMITS.linkMinSolved) {
            ok(`${solved}문제 맞힌 계정은 링크를 못 쓴다 (403)`, r.status === 403, `${r.status}`);
        } else {
            ok(`${solved}문제 맞힌 계정은 링크를 쓴다 (201)`, r.status === 201, `${r.status}`);
        }
    }

    console.log("\n== 하루 한도 ==");
    {
        const q = await req<{ used: number; limit: number }>(student, "/solutions/quota");
        const quota = q.body as { used: number; limit: number };
        ok("quota 가 계산식과 맞다", quota.limit === dailyWriteLimit((await solvedOf(student)) ?? 0), `${quota.limit}`);

        // 남은 만큼 댓글로 채운 뒤 한 번 더 시도한다
        const solutionId = await anySolutionId(student, target.id);
        if (solutionId === null) {
            console.log("  [SKIP] 댓글을 달 글이 없습니다");
        } else {
            let left = quota.limit - quota.used;
            let blocked = false;
            for (let i = 0; i <= left; i++) {
                const r = await req(student, `/solutions/${solutionId}/comments`, {
                    method: "POST",
                    body: JSON.stringify({ body: `한도 확인 ${i}` }),
                });
                if (r.status === 429) {
                    blocked = true;
                    break;
                }
            }
            ok("한도를 넘으면 429 로 막힌다", blocked);
        }
    }

    console.log(`\n통과 ${pass}, 실패 ${fail}`);
    process.exit(fail === 0 ? 0 : 1);
}

async function solvedOf(s: Session): Promise<number | null> {
    const r = await req<{ user: { solvedCount: number } }>(s, "/auth/me");
    return (r.body as { user?: { solvedCount: number } }).user?.solvedCount ?? null;
}

async function anySolutionId(s: Session, problemId: number): Promise<number | null> {
    const r = await req<{ solutions: Array<{ id: number }> }>(s, `/solutions?problemId=${problemId}`);
    return (r.body as { solutions?: Array<{ id: number }> }).solutions?.[0]?.id ?? null;
}

void main();
