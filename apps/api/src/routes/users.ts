import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { users } from "@ojik/db";
import { db } from "../db";
import { type AuthEnv } from "../auth";

/**
 * 사용자 프로필.
 *
 * 전에는 화면이 최근 제출 50건을 받아 거기서 맞힌 문제를 세고 있었다. 그래서 많이 푼
 * 사람일수록 숫자가 틀렸고, 화면에 "최근 50건에서만 집계한 값"이라고 적어 두고 있었다.
 * 집계는 DB 가 한다.
 *
 * 로그인했으면 보는 사람과의 차이도 같이 준다. 두 번 질의해서 프론트에서 빼는 대신
 * 한 번에 내려보내는 건, 맞힌 문제 목록이 사람에 따라 수천 개가 될 수 있어서다.
 */

/**
 * 판정을 아직 감추는 컬렉션에 속한 제출을 걸러 내는 조건.
 *
 * 코딩테스트 결과를 끝까지 감추기로 해 놓고 프로필에서 "이 문제 맞혔음"이 보이면
 * 감춘 의미가 없다. 제출 조회와 풀이 접근에 건 것과 같은 규칙이다.
 *
 * 컬렉션에 안 걸린 제출(collection_id 가 null)은 그냥 통과한다.
 * per_user 는 각자 끝나는 시각이 달라서 멤버 행을 봐야 한다.
 */
const VISIBLE = sql`(
    s.collection_id IS NULL
    OR NOT EXISTS (
        SELECT 1 FROM collections c
        LEFT JOIN collection_members m
               ON m.collection_id = c.id AND m.user_id = s.user_id
        WHERE c.id = s.collection_id
          AND c.reveal = 'after_end'
          AND CASE c.timing
                  WHEN 'fixed'    THEN (c.ends_at IS NULL OR c.ends_at > now())
                  WHEN 'per_user' THEN (m.ends_at IS NULL OR m.ends_at > now())
                  ELSE true
              END
    )
)`;

interface Row {
    [k: string]: unknown;
}

function rows<T>(r: unknown): T[] {
    return Array.from(r as Iterable<T>);
}

export const userRoutes = new Hono<AuthEnv>()
    .get("/:handle", async (c) => {
        const handle = c.req.param("handle");
        const viewer = c.get("user") ?? null;

        const [u] = await db
            .select({
                id: users.id,
                handle: users.handle,
                displayName: users.displayName,
                role: users.role,
                createdAt: users.createdAt,
                submissionCount: users.submissionCount,
            })
            .from(users)
            .where(sql`lower(${users.handle}) = ${handle.toLowerCase()}`);

        if (!u) throw new HTTPException(404, { message: "없는 사용자입니다" });

        /*
         * 맞힌 문제 목록.
         *
         * users.solvedCount 캐시를 안 쓴다. 그 값은 감춘 판정까지 세기 때문에 여기 목록과
         * 숫자가 어긋난다. 어긋난 숫자 두 개를 나란히 보여 주는 게 제일 나쁘다
         */
        const solvedRows = rows<{ problemId: number }>(
            await db.execute(sql`
                SELECT DISTINCT s.problem_id AS "problemId"
                FROM submissions s
                WHERE s.user_id = ${u.id} AND s.verdict = 'accepted' AND ${VISIBLE}
                ORDER BY s.problem_id
            `),
        );
        const solved = solvedRows.map((r) => r.problemId);

        /** 언어별 제출 수. 뭘로 푸는 사람인지가 프로필에서 제일 눈에 띈다 */
        const byLanguage = rows<{ language: string; n: number; accepted: number }>(
            await db.execute(sql`
                SELECT s.language,
                       count(*)::int AS n,
                       count(*) FILTER (WHERE s.verdict = 'accepted')::int AS accepted
                FROM submissions s
                WHERE s.user_id = ${u.id} AND ${VISIBLE}
                GROUP BY s.language
                ORDER BY n DESC
            `),
        );

        /** 판정 분포. 정답률과 어디서 막히는지가 같이 보인다 */
        const byVerdict = rows<{ verdict: string; n: number }>(
            await db.execute(sql`
                SELECT s.verdict, count(*)::int AS n
                FROM submissions s
                WHERE s.user_id = ${u.id} AND s.verdict IS NOT NULL AND ${VISIBLE}
                GROUP BY s.verdict
                ORDER BY n DESC
            `),
        );

        /*
         * 최근 활동. 날짜별 제출 수. 한국 시간 기준 하루.
         *
         * 26주(182일)를 준다. 12주면 격자가 12칸뿐이라 카드 폭의 4분의 1만 쓰고
         * 나머지가 빈 채로 남았다. 반년이면 학기 하나가 들어가는 길이이기도 하다.
         */
        const activity = rows<{ day: string; n: number }>(
            await db.execute(sql`
                SELECT to_char((s.created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS day,
                       count(*)::int AS n
                FROM submissions s
                WHERE s.user_id = ${u.id}
                  AND s.created_at > now() - interval '182 days'
                  AND ${VISIBLE}
                GROUP BY 1
                ORDER BY 1
            `),
        );

        /** 이 사람보다 많이 푼 사람 수 + 1. 캐시 컬럼을 쓰므로 위 solved 와 근소하게 다를 수 있다 */
        const [rank] = rows<{ rank: number; total: number }>(
            await db.execute(sql`
                SELECT (SELECT count(*)::int + 1 FROM users u2 WHERE u2.solved_count > u.solved_count) AS rank,
                       (SELECT count(*)::int FROM users) AS total
                FROM users u WHERE u.id = ${u.id}
            `),
        );

        /*
         * 보는 사람과의 차이.
         *
         * 본인 페이지면 비교할 게 없으니 null 이다. 목록을 다 내려보내지 않고 개수와
         * 앞쪽 몇 개만 준다. 수천 개가 될 수 있어서다
         */
        let compare: {
            viewerSolved: number;
            common: number;
            onlyThem: number;
            onlyMe: number;
            onlyThemSample: number[];
        } | null = null;

        if (viewer && viewer.id !== u.id) {
            const viewerSolved = rows<{ problemId: number }>(
                await db.execute(sql`
                    SELECT DISTINCT s.problem_id AS "problemId"
                    FROM submissions s
                    WHERE s.user_id = ${viewer.id} AND s.verdict = 'accepted' AND ${VISIBLE}
                `),
            ).map((r) => r.problemId);

            const mine = new Set(viewerSolved);
            const theirs = new Set(solved);
            const onlyThem = solved.filter((p) => !mine.has(p));
            const onlyMe = viewerSolved.filter((p) => !theirs.has(p));

            compare = {
                viewerSolved: viewerSolved.length,
                common: solved.length - onlyThem.length,
                onlyThem: onlyThem.length,
                onlyMe: onlyMe.length,
                // 상대만 푼 문제 앞쪽 몇 개. 다음에 뭘 풀지 고르는 데 쓰라는 것
                onlyThemSample: onlyThem.slice(0, 30),
            };
        }

        return c.json({
            user: {
                handle: u.handle,
                displayName: u.displayName,
                role: u.role,
                createdAt: u.createdAt,
                solvedCount: solved.length,
                submissionCount: u.submissionCount,
            },
            solved,
            byLanguage,
            byVerdict,
            activity,
            rank: rank?.rank ?? null,
            totalUsers: rank?.total ?? null,
            isMe: viewer?.id === u.id,
            compare,
        });
    });

export type { Row };
