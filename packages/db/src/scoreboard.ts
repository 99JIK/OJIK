import { sql } from "drizzle-orm";
import type { Scoring } from "@ojik/core";
import type { Db } from "./client";

/**
 * 순위표 질의. HTTP 가 아니라 데이터 관심사라 여기 둔다.
 * 라우트에 두면 테스트에서 부를 수가 없어 SQL 을 베껴야 하고, 그러면 원본이 바뀔 때
 * 테스트가 거짓 통과한다.
 *
 * raw SQL 에 Date 를 그대로 넘기지 않는다. drizzle 이 파라미터로 감싸면 postgres-js 가
 * Date 를 직렬화하지 못해 ERR_INVALID_ARG_TYPE 으로 죽는다. 배열(= ANY)과 같은 함정이다.
 * ISO 문자열로 바꾸고 ::timestamptz 로 캐스팅한다.
 */
function ts(d: Date | null | undefined): string | null {
    return d ? d.toISOString() : null;
}

/**
 * postgres-js 는 배열이 아니라 Result 객체를 준다. 길이와 인덱스는 배열처럼 쓰이지만
 * deepEqual 이나 JSON 직렬화에서 다르게 보인다. 부르는 쪽이 신경 쓰지 않게 여기서 편다.
 */
function rows(r: unknown): ScoreRow[] {
    return Array.from(r as Iterable<ScoreRow>);
}

export interface ScoreRow {
    /** db.execute 의 제네릭이 Record<string, unknown> 을 요구한다 */
    [key: string]: unknown;
    user_id: number;
    handle: string;
    display_name: string | null;
    solved: number;
    penalty: number;
    score: number;
}

export interface ScoreboardOptions {
    collectionId: number;
    scoring: Scoring;
    /** 집계 시작. 없으면 제한 없음 */
    startsAt: Date | null;
    /** 이 시각까지의 제출만 센다. 동결이면 동결 시각, 아니면 종료 시각 */
    cutoff: Date | null;
    penaltyMinutes: number;
}

export async function scoreboard(db: Db, o: ScoreboardOptions): Promise<ScoreRow[]> {
    const start = ts(o.startsAt);
    const cut = ts(o.cutoff);

    // 시각 조건은 값이 있을 때만 붙인다. null 을 비교에 넣으면 전부 걸러진다
    const inWindow = sql`
        (${start}::timestamptz IS NULL OR s.created_at >= ${start}::timestamptz)
        AND (${cut}::timestamptz IS NULL OR s.created_at <= ${cut}::timestamptz)
    `;

    if (o.scoring === "none") return [];

    if (o.scoring === "ioi") {
        const res = await db.execute<ScoreRow>(sql`
            SELECT u.id AS user_id, u.handle, u.display_name,
                   coalesce(sum(best.score), 0)::int AS score,
                   0::int AS penalty,
                   count(*) FILTER (WHERE best.score > 0)::int AS solved
            FROM collection_members r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN LATERAL (
                SELECT s.problem_id, max(s.score) AS score
                FROM submissions s
                WHERE s.collection_id = ${o.collectionId} AND s.user_id = u.id AND ${inWindow}
                GROUP BY s.problem_id
            ) best ON true
            WHERE r.collection_id = ${o.collectionId}
            GROUP BY u.id, u.handle, u.display_name
            ORDER BY score DESC, u.handle ASC
        `);
        return rows(res);
    }

    if (o.scoring === "icpc") {
        const res = await db.execute<ScoreRow>(sql`
            WITH ac AS (
                SELECT s.user_id, s.problem_id, min(s.created_at) AS ac_at
                FROM submissions s
                WHERE s.collection_id = ${o.collectionId} AND s.verdict = 'accepted' AND ${inWindow}
                GROUP BY s.user_id, s.problem_id
            ),
            -- 못 푼 문제의 오답은 페널티에 안 들어간다. ac 와 조인하는 이유다
            wrong AS (
                SELECT s.user_id, s.problem_id, count(*) AS n
                FROM submissions s
                JOIN ac ON ac.user_id = s.user_id AND ac.problem_id = s.problem_id
                WHERE s.collection_id = ${o.collectionId}
                  AND s.verdict IS NOT NULL
                  AND s.verdict <> 'accepted'
                  -- 채점 오류는 제출자 잘못이 아니므로 뺀다
                  AND s.verdict <> 'internal_error'
                  AND s.created_at < ac.ac_at
                  AND (${start}::timestamptz IS NULL OR s.created_at >= ${start}::timestamptz)
                GROUP BY s.user_id, s.problem_id
            )
            SELECT u.id AS user_id, u.handle, u.display_name,
                   count(ac.ac_at)::int AS solved,
                   coalesce(sum(
                       floor(extract(epoch FROM ac.ac_at - coalesce(${start}::timestamptz, ac.ac_at)) / 60)
                       + coalesce(w.n, 0) * ${o.penaltyMinutes}
                   ), 0)::int AS penalty,
                   0::int AS score
            FROM collection_members r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN ac ON ac.user_id = u.id
            LEFT JOIN wrong w ON w.user_id = ac.user_id AND w.problem_id = ac.problem_id
            WHERE r.collection_id = ${o.collectionId}
            GROUP BY u.id, u.handle, u.display_name
            ORDER BY solved DESC, penalty ASC, u.handle ASC
        `);
        return rows(res);
    }

    // progress: 이 컬렉션에 담긴 문제 중 몇 개를 풀었는지. 제출이 컬렉션 밖에서 나왔어도 센다
    const res = await db.execute<ScoreRow>(sql`
        SELECT u.id AS user_id, u.handle, u.display_name,
               count(DISTINCT s.problem_id)::int AS solved,
               0::int AS penalty, 0::int AS score
        FROM collection_members r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN submissions s
               ON s.user_id = u.id AND s.verdict = 'accepted'
              AND s.problem_id IN (
                  SELECT problem_id FROM collection_items
                  WHERE collection_id = ${o.collectionId} AND kind = 'problem'
              )
              AND (${cut}::timestamptz IS NULL OR s.created_at <= ${cut}::timestamptz)
        WHERE r.collection_id = ${o.collectionId}
        GROUP BY u.id, u.handle, u.display_name
        ORDER BY solved DESC, u.handle ASC
    `);
    return rows(res);
}
