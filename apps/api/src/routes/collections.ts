import { Hono } from "hono";
import { z } from "zod";
import { v } from "../validate";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
    COLLECTION_PRESETS,
    TIMINGS,
    REVEALS,
    SCORINGS,
    JOIN_POLICIES,
    VISIBILITIES,
    MEMBER_ROLES,
    canAssist,
    parseRoster,
    parseCourseMarkdown,
    makeTempPassword,
    resultCsv,
    ROSTER_MAX_ROWS,
    ITEM_KINDS,
    PRESET_DEFAULTS,
    validateAxes,
    isRunning,
    hasEnded,
    atLeast,
} from "@ojik/core";
import {
    collections,
    collectionItems,
    userEmails,
    collectionMembers,
    problems,
    submissions,
    users,
    scoreboard,
} from "@ojik/db";
import { db } from "../db";
import { alias } from "drizzle-orm/pg-core";

/** 목록에서 만든 사람을 조인한다 */
const owners = alias(users, "owners");
import { requireAuth, requireRole, hashPassword, type AuthEnv } from "../auth";
import { collectionAccess, canSeeItems } from "../access";
import type { User, Collection } from "@ojik/db";

/**
 * 교재, 문제집, 대회, 코딩테스트가 전부 이 라우트다.
 * 넷의 차이는 컬렉션 행의 축 값뿐이라, 목록/상세/멤버/순위 코드를 한 벌만 유지한다.
 */

const Axes = z.object({
    timing: z.enum(TIMINGS),
    reveal: z.enum(REVEALS),
    scoring: z.enum(SCORINGS),
    joinPolicy: z.enum(JOIN_POLICIES),
    visibility: z.enum(VISIBILITIES),
});

const Body = z
    .object({
        slug: z
            .string()
            .min(2)
            .max(60)
            .regex(/^[a-z0-9-]+$/, "소문자, 숫자, 하이픈만 쓸 수 있습니다"),
        title: z.string().min(1).max(200),
        description: z.string().default(""),
        preset: z.enum(COLLECTION_PRESETS),
        startsAt: z.coerce.date().nullable().optional(),
        endsAt: z.coerce.date().nullable().optional(),
        durationMinutes: z.number().int().positive().max(24 * 60).nullable().optional(),
        freezeMinutes: z.number().int().min(0).max(600).default(0),
        penaltyMinutes: z.number().int().min(0).max(240).default(20),
    })
    // 축은 안 주면 프리셋 기본값을 쓴다. 화면은 보통 프리셋만 고른다
    .merge(Axes.partial());

const ItemsBody = z.object({
    items: z
        .array(
            z.object({
                kind: z.enum(ITEM_KINDS).default("problem"),
                problemId: z.number().int().positive().optional(),
                points: z.number().int().min(0).default(100),
                /** 항목별 마감. ISO 문자열. 없으면 마감 없음 */
                dueAt: z.string().datetime().nullable().optional(),
                body: z.string().optional(),
                heading: z.string().max(200).optional(),
            }),
        )
        .max(500),
});

function fillAxes(body: z.infer<typeof Body>) {
    const d = PRESET_DEFAULTS[body.preset];
    return {
        timing: body.timing ?? d.timing,
        reveal: body.reveal ?? d.reveal,
        scoring: body.scoring ?? d.scoring,
        joinPolicy: body.joinPolicy ?? d.joinPolicy,
        visibility: body.visibility ?? d.visibility,
    };
}

async function loadBySlug(slug: string) {
    const [c] = await db.select().from(collections).where(eq(collections.slug, slug));
    if (!c) throw new HTTPException(404, { message: "찾을 수 없습니다" });
    return c;
}

/**
 * 이 컬렉션을 운영할 수 있는지 보고, 없으면 던진다.
 *
 * 전역 staff 로만 막던 자리다. 그러면 컬렉션별 manager 와 owner 가 이름만 있고 아무것도
 * 못 한다. 강사가 자기 강의를 못 고치는 상태였다.
 *
 * 못 보는 컬렉션이면 404, 보이는데 운영 권한만 없으면 403 이다. private 컬렉션의
 * 존재 자체를 흘리지 않으려는 것이고, 다른 라우트와 같은 규칙이다.
 */
async function requireManage(user: User, id: number): Promise<Collection> {
    const [col] = await db.select().from(collections).where(eq(collections.id, id));
    if (!col) throw new HTTPException(404, { message: "찾을 수 없습니다" });

    const access = await collectionAccess(user, col);
    if (!access.canView) throw new HTTPException(404, { message: "찾을 수 없습니다" });
    if (!access.canManage) throw new HTTPException(403, { message: "이 컬렉션의 운영자가 아닙니다" });
    return col;
}

