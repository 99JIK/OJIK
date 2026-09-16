import { Hono } from "hono";
import { z } from "zod";
import { v } from "../validate";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { SOLUTION_LIMITS, SOLUTION_DAY_TIMEZONE, dailyWriteLimit, containsLink } from "@ojik/core";
import { solutions, solutionComments, submissions, problems, users } from "@ojik/db";
import { db } from "../db";
import { requireAuth, type AuthEnv } from "../auth";
import { problemAccess, verdictVisible } from "../access";
import type { User } from "@ojik/db";

/**
 * 풀이 공유.
 *
 * 그 문제를 맞힌 사람만 읽고 쓴다. 안 푼 사람이 풀이를 보면 문제를 내는 의미가 없다.
 * staff 이상은 신고 처리와 검수 때문에 늘 읽을 수 있게 둔다.
 *
 * 하루 쓰기 한도로 도배를 막는다. 글과 댓글을 합쳐서 세고, 한도는 맞힌 수에 따라 조금씩 는다.
 * 계정을 새로 만들어 광고를 뿌리는 걸 막으려고 링크는 어느 정도 푼 뒤에만 쓸 수 있다.
 */

const CreateBody = z.object({
    problemId: z.number().int().positive(),
    title: z.string().trim().min(1).max(SOLUTION_LIMITS.titleMax),
    body: z.string().trim().min(1).max(SOLUTION_LIMITS.bodyMax),
});

const UpdateBody = z.object({
    title: z.string().trim().min(1).max(SOLUTION_LIMITS.titleMax),
    body: z.string().trim().min(1).max(SOLUTION_LIMITS.bodyMax),
});

const CommentBody = z.object({
    body: z.string().trim().min(1).max(SOLUTION_LIMITS.commentMax),
});

const ListQuery = z.object({
    problemId: z.coerce.number().int().positive(),
});

/** staff 이상은 안 풀어도 읽을 수 있다. 신고 처리와 검수가 막히면 안 된다 */
function isStaff(user: User): boolean {
    return user.role === "admin" || user.role === "staff";
}

/**
 * 이 사용자가 이 문제를 맞힌 적이 있는지. submissions 의 부분 인덱스가 그대로 탄다.
 *
 * 판정이 아직 안 공개된 제출은 안 센다. 코딩테스트처럼 결과를 끝까지 감추는 컬렉션에서,
 * 맞은 제출을 세어 버리면 풀이 화면이 열리는 것만으로 "나 맞았구나"를 알게 된다.
 * 감춰야 할 판정이 옆문으로 새는 셈이라, 여기서도 같은 규칙을 따른다.
 *
 * 맞은 제출은 보통 0~2건이라 건별로 확인해도 부담이 없다.
 */
async function hasSolved(user: User, problemId: number): Promise<boolean> {
    const rows = await db
        .select({ collectionId: submissions.collectionId })
        .from(submissions)
        .where(
            and(
                eq(submissions.userId, user.id),
                eq(submissions.problemId, problemId),
                eq(submissions.verdict, "accepted"),
            ),
        );

    for (const r of rows) {
        if (await verdictVisible(user, r.collectionId)) return true;
    }
    return false;
}

/**
 * 읽고 쓸 수 있는지 한 번에 본다.
 *
 * 문제 자체를 못 보는 경우(비공개, 대회 전)에는 404 로 답한다. 403 으로 답하면
 * 숨긴 문제의 존재가 드러난다. problemAccess 가 쓰는 규칙과 같게 맞춘 것이다.
 */
async function gate(user: User, problemId: number): Promise<void> {
    const [problem] = await db.select().from(problems).where(eq(problems.id, problemId));
    if (!problem) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });

    const access = await problemAccess(user, problem);
    if (!access.canView) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });

    if (isStaff(user)) return;
    if (!(await hasSolved(user, problemId))) {
        throw new HTTPException(403, { message: "이 문제를 맞힌 뒤에 풀이를 볼 수 있습니다" });
    }
}

/**
 * 오늘 이 사용자가 쓴 글 + 댓글 수.
 *
 * 하루 경계는 한국 시간이다. UTC 로 세면 오전 9시에 한도가 초기화돼서 설명하기 어렵다.
 * 두 테이블을 따로 세고 더한다. UNION 으로 묶어도 되지만 각 인덱스를 그대로 타는 게 낫다.
 */
