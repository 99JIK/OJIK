import { Hono } from "hono";
import { z } from "zod";
import { v } from "../validate";
import { and, asc, desc, eq, ilike, sql, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { PROBLEM_LIMITS, CHECKER_TYPES, PROBLEM_KINDS, LANGUAGE_IDS, MAX_CHECKER_BYTES, atLeast, blankOut, canAssist } from "@ojik/core";
import { problems, testcases, tags, problemTags, submissions, collections, users, enqueue } from "@ojik/db";
import { db } from "../db";
import { alias } from "drizzle-orm/pg-core";

/** 목록에서 출제자를 조인한다. users 를 다른 이름으로 한 번 더 붙이는 것뿐이다 */
const authors = alias(users, "authors");
import { requireAuth, requireRole, type AuthEnv } from "../auth";
import { problemAccess, collectionAccess, canEditProblem } from "../access";
import type { User, Problem } from "@ojik/db";
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
    /** 이 강의 전용 문제로 만든다. null 이면 공개 아카이브 문제. 강사는 반드시 채워야 한다 */
    ownerCollectionId: z.number().int().positive().nullable().optional(),

    kind: z.enum(PROBLEM_KINDS).default("code"),
    /** kind=blank 일 때 원본 코드와 비울 줄 번호, 채점 언어 */
    blankTemplate: z.string().nullable().optional(),
    blankLines: z.array(z.number().int().positive()).nullable().optional(),
    blankLanguage: z.enum(LANGUAGE_IDS).nullable().optional(),

    /** checkerType 이 special 일 때의 체커 프로그램 */
    checkerSource: z.string().max(MAX_CHECKER_BYTES).nullable().optional(),
    checkerLanguage: z.enum(LANGUAGE_IDS).nullable().optional(),
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
    /** 이 강의 전용 문제만. 그 강의를 운영하는 사람만 쓸 수 있다 */
    collectionId: z.coerce.number().int().positive().optional(),
});

/**
 * 이 소속으로 문제를 만들 수 있는지.
 *
 * ownerCollectionId 가 null 이면 공개 아카이브라 출제자 이상만 된다.
 * 값이 있으면 그 컬렉션의 운영자여야 한다.
 */
async function assertCanCreate(user: User, ownerCollectionId: number | null): Promise<void> {
    if (ownerCollectionId === null) {
        if (!atLeast(user.role, "staff")) {
            throw new HTTPException(403, {
                message: "공개 문제는 출제자만 만들 수 있습니다. 강의를 지정하세요.",
            });
        }
        return;
    }

    const [col] = await db.select().from(collections).where(eq(collections.id, ownerCollectionId));
    if (!col) throw new HTTPException(404, { message: "강의를 찾을 수 없습니다" });
    if (!(await collectionAccess(user, col)).canManage) {
        throw new HTTPException(403, { message: "이 강의의 운영자가 아닙니다" });
    }
}

/** 고칠 수 있는 문제를 불러온다. 못 고치면 던진다 */
async function loadEditable(user: User, id: number): Promise<Problem> {
    const [p] = await db.select().from(problems).where(eq(problems.id, id));
    if (!p) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });
    if (!(await canEditProblem(user, p))) {
        throw new HTTPException(403, { message: "이 문제를 고칠 권한이 없습니다" });
    }
    return p;
}

/**
 * 문제 행에서 답이 드러나는 칸을 지운다.
 *
 * blankTemplate 은 빈칸의 정답이 그대로 든 원본이고, checkerSource 는 어떤 답이 통과하는지를
 * 코드로 적어 둔 것이다. 문제 상세는 로그인만 하면 누구나 부르는 곳이라, 행을 통째로
 * 내보내면 둘 다 같이 나간다. 편집 화면은 이 함수를 안 거치는 /source 라우트로 받아 간다.
 */