/**
 * 조교 이상이면 통과.
 *
 * 조교는 보는 일과 문제 고치는 일을 한다. 명단과 구성은 못 바꾼다. 조교에게 명단을 열어 주면
 * 실수로 수강생을 지웠을 때 되돌릴 방법이 없다. 반대로 진도와 성적을 못 보게 하면
 * 조교가 할 수 있는 일이 사실상 없다.
 */
async function requireAssist(user: User, id: number): Promise<Collection> {
    const [col] = await db.select().from(collections).where(eq(collections.id, id));
    if (!col) throw new HTTPException(404, { message: "찾을 수 없습니다" });

    const access = await collectionAccess(user, col);
    if (!access.canView) throw new HTTPException(404, { message: "찾을 수 없습니다" });
    if (!access.canManage && !canAssist(access.member?.role)) {
        throw new HTTPException(403, { message: "이 컬렉션의 조교 이상만 볼 수 있습니다" });
    }
    return col;
}

export const collectionRoutes = new Hono<AuthEnv>()
    .get(
        "/",
        v(
            "query",
            z.object({
                preset: z.enum(COLLECTION_PRESETS).optional(),
                /** 내가 운영하는 것만. 관리 화면이 쓴다 */
                mine: z.coerce.boolean().optional(),
            }),
        ),
        async (c) => {
            const { preset, mine } = c.req.valid("query");
            const user = c.get("user");
            const isStaff = user ? atLeast(user.role, "staff") : false;

            const conds = [];
            if (preset) conds.push(eq(collections.preset, preset));

            if (mine) {
                /*
                 * 운영하는 것만. staff 지름길을 여기서는 안 쓴다.
                 * 출제자에게 남의 강의까지 다 보여 주면 관리 화면이 못 쓰게 된다.
                 * 관리자가 전체를 봐야 하면 mine 없이 부르면 된다
                 */
                if (!user) throw new HTTPException(401, { message: "로그인이 필요합니다" });
                conds.push(sql`(collections.owner_id = ${user.id} OR EXISTS (
                    SELECT 1 FROM collection_members m
                    WHERE m.collection_id = collections.id
                      AND m.user_id = ${user.id} AND m.role = 'manager'))`);
            } else if (!isStaff) {
                /*
                 * private 은 자기가 속한 것만. unlisted 는 목록에 안 띄운다.
                 *
                 * 만든 사람도 포함해야 한다. 강사가 비공개 강의를 열면 스스로를 멤버로
                 * 넣기 전까지 자기 목록에서 사라졌다
                 */
                conds.push(
                    user
                        ? sql`(collections.visibility = 'public'
                               OR collections.owner_id = ${user.id}
                               OR EXISTS (
                               SELECT 1 FROM collection_members m
                               WHERE m.collection_id = collections.id AND m.user_id = ${user.id}))`
                        : eq(collections.visibility, "public"),
                );
            }

            /*
             * 문제 수와 인원을 같이 센다.
             *
             * 관리 화면이 목록에서 "비어 있는 컬렉션"을 구분해야 하는데, 행마다 따로 물으면
             * 컬렉션 수만큼 질의가 는다. 상관 서브쿼리 두 개면 한 번에 끝난다.
             */
            const rows = await db
                .select({
                    id: collections.id,
                    slug: collections.slug,
                    title: collections.title,
                    preset: collections.preset,
                    timing: collections.timing,
                    reveal: collections.reveal,
                    scoring: collections.scoring,
                    joinPolicy: collections.joinPolicy,
                    visibility: collections.visibility,
                    startsAt: collections.startsAt,
                    endsAt: collections.endsAt,
                    durationMinutes: collections.durationMinutes,
                    ownerId: collections.ownerId,
                    /*
                     * 상관 서브쿼리 안에서는 바깥 테이블 이름을 직접 적는다.
                     *
                     * 이 쿼리는 조인이 없어서 ${collections.id} 가 "id" 하나로만 나간다. 서브쿼리 안에
                     * id 컬럼을 가진 테이블이 있으면 그쪽에 붙어, 조건이 ci.collection_id = ci.id 가
                     * 되고 결과가 조용히 0 이 된다. 실제로 그렇게 나갔다.
                     *
                     * memberCount 는 collection_members 에 id 컬럼이 없어서 우연히 맞았다.
                     * 우연에 기대지 않으려고 둘 다 적는다.
                     */
                    problemCount: sql<number>`(
                        SELECT count(*)::int FROM collection_items ci
                        WHERE ci.collection_id = collections.id AND ci.kind = 'problem'
                    )`,
                    memberCount: sql<number>`(
                        SELECT count(*)::int FROM collection_members m
                        WHERE m.collection_id = collections.id
                    )`,
                    /** 만든 사람. 계정이 지워졌으면 null (ownerId 가 set null) */
                    ownerHandle: owners.handle,
                    /*
                     * 이 컬렉션에서 내가 맞힌 문제 수.
                     *
                     * 목록에서 "어디까지 했더라" 가 제일 먼저 궁금한 것이다. 비로그인이면 0 이고,
                     * 화면은 로그인 여부를 보고 표시할지 정한다.
                     */
                    mySolved: user
                        ? sql<number>`(
                            SELECT count(DISTINCT s.problem_id)::int
                            FROM submissions s
                            JOIN collection_items ci
                              ON ci.problem_id = s.problem_id AND ci.collection_id = collections.id
                            WHERE s.user_id = ${user.id} AND s.verdict = 'accepted'
                        )`
                        : sql<number>`0`,
                })
                .from(collections)
                .leftJoin(owners, eq(owners.id, collections.ownerId))
                .where(conds.length ? and(...conds) : undefined)
                .orderBy(desc(collections.id));
            return c.json({ collections: rows });
        },
    )

    .get("/:slug", async (c) => {
        const col = await loadBySlug(c.req.param("slug"));
        const user = c.get("user") ?? null;
        const { canView, canManage, member } = await collectionAccess(user, col);
        if (!canView) throw new HTTPException(404, { message: "찾을 수 없습니다" });

        const showItems = canSeeItems(col, member, canManage);

        const items = showItems
            ? await db
                  .select({
                      id: collectionItems.id,
                      idx: collectionItems.idx,
                      kind: collectionItems.kind,
                      points: collectionItems.points,
                      dueAt: collectionItems.dueAt,
                      body: collectionItems.body,
                      heading: collectionItems.heading,
                      problemId: problems.id,
                      problemTitle: problems.title,
                      problemKind: problems.kind,
                      timeLimitMs: problems.timeLimitMs,
                      memoryLimitMb: problems.memoryLimitMb,
                  })
                  .from(collectionItems)
                  .leftJoin(problems, eq(problems.id, collectionItems.problemId))
                  .where(eq(collectionItems.collectionId, col.id))
                  .orderBy(asc(collectionItems.idx))
            : [];

        const [counts] = await db
            .select({ n: sql<number>`count(*) FILTER (WHERE kind = 'problem')::int` })
            .from(collectionItems)
            .where(eq(collectionItems.collectionId, col.id));

        /*
         * 내 진도.
         *
         * 맞힌 것, 냈지만 못 맞힌 것, 그리고 처음 맞힌 시각을 함께 준다. 시각이 필요한 건
         * 항목별 마감과 견줘 "늦게 냈는지" 를 화면이 판단해야 해서다. 맞힘 여부만 주면
         * 마감을 넘겨 푼 것과 제때 푼 것이 똑같이 보인다.
         *
         * 점수도 같이 준다. 부분점수 문제에서 "풀었다/못 풀었다" 만으로는 70점을 받았는지
         * 0점을 받았는지 알 수가 없다.
         */
        let solved: number[] = [];
        let mine: Array<{
            problemId: number;
            solved: boolean;
            best: number;
            tries: number;
            firstSolvedAt: string | null;
        }> = [];

        const problemIds = items.filter((i) => i.problemId).map((i) => i.problemId!);
        if (user && problemIds.length > 0) {
            const got = await db
                .select({
                    problemId: submissions.problemId,
                    solved: sql<boolean>`bool_or(${submissions.verdict} = 'accepted')`,
                    best: sql<number>`max(${submissions.score})::int`,
                    tries: sql<number>`count(*)::int`,
                    firstSolvedAt: sql<string | null>`
                        min(${submissions.createdAt}) FILTER (WHERE ${submissions.verdict} = 'accepted')
                    `,
                })
                .from(submissions)
                .where(
                    and(
                        eq(submissions.userId, user.id),
                        inArray(submissions.problemId, problemIds),
                        eq(submissions.status, "done"),
                    ),
                )
                .groupBy(submissions.problemId);

            mine = got;
            solved = got.filter((g) => g.solved).map((g) => g.problemId);
        }

        return c.json({
            collection: col,
            items,
            problemCount: counts?.n ?? 0,
            itemsVisible: showItems,
            canManage,
            member,
            running: isRunning(col, member),
            ended: hasEnded(col, member),
            solved,
            mine,
        });
    })

    .post("/", requireRole("instructor"), v("json", Body), async (c) => {
        const body = c.req.valid("json");
        const axes = fillAxes(body);

        // 축 조합이 말이 되는지 본다. 스키마로는 못 막는 부분
        const bad = validateAxes({ ...axes, ...body });
        if (bad.length) throw new HTTPException(400, { message: bad.join(", ") });

        const [row] = await db
            .insert(collections)
            .values({ ...body, ...axes, ownerId: c.get("user")!.id })
            .returning();
        return c.json({ collection: row }, 201);
    })

    .patch("/:id{[0-9]+}", requireAuth, v("json", Body.partial()), async (c) => {
        const id = Number(c.req.param("id"));
        const patch = c.req.valid("json");

        const current = await requireManage(c.get("user")!, id);

        const merged = { ...current, ...patch };
        const bad = validateAxes(merged);
        if (bad.length) throw new HTTPException(400, { message: bad.join(", ") });

        const [row] = await db
            .update(collections)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(collections.id, id))
            .returning();
        return c.json({ collection: row });
    })

    /** 항목 전체 교체. 순서가 곧 idx 다. 설명과 문제를 섞을 수 있다 */
    .put("/:id{[0-9]+}/items", requireAuth, v("json", ItemsBody), async (c) => {
        const id = Number(c.req.param("id"));
        await requireManage(c.get("user")!, id);
        const { items } = c.req.valid("json");

        for (const [i, it] of items.entries()) {
            if (it.kind === "problem" && !it.problemId) {
                throw new HTTPException(400, { message: `${i + 1}번 항목: 문제 id 가 없습니다` });
            }
            if (it.kind === "text" && !it.body) {
                throw new HTTPException(400, { message: `${i + 1}번 항목: 본문이 비어 있습니다` });
            }
        }

        await db.transaction(async (tx) => {
            await tx.delete(collectionItems).where(eq(collectionItems.collectionId, id));
            if (items.length) {
                await tx.insert(collectionItems).values(
                    items.map((it, idx) => ({
                        collectionId: id,
                        idx,
                        kind: it.kind,
                        problemId: it.kind === "problem" ? it.problemId! : null,
                        points: it.points,
                        dueAt: it.dueAt ? new Date(it.dueAt) : null,
                        body: it.kind === "text" ? (it.body ?? null) : null,
                        heading: it.heading ?? null,
                    })),
                );
            }
        });
        return c.json({ ok: true, count: items.length });
    })

    /**
     * 멤버 등록. 강의 수강생 명단이나 코딩테스트 초대 대상을 핸들로 밀어 넣는다.
     * 없는 핸들은 조용히 건너뛰지 않고 돌려준다. 오타를 여기서 못 잡으면
     * 학생이 안 보인다고 할 때까지 모른다.
     */
    .put(
        "/:id{[0-9]+}/members",
        requireAuth,
        v(
            "json",
            z.object({
                handles: z.array(z.string()).max(2000),
                role: z.enum(MEMBER_ROLES).default("member"),
                replace: z.boolean().default(false),
            }),
        ),
        async (c) => {
            const id = Number(c.req.param("id"));
            await requireManage(c.get("user")!, id);
            const { handles, role, replace } = c.req.valid("json");

            const found = handles.length
                ? await db
                      .select({ id: users.id, handle: users.handle })
                      .from(users)
                      .where(
                          inArray(
                              sql`lower(${users.handle})`,
                              handles.map((h) => h.toLowerCase()),
                          ),
                      )
                : [];

            const foundLower = new Set(found.map((f) => f.handle.toLowerCase()));
            const missing = handles.filter((h) => !foundLower.has(h.toLowerCase()));

            await db.transaction(async (tx) => {
                if (replace) {
                    await tx.delete(collectionMembers).where(eq(collectionMembers.collectionId, id));
                }
                if (found.length) {
                    await tx
                        .insert(collectionMembers)
                        .values(found.map((f) => ({ collectionId: id, userId: f.id, role })))
                        .onConflictDoNothing();
                }
            });
            return c.json({ ok: true, added: found.length, missing });
        },
    )

    /**
     * 수강생 명단.
     *
     * 넣는 API 만 있고 보는 API 가 없었다. 누가 등록돼 있는지 확인할 방법이 없으면
     * 명단을 잘못 올려도 학생이 안 보인다고 할 때까지 모른다.
     *
     * 진행 상황도 같이 준다. 교재나 문제집에서 누가 어디까지 풀었는지가 강사가 제일
     * 먼저 보고 싶은 것이다. 컬렉션에 든 문제만 센다.
     */
    .get("/:id{[0-9]+}/members", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        await requireAssist(c.get("user")!, id);

        const rows = await db
            .select({
                userId: collectionMembers.userId,
                handle: users.handle,
                displayName: users.displayName,
                role: collectionMembers.role,
                joinedAt: collectionMembers.joinedAt,
                startedAt: collectionMembers.startedAt,
                endsAt: collectionMembers.endsAt,
                /*
                 * 바깥 컬럼은 테이블 이름까지 직접 적는다.
                 *
                 * drizzle 이 컬럼을 어떻게 내보낼지는 바깥 쿼리 모양에 달려 있다. 조인이 있으면
                 * "collection_members"."user_id" 로 정규화하지만 없으면 "user_id" 만 내보낸다.
                 * 후자면 서브쿼리 안의 같은 이름에 붙어 조건이 엉뚱해진다. 아래 목록 쿼리에서
                 * 실제로 그렇게 나갔다. 여기는 지금 조인이 있어서 괜찮지만, 나중에 조인을 빼면
                 * 조용히 깨지는 자리라 모양에 기대지 않는다.
                 */
                solvedHere: sql<number>`(
                    SELECT count(DISTINCT s.problem_id)::int
                    FROM submissions s
                    JOIN collection_items ci
                      ON ci.problem_id = s.problem_id AND ci.collection_id = ${id}
                    WHERE s.user_id = collection_members.user_id AND s.verdict = 'accepted'
                )`,
            })
            .from(collectionMembers)
            .innerJoin(users, eq(users.id, collectionMembers.userId))
            .where(eq(collectionMembers.collectionId, id))
            .orderBy(users.handle);

        const [total] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(collectionItems)
            .where(and(eq(collectionItems.collectionId, id), eq(collectionItems.kind, "problem")));

        return c.json({ members: rows, problemCount: total?.n ?? 0 });
    })

    /**
     * 멤버 한 명의 역할 변경. 조교를 manager 로 올리는 데 쓴다.
     *
     * 전체 명단 교체(PUT)로도 되지만, 한 명 바꾸려고 명단 전체를 다시 올리면
     * 그 사이 스스로 참여한 사람이 날아간다.
     */
    .patch(
        "/:id{[0-9]+}/members/:userId{[0-9]+}",
        requireAuth,
        v("json", z.object({ role: z.enum(MEMBER_ROLES) })),
        async (c) => {
            const id = Number(c.req.param("id"));
            const userId = Number(c.req.param("userId"));
            const col = await requireManage(c.get("user")!, id);
            const { role } = c.req.valid("json");

            // 마지막 운영자가 스스로를 내리면 아무도 못 고치는 컬렉션이 된다.
            // 만든 사람은 멤버 표와 무관하게 운영자라 여기서 빼고 센다
            if (role === "member" && col.ownerId !== userId) {
                const [managers] = await db
                    .select({ n: sql<number>`count(*)::int` })
                    .from(collectionMembers)
                    .where(
                        and(
                            eq(collectionMembers.collectionId, id),
                            eq(collectionMembers.role, "manager"),
                        ),
                    );
                if ((managers?.n ?? 0) <= 1 && col.ownerId === null) {
                    throw new HTTPException(400, {
                        message: "마지막 운영자입니다. 다른 사람을 먼저 운영자로 올리세요.",
                    });
                }
            }

            const [row] = await db
                .update(collectionMembers)
                .set({ role })
                .where(
                    and(eq(collectionMembers.collectionId, id), eq(collectionMembers.userId, userId)),
                )
                .returning();
            if (!row) throw new HTTPException(404, { message: "명단에 없는 사람입니다" });
            return c.json({ member: row });
        },
    )

    /**
     * 명단 파일로 한 번에 등록. 계정이 없는 사람은 만들어 준다.
     *
     * 지금까지는 이미 가입한 사람만 넣을 수 있어서, 수업 첫 주에 전원이 먼저 가입해야 했다.
     * 한 명이라도 안 하면 그 사람 화면이 비고, 강사는 왜 안 보이는지 모른다.
     *
     * 만든 계정의 임시 비밀번호는 여기서 한 번만 돌려준다. 해시만 저장하므로 다시 볼 수 없다.
     * 강사가 받아서 나눠 주는 것이 전제다.
     */
    .post(
        "/:id{[0-9]+}/roster",
        requireAuth,
        v("json", z.object({ csv: z.string().min(1).max(200_000), role: z.enum(MEMBER_ROLES).default("member") })),
        async (c) => {
            const id = Number(c.req.param("id"));
            await requireManage(c.get("user")!, id);
            const { csv, role } = c.req.valid("json");

            const parsed = parseRoster(csv);
            if (parsed.rows.length > ROSTER_MAX_ROWS) {
                throw new HTTPException(413, {
                    message: `한 번에 ${ROSTER_MAX_ROWS}명까지 올릴 수 있습니다 (${parsed.rows.length}명).`,
                });
            }

            const created: Array<{ handle: string; email: string; name: string; password: string }> = [];
            const linked: string[] = [];
            const errors = [...parsed.errors];

            for (const row of parsed.rows) {
                /*
                 * 한 사람씩 트랜잭션을 연다.
                 *
                 * 500명을 한 트랜잭션으로 묶으면 한 줄이 어긋났을 때 전부 되돌아간다.
                 * 명단은 부분 성공이 맞다. 되는 사람은 넣고 안 되는 줄만 알려 준다.
                 */
                try {
                    await db.transaction(async (tx) => {
                        // 이미 있는 계정이면 그대로 명단에 넣는다. 비밀번호를 건드리지 않는다
                        const [byEmail] = await tx
                            .select({ userId: userEmails.userId })
                            .from(userEmails)
                            .where(sql`lower(${userEmails.email}) = ${row.email.toLowerCase()}`);
                        const [byHandle] = await tx
                            .select({ id: users.id })
                            .from(users)
                            .where(sql`lower(${users.handle}) = ${row.handle.toLowerCase()}`);

                        let userId = byEmail?.userId ?? byHandle?.id ?? null;

                        if (byEmail && byHandle && byEmail.userId !== byHandle.id) {
                            throw new Error("이메일과 아이디가 서로 다른 계정입니다");
                        }

                        if (userId === null) {
                            const password = makeTempPassword();
                            const [u] = await tx
                                .insert(users)
                                .values({
                                    handle: row.handle,
                                    passwordHash: await hashPassword(password),
                                    displayName: row.name || null,
                                })
                                .returning();
                            await tx.insert(userEmails).values({ userId: u!.id, email: row.email, isPrimary: true });
                            userId = u!.id;
                            created.push({ handle: row.handle, email: row.email, name: row.name, password });
                        } else {
                            linked.push(row.handle);
                        }

                        await tx
                            .insert(collectionMembers)
                            .values({ collectionId: id, userId, role })
                            .onConflictDoNothing();
                    });
                } catch (e) {
                    errors.push({
                        line: row.line,
                        message: `${row.handle}: ${e instanceof Error ? e.message : String(e)}`,
                    });
                }
            }

            return c.json({
                created: created.length,
                linked: linked.length,
                errors,
                /** 만든 계정만. 나눠 줄 파일 내용이고 다시 받을 수 없다 */
                passwordCsv: created.length > 0 ? resultCsv(created) : null,
            });
        },
    )

    /**
     * 교재를 마크다운 한 장으로 올린다.
     *
     * 항목을 화면에서 하나씩 만드는 건 주차 하나만 넘어가도 지친다. 설명을 쓰다가
     * 문제를 끼우는 순서 그대로 적고, 그걸 그대로 올릴 수 있어야 한다.
     *
     * 기존 항목을 전부 갈아엎는다. 뒤에 붙이는 방식으로 두면 두 번 올렸을 때 내용이
     * 두 배가 되는데, 그게 더 흔한 사고다. 화면에서 경고한다.
     */
    .post(
        "/:id{[0-9]+}/import",
        requireAuth,
        v("json", z.object({ markdown: z.string().min(1).max(1_000_000) })),
        async (c) => {
            const id = Number(c.req.param("id"));
            await requireManage(c.get("user")!, id);
            const { markdown } = c.req.valid("json");

            const parsed = parseCourseMarkdown(markdown);
            const errors = [...parsed.errors];

            /*
             * 참조한 문제가 실제로 있는지, 그리고 이 강의에 담을 수 있는지 본다.
             *
             * 없는 번호를 그대로 넣으면 학생 화면에서 빈 줄이 되고, 왜 안 보이는지
             * 아무도 모른다. 남의 강의 전용 문제를 번호로 끌어오는 것도 막아야 한다.
             */
            const wanted = parsed.items.filter((i) => i.kind === "problem").map((i) => i.problemId);
            const found =
                wanted.length > 0
                    ? await db
                          .select({ id: problems.id, owner: problems.ownerCollectionId, isPublic: problems.isPublic })
                          .from(problems)
                          .where(inArray(problems.id, wanted))
                    : [];
            const byId = new Map(found.map((p) => [p.id, p]));

            const usable = new Set<number>();
            for (const pid of wanted) {
                const p = byId.get(pid);
                if (!p) {
                    errors.push(`문제 ${pid} 이(가) 없습니다`);
                    continue;
                }
                if (p.owner !== null && p.owner !== id) {
                    errors.push(`문제 ${pid} 은(는) 다른 강의 전용입니다`);
                    continue;
                }
                usable.add(pid);
            }

            const items = parsed.items.filter((i) => i.kind !== "problem" || usable.has(i.problemId));

            await db.transaction(async (tx) => {
                await tx.delete(collectionItems).where(eq(collectionItems.collectionId, id));
                if (items.length) {
                    await tx.insert(collectionItems).values(
                        items.map((it, idx) => ({
                            collectionId: id,
                            idx,
                            kind: it.kind,
                            problemId: it.kind === "problem" ? it.problemId : null,
                            points: 100,
                            body: it.kind === "text" ? it.body : null,
                            heading: it.kind === "text" ? it.heading : null,
                        })),
                    );
                }
            });

            return c.json({
                items: items.length,
                problems: items.filter((i) => i.kind === "problem").length,
                errors,
            });
        },
    )

    /**
     * 성적표. 학생 x 문제 표를 만든다.
     *
     * 순위표(scoreboard)와 다른 물건이다. 순위표는 대회용으로 등수와 페널티를 보고,
     * 이건 수업용으로 누가 뭘 어디까지 했는지를 본다. 등수가 없고 안 푼 칸이 그대로 보인다.
     *
     * 점수는 그 문제에서 받은 최고 점수다. 여러 번 냈으면 제일 잘 본 것을 친다. 부분 점수가
     * 있는 문제에서 마지막 제출이 더 나쁠 수 있는데, 그걸로 성적을 매기면 다시 내는 것이
     * 손해가 된다.
     */
    .get("/:id{[0-9]+}/scores", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        await requireAssist(c.get("user")!, id);

        const items = await db
            .select({
                problemId: collectionItems.problemId,
                idx: collectionItems.idx,
                dueAt: collectionItems.dueAt,
                title: problems.title,
                kind: problems.kind,
            })
            .from(collectionItems)
            .innerJoin(problems, eq(problems.id, collectionItems.problemId))
            .where(and(eq(collectionItems.collectionId, id), eq(collectionItems.kind, "problem")))
            .orderBy(asc(collectionItems.idx));

        const members = await db
            .select({
                userId: collectionMembers.userId,
                handle: users.handle,
                displayName: users.displayName,
                role: collectionMembers.role,
            })
            .from(collectionMembers)
            .innerJoin(users, eq(users.id, collectionMembers.userId))
            .where(eq(collectionMembers.collectionId, id))
            .orderBy(users.handle);

        /*
         * 점수를 한 번에 모은다. 학생마다 질의하면 30명 x 10문제에서 질의가 300번이다.
         *
         * 제출이 없는 칸은 행이 안 나온다. 화면에서 없는 칸을 0 으로 그린다. 여기서
         * 0 행을 만들어 내보내면 "안 냈다" 와 "내고 0점" 이 구분이 안 된다.
         */
        const problemIds = items.map((i) => i.problemId).filter((n): n is number => n !== null);
        const userIds = members.map((m) => m.userId);

        const cells =
            problemIds.length > 0 && userIds.length > 0
                ? await db
                      .select({
                          userId: submissions.userId,
                          problemId: submissions.problemId,
                          best: sql<number>`max(${submissions.score})::int`,
                          tries: sql<number>`count(*)::int`,
                          solved: sql<boolean>`bool_or(${submissions.verdict} = 'accepted')`,
                          /** 처음 맞힌 시각. 항목 마감과 견줘 지각인지 본다 */
                          firstSolvedAt: sql<string | null>`
                              min(${submissions.createdAt}) FILTER (WHERE ${submissions.verdict} = 'accepted')
                          `,
                      })
                      .from(submissions)
                      .where(
                          and(
                              inArray(submissions.userId, userIds),
                              inArray(submissions.problemId, problemIds),
                              eq(submissions.status, "done"),
                          ),
                      )
                      .groupBy(submissions.userId, submissions.problemId)
                : [];

        return c.json({ items, members, cells });
    })

    /** 멤버 한 명 제외. 제출 기록은 남는다 */
    .delete("/:id{[0-9]+}/members/:userId{[0-9]+}", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        const userId = Number(c.req.param("userId"));
        await requireManage(c.get("user")!, id);

        const [row] = await db
            .delete(collectionMembers)
            .where(and(eq(collectionMembers.collectionId, id), eq(collectionMembers.userId, userId)))
            .returning();
        if (!row) throw new HTTPException(404, { message: "명단에 없는 사람입니다" });
        return c.json({ ok: true });
    })

    /** 공개 컬렉션에 스스로 참여. private 은 운영자가 명단으로 넣는다 */
    .post("/:id{[0-9]+}/join", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        const [col] = await db.select().from(collections).where(eq(collections.id, id));
        if (!col) throw new HTTPException(404, { message: "찾을 수 없습니다" });

        if (col.joinPolicy === "invite") {
            throw new HTTPException(403, { message: "초대받은 사람만 참여할 수 있습니다" });
        }
        if (col.joinPolicy === "members") {
            throw new HTTPException(403, { message: "운영자가 등록해야 참여할 수 있습니다" });
        }
        if (col.timing === "fixed" && hasEnded(col)) {
            throw new HTTPException(409, { message: "이미 끝났습니다" });
        }

        await db
            .insert(collectionMembers)
            .values({ collectionId: id, userId: c.get("user")!.id })
            .onConflictDoNothing();
        return c.json({ ok: true });
    })

    /**
     * 코딩테스트 시작. 여기서부터 개인별 타이머가 흐른다.
     * 한 번 누르면 되돌릴 수 없으므로 화면에서 확인을 받아야 한다.
     */
    .post("/:id{[0-9]+}/start", requireAuth, async (c) => {
        const id = Number(c.req.param("id"));
        const user = c.get("user")!;

        const [col] = await db.select().from(collections).where(eq(collections.id, id));
        if (!col) throw new HTTPException(404, { message: "찾을 수 없습니다" });
        if (col.timing !== "per_user") {
            throw new HTTPException(400, { message: "각자 시작하는 형태가 아닙니다" });
        }
        if (!col.durationMinutes) {
            throw new HTTPException(500, { message: "제한 시간이 설정되지 않았습니다" });
        }

        const [member] = await db
            .select()
            .from(collectionMembers)
            .where(
                and(eq(collectionMembers.collectionId, id), eq(collectionMembers.userId, user.id)),
            );
        if (!member) throw new HTTPException(403, { message: "참가 대상이 아닙니다" });
        if (member.startedAt) throw new HTTPException(409, { message: "이미 시작했습니다" });

        const startedAt = new Date();
        const endsAt = new Date(startedAt.getTime() + col.durationMinutes * 60_000);
        await db
            .update(collectionMembers)
            .set({ startedAt, endsAt })
            .where(
                and(eq(collectionMembers.collectionId, id), eq(collectionMembers.userId, user.id)),
            );

        return c.json({ ok: true, startedAt, endsAt });
    })

    /**
     * 순위표. scoring 축에 따라 규칙이 갈린다.
     *
     * progress: 푼 문제 수만 (문제집 진도)
     * icpc:     푼 수로 세우고 동률은 페널티. 못 푼 문제의 오답은 페널티에 안 넣는다
     * ioi:      문제별 최고 점수의 합
     *
     * 동결(frozen)은 스코어보드를 가리는 것이지 채점을 멈추는 게 아니다.
     */
    .get("/:slug/scoreboard", async (c) => {
        const col = await loadBySlug(c.req.param("slug"));
        const user = c.get("user") ?? null;
        const { canView, canManage } = await collectionAccess(user, col);
        if (!canView) throw new HTTPException(404, { message: "찾을 수 없습니다" });
        if (col.scoring === "none") return c.json({ collection: col, scoring: "none", rows: [] });

        const freezeAt =
            col.reveal === "frozen" && col.freezeMinutes > 0 && col.endsAt
                ? new Date(col.endsAt.getTime() - col.freezeMinutes * 60_000)
                : null;
        // 운영자는 동결을 무시하고 실제 순위를 본다
        // 동결 중이면 동결 시각까지만 센다. 운영자는 동결을 무시하고 실제 순위를 본다
        const cutoff = canManage || !freezeAt ? col.endsAt : freezeAt;

        const rows = await scoreboard(db, {
            collectionId: col.id,
            scoring: col.scoring,
            startsAt: col.startsAt,
            cutoff,
            penaltyMinutes: col.penaltyMinutes,
        });

        return c.json({
            collection: col,
            scoring: col.scoring,
            frozen: !!freezeAt && new Date() >= freezeAt && !canManage,
            freezeAt,
            rows,
        });
    });
