import { Hono } from "hono";
import { desc, sql } from "drizzle-orm";
import { LANGUAGES, VERDICT_LABEL, STATUS_LABEL, CHECKER_LABEL, PROBLEM_LIMITS } from "@ojik/core";
import { queueStats, judgeWorkers } from "@ojik/db";
import { db } from "../db";
import type { AuthEnv } from "../auth";

export const metaRoutes = new Hono<AuthEnv>()
    /**
     * 프론트가 언어 목록을 여기서 받아 간다. 화면에 배열을 박지 않는다.
     * KOJ 는 선택지 배열이 모달 3곳에 복사돼 있어서 언어를 추가하면 어딘가 하나가 빠졌다.
     *
     * 컴파일 명령 같은 서버 내부 사정은 안 보낸다. 화면이 알 필요가 없다
     */
    .get("/languages", (c) =>
        c.json({
            languages: LANGUAGES.map((l) => ({
                id: l.id,
                label: l.label,
                extension: l.extension,
                editorMode: l.editorMode,
            })),
        }),
    )

    /** 화면에서 쓰는 라벨 사전. 한글 문구가 프론트와 백엔드에 따로 있으면 갈린다 */
    .get("/labels", (c) =>
        c.json({
            verdict: VERDICT_LABEL,
            status: STATUS_LABEL,
            checker: CHECKER_LABEL,
            problemLimits: PROBLEM_LIMITS,
        }),
    )

    /**
     * 헬스체크. 프로세스가 살아 있는지가 아니라 채점이 도는지를 본다.
     * "큐는 비었는데 제출이 안 돌아간다" 같은 상황을 여기서 바로 구분할 수 있어야 한다
     */
    .get("/health", async (c) => {
        const queue = await queueStats(db);
        const workers = await db
            .select()
            .from(judgeWorkers)
            .orderBy(desc(judgeWorkers.lastSeenAt));

        const now = Date.now();
        const alive = workers.filter((w) => now - w.lastSeenAt.getTime() < 60_000);

        // 워커가 하나도 없는데 큐가 쌓여 있으면 명백한 장애다. 200 으로 내보내면 안 된다
        const healthy = alive.length > 0 || queue.queued === 0;

        return c.json(
            {
                ok: healthy,
                queue,
                workers: workers.map((w) => ({
                    id: w.id,
                    hostname: w.hostname,
                    capacity: w.capacity,
                    busy: w.busy,
                    lastSeenAt: w.lastSeenAt,
                    alive: now - w.lastSeenAt.getTime() < 60_000,
                })),
            },
            healthy ? 200 : 503,
        );
    })

    /**
     * 화면용 대기 현황.
     *
     * /health 와 값은 같지만 장애 때도 200 을 준다. 헬스체크는 감시 도구가 보는 것이라
     * 문제가 있으면 503 이어야 하고, 화면은 그때도 숫자를 보여줘야 한다. 용도가 다르다.
     */
    .get("/queue", async (c) => {
        const q = await queueStats(db);
        const workers = await db.select().from(judgeWorkers);
        const now = Date.now();
        const alive = workers.filter((w) => now - w.lastSeenAt.getTime() < 60_000);
        return c.json({
            queue: q,
            workers: alive.map((w) => ({ alive: true, capacity: w.capacity, busy: w.busy })),
        });
    })

    /** 랭킹. 맞힌 문제 수 기준 */
    .get("/ranking", async (c) => {
        const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
        const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
        const rows = await db.execute<{
            id: number;
            handle: string;
            display_name: string | null;
            solved_count: number;
            submission_count: number;
            rank: number;
        }>(sql`
            SELECT id, handle, display_name, solved_count, submission_count,
                   rank() OVER (ORDER BY solved_count DESC) AS rank
            FROM users
            WHERE solved_count > 0
            ORDER BY solved_count DESC, id ASC
            LIMIT ${limit} OFFSET ${offset}
        `);
        return c.json({ ranking: rows });
    });
