import { Hono } from "hono";
import { z } from "zod";
import { v } from "../validate";
import { and, asc, desc, eq, ilike, sql, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { PROBLEM_LIMITS, CHECKER_TYPES } from "@ojik/core";
import { problems, testcases, tags, problemTags, submissions, enqueue } from "@ojik/db";
import { db } from "../db";
import { requireRole, type AuthEnv } from "../auth";
import { problemAccess } from "../access";
import {
    writeTestcaseFile,
    readTestcaseFile,
    clearTestcaseDir,
    removeProblemData,
} from "../storage";

const ProblemBody = z.object({
    title: z.string().min(1).max(200),
    statement: z.string().default(""),
    inputDesc: z.string().default(""),
    outputDesc: z.string().default(""),
    hint: z.string().nullable().optional(),
    timeLimitMs: z.number().int().min(PROBLEM_LIMITS.timeMs.min).max(PROBLEM_LIMITS.timeMs.max),
    memoryLimitMb: z
        .number()
        .int()
        .min(PROBLEM_LIMITS.memoryMb.min)
        .max(PROBLEM_LIMITS.memoryMb.max),
    checkerType: z.enum(CHECKER_TYPES).default("trim"),
    floatEpsilon: z.number().positive().default(1e-6),
    stopOnFirstFail: z.boolean().default(true),
    isPublic: z.boolean().default(false),
    difficulty: z.number().int().min(1).max(30).nullable().optional(),
    tagIds: z.array(z.number().int().positive()).default([]),
});

const TestcaseBody = z.object({
    testcases: z
        .array(
            z.object({
                input: z.string(),
                output: z.string(),
                isSample: z.boolean().default(false),
                points: z.number().int().min(0).default(0),
            }),
        )
        .min(1)
        .max(500),
});

const ListQuery = z.object({
    q: z.string().optional(),
    tag: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    sort: z.enum(["id", "difficulty", "accepted"]).default("id"),
});

export const problemRoutes = new Hono<AuthEnv>()
    .get("/", v("query", ListQuery), async (c) => {
        const q = c.req.valid("query");
        const user = c.get("user");
        const isStaff = user ? user.role === "admin" || user.role === "staff" : false;

        const conds = [];
        // 비공개 문제는 목록에 아예 안 띄운다. 제목만 보이는 것도 정보다
        if (!isStaff) conds.push(eq(problems.isPublic, true));
        if (q.q) conds.push(ilike(problems.title, `%${q.q}%`));
        if (q.tag) {
            conds.push(
                sql`EXISTS (SELECT 1 FROM problem_tags pt WHERE pt.problem_id = ${problems.id} AND pt.tag_id = ${q.tag})`,
            );
        }

        const order =
            q.sort === "difficulty"
                ? asc(problems.difficulty)
                : q.sort === "accepted"
                  ? desc(problems.acceptedCount)
                  : asc(problems.id);

        const rows = await db
            .select({
                id: problems.id,
                title: problems.title,
                timeLimitMs: problems.timeLimitMs,
                memoryLimitMb: problems.memoryLimitMb,
                difficulty: problems.difficulty,
                acceptedCount: problems.acceptedCount,
                submissionCount: problems.submissionCount,
                isPublic: problems.isPublic,
            })
            .from(problems)
            .where(conds.length ? and(...conds) : undefined)
            .orderBy(order)
            .limit(q.limit)
            .offset(q.offset);

        // 로그인했으면 각 문제를 풀었는지 같이 내려준다. 목록에서 N번 질의하지 않게 한 번에 모은다
        let solved: number[] = [];
        if (user && rows.length > 0) {
            const ids = rows.map((r) => r.id);
            const got = await db
                .selectDistinct({ problemId: submissions.problemId })
                .from(submissions)
                .where(
                    and(
                        eq(submissions.userId, user.id),
                        eq(submissions.verdict, "accepted"),
                        inArray(submissions.problemId, ids),
                    ),
                );
            solved = got.map((g) => g.problemId);
        }

        return c.json({ problems: rows, solved, offset: q.offset, limit: q.limit });
    })

    .get("/:id{[0-9]+}", async (c) => {
        const id = Number(c.req.param("id"));
        const user = c.get("user");

        const [p] = await db.select().from(problems).where(eq(problems.id, id));
        if (!p) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });

        const access = await problemAccess(user ?? null, p);
        // 비공개 문제는 403 이 아니라 404 로 답한다. 존재 여부 자체를 흘리지 않는다
        if (!access.canView) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });

        const sampleRows = await db
            .select()
            .from(testcases)
            .where(and(eq(testcases.problemId, id), eq(testcases.isSample, true)))
            .orderBy(asc(testcases.idx));

        const samples = await Promise.all(
            sampleRows.map(async (t) => ({
                idx: t.idx,
                input: await readTestcaseFile(id, t.idx, "in").catch(() => ""),
                output: await readTestcaseFile(id, t.idx, "out").catch(() => ""),
            })),
        );

        const tagRows = await db
            .select({ id: tags.id, slug: tags.slug, name: tags.name })
            .from(problemTags)
            .innerJoin(tags, eq(tags.id, problemTags.tagId))
            .where(eq(problemTags.problemId, id));

        const [count] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(testcases)
            .where(eq(testcases.problemId, id));

        return c.json({
            problem: p,
            samples,
            tags: tagRows,
            testcaseCount: count?.n ?? 0,
            canSubmit: access.canSubmit,
        });
    })

    .post("/", requireRole("staff"), v("json", ProblemBody), async (c) => {
        const body = c.req.valid("json");
        const user = c.get("user")!;
        const { tagIds, ...fields } = body;

        const p = await db.transaction(async (tx) => {
            const [row] = await tx
                .insert(problems)
                .values({ ...fields, createdBy: user.id })
                .returning();
            if (tagIds.length) {
                await tx.insert(problemTags).values(tagIds.map((t) => ({ problemId: row!.id, tagId: t })));
            }
            return row!;
        });
        return c.json({ problem: p }, 201);
    })

    .patch("/:id{[0-9]+}", requireRole("staff"), v("json", ProblemBody.partial()), async (c) => {
        const id = Number(c.req.param("id"));
        const { tagIds, ...fields } = c.req.valid("json");

        const p = await db.transaction(async (tx) => {
            const [row] = await tx
                .update(problems)
                .set({ ...fields, updatedAt: new Date() })
                .where(eq(problems.id, id))
                .returning();
            if (!row) return null;
            if (tagIds) {
                await tx.delete(problemTags).where(eq(problemTags.problemId, id));
                if (tagIds.length) {
                    await tx.insert(problemTags).values(tagIds.map((t) => ({ problemId: id, tagId: t })));
                }
            }
            return row;
        });
        if (!p) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });
        return c.json({ problem: p });
    })

    .delete("/:id{[0-9]+}", requireRole("admin"), async (c) => {
        const id = Number(c.req.param("id"));
        // 제출은 FK cascade 로 같이 지워진다. 남길 필요가 있으면 문제를 비공개로 돌릴 것
        const [row] = await db.delete(problems).where(eq(problems.id, id)).returning({ id: problems.id });
        if (!row) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });
        await removeProblemData(id);
        return c.json({ ok: true });
    })

    .get("/:id{[0-9]+}/testcases", requireRole("staff"), async (c) => {
        const id = Number(c.req.param("id"));
        const rows = await db
            .select()
            .from(testcases)
            .where(eq(testcases.problemId, id))
            .orderBy(asc(testcases.idx));
        return c.json({ testcases: rows });
    })

    /**
     * 테스트케이스 전체 교체. 부분 수정 API 를 따로 두지 않는다.
     * 순번과 파일이 어긋난 중간 상태가 생기면 어떤 제출이 무엇으로 채점됐는지 알 수 없게 된다.
     *
     * 교체 후 기존 제출은 옛 케이스로 매겨진 결과를 들고 있다. 필요하면 아래 rejudge 를 부를 것.
     */
    .put("/:id{[0-9]+}/testcases", requireRole("staff"), v("json", TestcaseBody), async (c) => {
        const id = Number(c.req.param("id"));
        const { testcases: incoming } = c.req.valid("json");

        const [p] = await db.select({ id: problems.id }).from(problems).where(eq(problems.id, id));
        if (!p) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });

        await clearTestcaseDir(id);
        const rows: (typeof testcases.$inferInsert)[] = [];
        for (let i = 0; i < incoming.length; i++) {
            const t = incoming[i]!;
            const inFile = await writeTestcaseFile(id, i, "in", t.input);
            const outFile = await writeTestcaseFile(id, i, "out", t.output);
            rows.push({
                problemId: id,
                idx: i,
                isSample: t.isSample,
                points: t.points,
                inputSha256: inFile.sha256,
                inputBytes: inFile.bytes,
                outputSha256: outFile.sha256,
                outputBytes: outFile.bytes,
            });
        }

        await db.transaction(async (tx) => {
            await tx.delete(testcases).where(eq(testcases.problemId, id));
            await tx.insert(testcases).values(rows);
            // 케이스를 바꾸면 그 전 제출의 판정은 옛 기준이 된다. 버전을 올려 구분한다
            await tx
                .update(problems)
                .set({ testcaseVersion: sql`${problems.testcaseVersion} + 1`, updatedAt: new Date() })
                .where(eq(problems.id, id));
        });

        const [after] = await db
            .select({ v: problems.testcaseVersion })
            .from(problems)
            .where(eq(problems.id, id));
        return c.json({ ok: true, count: rows.length, testcaseVersion: after?.v });
    })

    /** 이 문제의 제출을 전부 큐로 되돌린다. 테스트케이스를 고친 뒤에 쓴다 */
    .post("/:id{[0-9]+}/rejudge", requireRole("staff"), async (c) => {
        const id = Number(c.req.param("id"));
        const rows = await db
            .select({ id: submissions.id })
            .from(submissions)
            .where(eq(submissions.problemId, id));
        await enqueue(
            db,
            rows.map((r) => r.id),
        );
        return c.json({ ok: true, requeued: rows.length });
    });