async function writtenToday(userId: number): Promise<number> {
    const dayStart = sql`date_trunc('day', now() AT TIME ZONE ${SOLUTION_DAY_TIMEZONE}) AT TIME ZONE ${SOLUTION_DAY_TIMEZONE}`;

    const [posts] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(solutions)
        .where(and(eq(solutions.userId, userId), sql`${solutions.createdAt} >= ${dayStart}`));

    const [comments] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(solutionComments)
        .where(and(eq(solutionComments.userId, userId), sql`${solutionComments.createdAt} >= ${dayStart}`));

    return (posts?.n ?? 0) + (comments?.n ?? 0);
}

/** 쓰기 직전 검사. 한도와 링크 제한을 함께 본다 */
async function checkWritable(user: User, text: string): Promise<void> {
    const limit = dailyWriteLimit(user.solvedCount);
    const used = await writtenToday(user.id);
    if (used >= limit) {
        throw new HTTPException(429, {
            message: `오늘 쓸 수 있는 글과 댓글을 다 썼습니다 (${used}/${limit}). 내일 다시 쓸 수 있습니다.`,
        });
    }
    if (user.solvedCount < SOLUTION_LIMITS.linkMinSolved && containsLink(text)) {
        throw new HTTPException(403, {
            message: `링크는 ${SOLUTION_LIMITS.linkMinSolved}문제를 맞힌 뒤에 쓸 수 있습니다.`,
        });
    }
}