function stripAnswers(p: Problem): Omit<Problem, "blankTemplate" | "checkerSource"> {
    const { blankTemplate: _t, checkerSource: _c, ...rest } = p;
    void _t;
    void _c;
    return rest;
}

/**
 * 유형에 맞는 칸이 채워졌는지.
 *
 * 빈칸 문제를 원본 없이 저장할 수 있으면, 학생이 제출할 때가 되어서야 409 를 본다.
 * 만들 때 막는 게 낫다.
 */
function assertKindFields(f: {
    kind?: string;
    blankTemplate?: string | null;
    blankLanguage?: string | null;
    checkerType?: string;
    checkerSource?: string | null;
    checkerLanguage?: string | null;
}): void {
    if (f.kind === "blank") {
        if (!f.blankTemplate?.trim()) {
            throw new HTTPException(400, { message: "빈칸 문제는 원본 코드가 있어야 합니다" });
        }
        if (!f.blankLanguage) {
            throw new HTTPException(400, { message: "빈칸 문제는 채점 언어를 정해야 합니다" });
        }
    }

    /*
     * 스페셜 저지인데 체커가 없으면 저장 못 하게 막는다.
     *
     * 안 막으면 학생이 제출할 때가 되어서야 채점 오류가 난다. 그때는 이미 여러 명이
     * 제출한 뒤일 수 있다.
     */
    if (f.checkerType === "special") {
        if (!f.checkerSource?.trim()) {
            throw new HTTPException(400, { message: "스페셜 저지는 체커 프로그램이 있어야 합니다" });
        }
        if (!f.checkerLanguage) {
            throw new HTTPException(400, { message: "스페셜 저지는 체커 언어를 정해야 합니다" });
        }
    }
}

