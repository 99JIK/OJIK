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
    collectionMembers,
    problems,
    submissions,
    users,
    scoreboard,
} from "@ojik/db";
import { db } from "../db";
import { requireAuth, requireRole, type AuthEnv } from "../auth";
import { collectionAccess, canSeeItems } from "../access";

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

export const collectionRoutes = new Hono<AuthEnv>()
    .get(
        "/",
        v("query", z.object({ preset: z.enum(COLLECTION_PRESETS).optional() })),
        async (c) => {
            const { preset } = c.req.valid("query");
            const user = c.get("user");
            const isStaff = user ? atLeast(user.role, "staff") : false;

            const conds = [];
            if (preset) conds.push(eq(collections.preset, preset));
            if (!isStaff) {
                // private 은 자기가 속한 것만. unlisted 는 목록에 안 띄운다
                conds.push(
                    user
                        ? sql`(${collections.visibility} = 'public' OR EXISTS (
                               SELECT 1 FROM collection_members m
                               WHERE m.collection_id = ${collections.id} AND m.user_id = ${user.id}))`
                        : eq(collections.visibility, "public"),
                );
            }

            const rows = await db
                .select()
                .from(collections)
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
                      body: collectionItems.body,
                      heading: collectionItems.heading,
                      problemId: problems.id,
                      problemTitle: problems.title,
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

        // 내가 푼 문제. 상시 컬렉션의 진도 표시용
        let solved: number[] = [];
        const problemIds = items.filter((i) => i.problemId).map((i) => i.problemId!);
        if (user && problemIds.length > 0) {
            const got = await db
                .selectDistinct({ problemId: submissions.problemId })
                .from(submissions)
                .where(
                    and(
                        eq(submissions.userId, user.id),
                        eq(submissions.verdict, "accepted"),
                        inArray(submissions.problemId, problemIds),
                    ),
                );
            solved = got.map((g) => g.problemId);
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
        });
    })

    .post("/", requireRole("staff"), v("json", Body), async (c) => {
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

    .patch("/:id{[0-9]+}", requireRole("staff"), v("json", Body.partial()), async (c) => {
        const id = Number(c.req.param("id"));
        const patch = c.req.valid("json");

        const [current] = await db.select().from(collections).where(eq(collections.id, id));
        if (!current) throw new HTTPException(404, { message: "찾을 수 없습니다" });

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
    .put("/:id{[0-9]+}/items", requireRole("staff"), v("json", ItemsBody), async (c) => {
        const id = Number(c.req.param("id"));
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
        requireRole("staff"),
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