export const solutionRoutes = new Hono<AuthEnv>()
    /** 내 하루 한도. 화면이 "오늘 3개 중 1개 썼습니다"를 보여 주는 데 쓴다 */
    .get("/quota", requireAuth, async (c) => {
        const user = c.get("user")!;
        const limit = dailyWriteLimit(user.solvedCount);
        const used = await writtenToday(user.id);
        return c.json({
            used,
            limit,
            canUseLink: user.solvedCount >= SOLUTION_LIMITS.linkMinSolved,
            linkMinSolved: SOLUTION_LIMITS.linkMinSolved,
        });
    })

    /** 한 문제의 풀이 목록. 맞힌 사람만 볼 수 있다 */
    .get("/", requireAuth, v("query", ListQuery), async (c) => {
        const { problemId } = c.req.valid("query");
        const user = c.get("user")!;
        await gate(user, problemId);

        const rows = await db
            .select({
                id: solutions.id,
                title: solutions.title,
                commentCount: solutions.commentCount,
                createdAt: solutions.createdAt,
                updatedAt: solutions.updatedAt,
                deletedAt: solutions.deletedAt,
                userId: solutions.userId,
                handle: users.handle,
            })
            .from(solutions)
            .innerJoin(users, eq(users.id, solutions.userId))
            .where(and(eq(solutions.problemId, problemId), isNull(solutions.deletedAt)))
            .orderBy(desc(solutions.id));

        return c.json({ solutions: rows });
    })

    .post("/", requireAuth, v("json", CreateBody), async (c) => {
        const body = c.req.valid("json");
        const user = c.get("user")!;
        await gate(user, body.problemId);
        await checkWritable(user, `${body.title}\n${body.body}`);

        const [row] = await db
            .insert(solutions)
            .values({ problemId: body.problemId, userId: user.id, title: body.title, body: body.body })
            .returning();

        return c.json({ solution: row }, 201);
    })

    /** 글 하나와 댓글. 목록과 같은 조건으로 막는다 */
    .get("/:id{[0-9]+}", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        const user = c.get("user")!;

        const [row] = await db
            .select({
                id: solutions.id,
                problemId: solutions.problemId,
                title: solutions.title,
                body: solutions.body,
                commentCount: solutions.commentCount,
                createdAt: solutions.createdAt,
                updatedAt: solutions.updatedAt,
                deletedAt: solutions.deletedAt,
                userId: solutions.userId,
                handle: users.handle,
            })
            .from(solutions)
            .innerJoin(users, eq(users.id, solutions.userId))
            .where(eq(solutions.id, id));

        if (!row || row.deletedAt) throw new HTTPException(404, { message: "풀이를 찾을 수 없습니다" });
        await gate(user, row.problemId);

        const comments = await db
            .select({
                id: solutionComments.id,
                body: solutionComments.body,
                createdAt: solutionComments.createdAt,
                userId: solutionComments.userId,
                handle: users.handle,
            })
            .from(solutionComments)
            .innerJoin(users, eq(users.id, solutionComments.userId))
            .where(and(eq(solutionComments.solutionId, id), isNull(solutionComments.deletedAt)))
            .orderBy(solutionComments.id);

        return c.json({
            solution: row,
            comments,
            canEdit: row.userId === user.id,
            canDelete: row.userId === user.id || isStaff(user),
        });
    })

    .patch("/:id{[0-9]+}", requireAuth, v("json", UpdateBody), async (c) => {
        const id = Number(c.req.param("id"));
        const user = c.get("user")!;
        const body = c.req.valid("json");

        const [row] = await db.select().from(solutions).where(eq(solutions.id, id));
        if (!row || row.deletedAt) throw new HTTPException(404, { message: "풀이를 찾을 수 없습니다" });
        if (row.userId !== user.id) throw new HTTPException(403, { message: "남의 글은 고칠 수 없습니다" });

        // 고치기는 하루 한도에서 안 뺀다. 오타 고치려다 한도를 다 쓰면 글을 안 고치게 된다
        if (user.solvedCount < SOLUTION_LIMITS.linkMinSolved && containsLink(`${body.title}\n${body.body}`)) {
            throw new HTTPException(403, {
                message: `링크는 ${SOLUTION_LIMITS.linkMinSolved}문제를 맞힌 뒤에 쓸 수 있습니다.`,
            });
        }

        const [updated] = await db
            .update(solutions)
            .set({ title: body.title, body: body.body, updatedAt: new Date() })
            .where(eq(solutions.id, id))
            .returning();

        return c.json({ solution: updated });
    })

    /** 지우기는 표시만 한다. 달린 댓글을 같이 없애지 않기 위해서다 */
    .delete("/:id{[0-9]+}", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        const user = c.get("user")!;

        const [row] = await db.select().from(solutions).where(eq(solutions.id, id));
        if (!row || row.deletedAt) throw new HTTPException(404, { message: "풀이를 찾을 수 없습니다" });
        if (row.userId !== user.id && !isStaff(user)) {
            throw new HTTPException(403, { message: "남의 글은 지울 수 없습니다" });
        }

        await db.update(solutions).set({ deletedAt: new Date() }).where(eq(solutions.id, id));
        return c.json({ ok: true });
    })

    .post("/:id{[0-9]+}/comments", requireAuth, v("json", CommentBody), async (c) => {
        const id = Number(c.req.param("id"));
        const user = c.get("user")!;
        const body = c.req.valid("json");

        const [row] = await db.select().from(solutions).where(eq(solutions.id, id));
        if (!row || row.deletedAt) throw new HTTPException(404, { message: "풀이를 찾을 수 없습니다" });
        await gate(user, row.problemId);
        await checkWritable(user, body.body);

        // 댓글 수 캐시를 같은 트랜잭션에서 올린다. 따로 하면 목록의 숫자가 어긋난다
        const comment = await db.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(solutionComments)
                .values({ solutionId: id, userId: user.id, body: body.body })
                .returning();
            await tx
                .update(solutions)
                .set({ commentCount: sql`${solutions.commentCount} + 1` })
                .where(eq(solutions.id, id));
            return inserted;
        });

        return c.json({ comment }, 201);
    })

    .delete("/:id{[0-9]+}/comments/:commentId{[0-9]+}", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        const commentId = Number(c.req.param("commentId"));
        const user = c.get("user")!;

        const [row] = await db
            .select()
            .from(solutionComments)
            .where(and(eq(solutionComments.id, commentId), eq(solutionComments.solutionId, id)));
        if (!row || row.deletedAt) throw new HTTPException(404, { message: "댓글을 찾을 수 없습니다" });
        if (row.userId !== user.id && !isStaff(user)) {
            throw new HTTPException(403, { message: "남의 댓글은 지울 수 없습니다" });
        }

        await db.transaction(async (tx) => {
            await tx
                .update(solutionComments)
                .set({ deletedAt: new Date() })
                .where(eq(solutionComments.id, commentId));
            await tx
                .update(solutions)
                .set({ commentCount: sql`greatest(${solutions.commentCount} - 1, 0)` })
                .where(eq(solutions.id, id));
        });

        return c.json({ ok: true });
    });