export const problemRoutes = new Hono<AuthEnv>()
    .get("/", v("query", ListQuery), async (c) => {
        const q = c.req.valid("query");
        const user = c.get("user");
        const isStaff = user ? user.role === "admin" || user.role === "staff" : false;

        const conds = [];
        if (q.collectionId) {
            /*
             * 자기 강의 문제 목록.
             *
             * 운영자가 아니면 빈 목록이 아니라 403 이다. 조용히 비워 주면 강사가
             * "왜 내 문제가 안 보이지" 하고 헤맨다.
             *
             * 여기서는 isPublic 을 안 본다. 강의 전용 문제는 비공개가 기본이고,
             * 공개 여부는 아카이브에 낼 때 쓰는 값이라 강의 안에서는 의미가 없다.
             */
            if (!user) throw new HTTPException(401, { message: "로그인이 필요합니다" });
            const [col] = await db.select().from(collections).where(eq(collections.id, q.collectionId));
            if (!col) throw new HTTPException(404, { message: "찾을 수 없습니다" });
            // 조교도 본다. 과제를 고치려면 목록에서 찾을 수 있어야 한다
            const a = await collectionAccess(user, col);
            if (!a.canManage && !canAssist(a.member?.role)) {
                throw new HTTPException(403, { message: "이 강의의 조교 이상만 볼 수 있습니다" });
            }
            conds.push(eq(problems.ownerCollectionId, q.collectionId));
        } else {
            // 비공개 문제는 목록에 아예 안 띄운다. 제목만 보이는 것도 정보다
            if (!isStaff) conds.push(eq(problems.isPublic, true));
            // 강의 전용 문제는 공개 아카이브 목록에 안 나온다. 그 강의 안에서만 보인다.
            // staff 도 마찬가지다. 남의 강의 과제가 아카이브 목록을 채우면 목록이 못 쓰게 된다
            conds.push(isNull(problems.ownerCollectionId));
        }
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
                kind: problems.kind,
                /** 출제자. 지운 계정이면 null 이다 (createdBy 가 set null) */
                authorHandle: authors.handle,
            })
            .from(problems)
            .leftJoin(authors, eq(authors.id, problems.createdBy))
            .where(conds.length ? and(...conds) : undefined)
            .orderBy(order)
            .limit(q.limit)
            .offset(q.offset);

        /*
         * 전체 개수.
         *
         * 이게 없으면 화면이 마지막 페이지를 알 수 없어서, 끝에서도 다음 버튼이 눌리고
         * 빈 목록이 나온다. 같은 조건으로 한 번 더 세는 비용은 목록 질의와 같은 인덱스를
         * 타므로 실제로는 얼마 안 든다.
         */
        const [total] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(problems)
            .where(conds.length ? and(...conds) : undefined);

        /*
         * 로그인했으면 각 문제의 내 상태를 같이 내려준다. 목록에서 N번 질의하지 않게 한 번에 모은다.
         *
         * 맞힘과 시도함을 나눈다. 안 푼 문제와 틀린 문제가 같아 보이면 목록에서
         * "다시 볼 것" 을 찾을 수가 없다.
         */
        let solved: number[] = [];
        let tried: number[] = [];
        if (user && rows.length > 0) {
            const ids = rows.map((r) => r.id);
            const got = await db
                .select({
                    problemId: submissions.problemId,
                    accepted: sql<boolean>`bool_or(${submissions.verdict} = 'accepted')`,
                })
                .from(submissions)
                .where(and(eq(submissions.userId, user.id), inArray(submissions.problemId, ids)))
                .groupBy(submissions.problemId);

            solved = got.filter((g) => g.accepted).map((g) => g.problemId);
            tried = got.filter((g) => !g.accepted).map((g) => g.problemId);
        }

        return c.json({ problems: rows, solved, tried, total: total?.n ?? 0, offset: q.offset, limit: q.limit });
    })

    .get("/:id{[0-9]+}", async (c) => {
        const id = Number(c.req.param("id"));
        const user = c.get("user");

        const [p] = await db.select().from(problems).where(eq(problems.id, id));
        if (!p) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });

        const access = await problemAccess(user ?? null, p);
        // 비공개 문제는 403 이 아니라 404 로 답한다. 존재 여부 자체를 흘리지 않는다
        if (!access.canView) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });

        /*
         * 예제.
         *
         * 단답형은 여기를 안 쓴다. 문항 전체가 아래 answerItems 로 따로 나가고, 기댓값은
         * 절대 안 나간다. 예제 목록에 output 이 들어 있어서, 그대로 두면 답이 그냥 보인다.
         */
        const sampleRows =
            p.kind === "answer"
                ? []
                : await db
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

        /*
         * 단답형 문항. 지문과 배점만 나간다.
         *
         * 테스트케이스의 input 이 문항 지문이고 output 이 기대 답이다. output 은 여기서
         * 절대 안 내보낸다. 운영자도 마찬가지다. 운영자는 테스트케이스 편집 화면에서 본다.
         */
        const answerItems =
            p.kind === "answer"
                ? await Promise.all(
                      (
                          await db
                              .select()
                              .from(testcases)
                              .where(eq(testcases.problemId, id))
                              .orderBy(asc(testcases.idx))
                      ).map(async (t) => ({
                          idx: t.idx,
                          points: t.points,
                          prompt: await readTestcaseFile(id, t.idx, "in").catch(() => ""),
                      })),
                  )
                : [];

        /*
         * 빈칸 문제의 골격. 비운 줄은 지워서 내보낸다.
         *
         * 원본을 통째로 내보내면 답이 그대로 보인다. 운영자에게도 여기서는 안 준다.
         * 고칠 때는 문제 편집 화면이 따로 받아 간다.
         */
        const blank =
            p.kind === "blank" && p.blankTemplate
                ? {
                      lines: blankOut(p.blankTemplate, p.blankLines ?? []),
                      blankLines: p.blankLines ?? [],
                      language: p.blankLanguage,
                  }
                : null;

        const [author] = p.createdBy
            ? await db
                  .select({ handle: users.handle, displayName: users.displayName })
                  .from(users)
                  .where(eq(users.id, p.createdBy))
            : [];

        const tagRows = await db
            .select({ id: tags.id, slug: tags.slug, name: tags.name })
            .from(problemTags)
            .innerJoin(tags, eq(tags.id, problemTags.tagId))
            .where(eq(problemTags.problemId, id));

        const [count] = await db
            .select({
                n: sql<number>`count(*)::int`,
                /*
                 * 부분점수 문제인지.
                 *
                 * 케이스에 배점이 붙어 있으면 부분점수다. 따로 플래그를 두지 않는 건,
                 * 플래그와 실제 배점이 어긋나는 상태를 만들지 않기 위해서다.
                 * 배점이 전부 0 이면 워커가 통과 개수 비율로 환산한다
                 */
                partial: sql<boolean>`bool_or(${testcases.points} > 0)`,
                totalPoints: sql<number>`coalesce(sum(${testcases.points}), 0)::int`,
            })
            .from(testcases)
            .where(eq(testcases.problemId, id));

        return c.json({
            problem: stripAnswers(p),
            author: author ?? null,
            samples,
            answerItems,
            blank,
            tags: tagRows,
            testcaseCount: count?.n ?? 0,
            partialScoring: count?.partial ?? false,
            totalPoints: count?.totalPoints ?? 0,
            canSubmit: access.canSubmit,
        });
    })

    /**
     * 문제 생성.
     *
     * 출제자는 공개 아카이브에도 강의에도 낼 수 있다. 강사는 자기가 운영하는 강의에만 낸다.
     * 강사에게 아카이브를 열어 주면 아무나 공개 문제를 쌓게 되고, 그건 되돌리기 어렵다.
     */
    .post("/", requireRole("instructor"), v("json", ProblemBody), async (c) => {
        const body = c.req.valid("json");
        const user = c.get("user")!;
        const { tagIds, ...fields } = body;

        await assertCanCreate(user, fields.ownerCollectionId ?? null);
        assertKindFields(fields);

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

    .patch("/:id{[0-9]+}", requireAuth, v("json", ProblemBody.partial()), async (c) => {
        const id = Number(c.req.param("id"));
        const { tagIds, ...fields } = c.req.valid("json");
        const user = c.get("user")!;

        const current = await loadEditable(user, id);
        // 소속을 옮기는 건 출제자 이상만 한다. 강사가 자기 강의 문제를 아카이브로 올리거나
        // 남의 강의로 넘기지 못하게 막는다
        if ("ownerCollectionId" in fields && fields.ownerCollectionId !== current.ownerCollectionId) {
            if (!atLeast(user.role, "staff")) {
                throw new HTTPException(403, { message: "문제의 소속은 출제자만 바꿀 수 있습니다" });
            }
            await assertCanCreate(user, fields.ownerCollectionId ?? null);
        }

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

    /**
     * 편집용 원본.
     *
     * 문제 상세는 빈칸의 원본 코드를 안 내보낸다. 정답이 그대로 들어 있어서다.
     * 고칠 사람은 여기서 받아 간다. loadEditable 이 권한을 본다.
     */
    .get("/:id{[0-9]+}/source", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        const p = await loadEditable(c.get("user")!, id);
        return c.json({
            kind: p.kind,
            blankTemplate: p.blankTemplate,
            blankLines: p.blankLines,
            blankLanguage: p.blankLanguage,
            checkerSource: p.checkerSource,
            checkerLanguage: p.checkerLanguage,
        });
    })

    .get("/:id{[0-9]+}/testcases", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        await loadEditable(c.get("user")!, id);
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
    .put("/:id{[0-9]+}/testcases", requireAuth, v("json", TestcaseBody), async (c) => {
        const id = Number(c.req.param("id"));
        await loadEditable(c.get("user")!, id);
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
    .post("/:id{[0-9]+}/rejudge", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        await loadEditable(c.get("user")!, id);
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
