import { Hono } from "hono";
import { z } from "zod";
import { v } from "../validate";
import { and, desc, eq, lt, sql, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { LANGUAGE_IDS, VERDICTS, MAX_SOURCE_BYTES, requireLanguage } from "@ojik/core";
import {
    submissions,
    submissionResults,
    problems,
    users,
    notifyQueue,
    enqueue,
} from "@ojik/db";
import { db } from "../db";
import { requireAuth, requireRole, type AuthEnv } from "../auth";
import { problemAccess, canViewSource, verdictVisible } from "../access";

const SubmitBody = z.object({
    problemId: z.number().int().positive(),
    language: z.enum(LANGUAGE_IDS),
    sourceCode: z.string().min(1),
});

const ListQuery = z.object({
    problemId: z.coerce.number().int().positive().optional(),
    handle: z.string().optional(),
    language: z.enum(LANGUAGE_IDS).optional(),
    verdict: z.enum(VERDICTS).optional(),
    collectionId: z.coerce.number().int().positive().optional(),
    /** 커서 페이지네이션. 이 id 보다 작은 것만. OFFSET 은 뒤로 갈수록 느려진다 */
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const submissionRoutes = new Hono<AuthEnv>()
    /**
     * 제출. DB 에 넣는 것이 곧 큐에 넣는 것이다.
     *
     * KOJ 는 DB 저장과 MQ publish 가 따로였고 publish 실패를 무시해서,
     * 학생 화면엔 오류가 뜨는데 제출은 waiting 으로 영영 남는 고아가 쌓였다.
     * 여기서는 INSERT 가 성공하면 이미 큐에 있다. NOTIFY 는 워커를 깨우기만 하므로
     * 실패해도 워커의 폴링이 결국 집어 간다.
     */
    .post("/", requireAuth, v("json", SubmitBody), async (c) => {
        const body = c.req.valid("json");
        const user = c.get("user")!;

        const sourceBytes = Buffer.byteLength(body.sourceCode, "utf8");
        if (sourceBytes > MAX_SOURCE_BYTES) {
            throw new HTTPException(413, { message: `소스가 너무 깁니다 (최대 ${MAX_SOURCE_BYTES}바이트)` });
        }
        // 지원 목록에 없는 언어면 여기서 걸린다. 채점 단계까지 흘러가서 죽지 않는다
        requireLanguage(body.language);

        const [problem] = await db.select().from(problems).where(eq(problems.id, body.problemId));
        if (!problem) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });

        const access = await problemAccess(user, problem);
        if (!access.canView) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });
        if (!access.canSubmit) throw new HTTPException(403, { message: "제출할 수 없는 문제입니다" });

        const sub = await db.transaction(async (tx) => {
            const [row] = await tx
                .insert(submissions)
                .values({
                    problemId: problem.id,
                    userId: user.id,
                    collectionId: access.collection?.id ?? null,
                    language: body.language,
                    sourceCode: body.sourceCode,
                    sourceBytes,
                    status: "queued",
                    // 시간이 흐르는 컬렉션 안의 제출을 연습보다 앞세운다.
                    // 대회 중 대기가 길어지면 순위가 뒤틀린다
                    priority: access.collection ? 100 : 0,
                })
                .returning();

            await tx
                .update(users)
                .set({ submissionCount: sql`${users.submissionCount} + 1` })
                .where(eq(users.id, user.id));
            await tx
                .update(problems)
                .set({ submissionCount: sql`${problems.submissionCount} + 1` })
                .where(eq(problems.id, problem.id));

            return row!;
        });

        await notifyQueue(db).catch(() => {
            // 알림 실패는 지연일 뿐 유실이 아니다. 워커 폴링이 집어 간다
        });

        return c.json({ submission: { id: sub.id, status: sub.status } }, 201);
    })

    .get("/", v("query", ListQuery), async (c) => {
        const q = c.req.valid("query");
        const viewer = c.get("user");

        const conds = [];
        if (q.problemId) conds.push(eq(submissions.problemId, q.problemId));
        if (q.language) conds.push(eq(submissions.language, q.language));
        if (q.verdict) conds.push(eq(submissions.verdict, q.verdict));
        if (q.collectionId) conds.push(eq(submissions.collectionId, q.collectionId));
        if (q.before) conds.push(lt(submissions.id, q.before));
        if (q.handle) {
            conds.push(sql`${submissions.userId} = (SELECT id FROM users WHERE lower(handle) = lower(${q.handle}))`);
        }

        const rows = await db
            .select({
                id: submissions.id,
                problemId: submissions.problemId,
                problemTitle: problems.title,
                userId: submissions.userId,
                handle: users.handle,
                language: submissions.language,
                status: submissions.status,
                verdict: submissions.verdict,
                score: submissions.score,
                maxTimeMs: submissions.maxTimeMs,
                maxMemoryKb: submissions.maxMemoryKb,
                judgedCount: submissions.judgedCount,
                totalCount: submissions.totalCount,
                sourceBytes: submissions.sourceBytes,
                collectionId: submissions.collectionId,
                createdAt: submissions.createdAt,
            })
            .from(submissions)
            .innerJoin(users, eq(users.id, submissions.userId))
            .innerJoin(problems, eq(problems.id, submissions.problemId))
            .where(conds.length ? and(...conds) : undefined)
            .orderBy(desc(submissions.id))
            .limit(q.limit);

        // 판정을 가려야 하는 컬렉션이 섞여 있을 수 있다. 컬렉션별로 한 번씩만 판단한다
        const colIds = [...new Set(rows.map((r) => r.collectionId).filter((x): x is number => x !== null))];
        const visible = new Map<number, boolean>();
        for (const cid of colIds) visible.set(cid, await verdictVisible(viewer ?? null, cid));

        return c.json({
            submissions: rows.map((r) => {
                if (r.collectionId === null || visible.get(r.collectionId)) return r;
                // 코딩테스트 진행 중. 채점됐다는 것까지만 알린다
                return { ...r, verdict: null, score: 0, maxTimeMs: null, maxMemoryKb: null };
            }),
            nextBefore: rows.length === q.limit ? rows[rows.length - 1]!.id : null,
            // 목록에서는 소스를 안 내려보낸다. 상세에서 권한을 보고 준다
            viewerId: viewer?.id ?? null,
        });
    })

    .get("/:id{[0-9]+}", async (c) => {
        const id = Number(c.req.param("id"));
        const viewer = c.get("user");

        const [sub] = await db.select().from(submissions).where(eq(submissions.id, id));
        if (!sub) throw new HTTPException(404, { message: "제출을 찾을 수 없습니다" });

        const showSource = canViewSource(viewer ?? null, sub.userId, sub.isCodePublic);
        const isStaff = viewer ? viewer.role === "admin" || viewer.role === "staff" : false;

        /**
         * 코딩테스트는 본인 제출이라도 끝나기 전에는 판정을 감춘다.
         * 채점은 정상으로 돌고 화면에는 "채점됨"까지만 나온다.
         */
        const showVerdict = await verdictVisible(viewer ?? null, sub.collectionId);

        const results = showVerdict
            ? await db
                  .select()
                  .from(submissionResults)
                  .where(eq(submissionResults.submissionId, id))
                  .orderBy(submissionResults.idx)
            : [];

        return c.json({
            submission: {
                ...sub,
                sourceCode: showSource ? sub.sourceCode : null,
                // 채점 실패 원인은 운영자만 본다. 내부 경로나 도커 오류가 그대로 들어 있다
                judgeError: isStaff ? sub.judgeError : null,

                verdict: showVerdict ? sub.verdict : null,
                score: showVerdict ? sub.score : 0,
                maxTimeMs: showVerdict ? sub.maxTimeMs : null,
                maxMemoryKb: showVerdict ? sub.maxMemoryKb : null,
                compileOutput: showVerdict ? sub.compileOutput : null,

                // 처음 틀린 케이스의 출력. 남의 제출이면 테스트케이스 유출이라 가린다
                failedIdx: showVerdict ? sub.failedIdx : null,
                failedStdout: showVerdict && showSource ? sub.failedStdout : null,
                failedStderr: showVerdict && showSource ? sub.failedStderr : null,
            },
            results,
            verdictHidden: !showVerdict,
        });
    })

    /**
     * 재채점. KOJ 에는 아예 없던 경로다.
     * 테스트케이스를 고쳤거나, 채점 오류로 떨어진 제출을 되살릴 때 쓴다.
     */
    .post("/:id{[0-9]+}/rejudge", requireRole("staff"), async (c) => {
        const id = Number(c.req.param("id"));
        const [sub] = await db.select({ id: submissions.id }).from(submissions).where(eq(submissions.id, id));
        if (!sub) throw new HTTPException(404, { message: "제출을 찾을 수 없습니다" });

        await enqueue(db, [id]);
        return c.json({ ok: true, requeued: 1 });
    })

    /** 여러 건 한 번에. 문제 단위 일괄 재채점은 problems 라우트에 있다 */
    .post(
        "/rejudge",
        requireRole("staff"),
        v("json", z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) })),
        async (c) => {
            const { ids } = c.req.valid("json");
            const found = await db
                .select({ id: submissions.id })
                .from(submissions)
                .where(inArray(submissions.id, ids));
            await enqueue(
                db,
                found.map((r) => r.id),
            );
            return c.json({ ok: true, requeued: found.length });
        },
    );
