import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { v } from "../validate";
import { desc, eq, sql } from "drizzle-orm";
import { LANGUAGES, VERDICT_LABEL, STATUS_LABEL, CHECKER_LABEL, PROBLEM_LIMITS, ROLES } from "@ojik/core";
import { queueStats, judgeWorkers, users } from "@ojik/db";
import { db } from "../db";
import { requireRole, type AuthEnv } from "../auth";

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

    /**
     * 사용자 목록. 권한 관리 화면용이라 admin 만 본다.
     * 이메일은 안 내려보낸다. 권한을 주고받는 데 필요 없고, 새어 나갈 이유도 없다.
     */
    .get("/admin/users", requireRole("admin"), async (c) => {
        const q = c.req.query("q") ?? "";
        const rows = await db
            .select({
                id: users.id,
                handle: users.handle,
                displayName: users.displayName,
                role: users.role,
                solvedCount: users.solvedCount,
                submissionCount: users.submissionCount,
                createdAt: users.createdAt,
                lastLoginAt: users.lastLoginAt,
            })
            .from(users)
            .where(q ? sql`lower(${users.handle}) LIKE lower(${"%" + q + "%"})` : undefined)
            .orderBy(users.id)
            .limit(200);
        return c.json({ users: rows });
    })

    /**
     * 권한 변경.
     *
     * 자기 자신을 내리는 건 막는다. 관리자가 실수로 자기 권한을 없애면 되돌릴 방법이
     * scripts/set-role.ts 뿐이고, 그건 서버에 붙어야 한다.
     */
    .patch(
        "/admin/users/:id{[0-9]+}/role",
        requireRole("admin"),
        v("json", z.object({ role: z.enum(ROLES) })),
        async (c) => {
            const id = Number(c.req.param("id"));
            const me = c.get("user")!;
            const { role } = c.req.valid("json");

            if (id === me.id && role !== "admin") {
                throw new HTTPException(409, {
                    message: "자기 권한은 내릴 수 없습니다. 다른 관리자에게 부탁하세요.",
                });
            }

            const [row] = await db
                .update(users)
                .set({ role })
                .where(eq(users.id, id))
                .returning({ id: users.id, handle: users.handle, role: users.role });
            if (!row) throw new HTTPException(404, { message: "사용자를 찾을 수 없습니다" });
            return c.json({ user: row });
        },
    )

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
