import { Hono } from "hono";
import { z } from "zod";
import { v } from "../validate";
import { and, asc, desc, eq, lt, ne, sql, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
    LANGUAGE_IDS,
    VERDICTS,
    MAX_SOURCE_BYTES,
    BLANK_MAX_BYTES,
    ANSWER_MAX_BYTES,
    requireLanguage,
    needsJudge,
    fillBlanks,
    encodeAnswers,
    gradeAnswer,
    decodeAnswers,
    type LanguageId,
    type Verdict,
} from "@ojik/core";
import {
    submissions,
    submissionResults,
    problems,
    testcases,
    users,
    notifyQueue,
    enqueue,
    type Problem,
} from "@ojik/db";
import { db } from "../db";
import { requireAuth, requireRole, type AuthEnv } from "../auth";
import { problemAccess, canViewSource, verdictVisible } from "../access";
import { readTestcaseFile } from "../storage";

/**
 * 제출 본문.
 *
 * 유형마다 담기는 게 다르다. code 는 소스, blank 는 채운 줄, answer 는 문항별 답이다.
 * 라우트를 셋으로 나누지 않는 건, 접근 검사와 카운터 갱신이 똑같아서다. 셋으로 나누면
 * 그걸 세 번 쓰고 한 군데만 고치는 사고가 난다.
 */
const SubmitBody = z.object({
    problemId: z.number().int().positive(),
    /** kind=code 일 때만 본다. blank 는 문제가 정한 언어를 쓰고 answer 는 언어가 없다 */
    language: z.enum(LANGUAGE_IDS).optional(),
    sourceCode: z.string().optional(),
    /** kind=blank. 줄 번호별로 채운 내용 */
    blanks: z.record(z.coerce.number().int(), z.string().max(BLANK_MAX_BYTES)).optional(),
    /** kind=answer. 문항(테스트케이스 idx)별 답 */
    answers: z.record(z.coerce.number().int(), z.string().max(ANSWER_MAX_BYTES)).optional(),
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

/**
 * 유형에 맞게 저장할 언어와 소스를 만든다.
 *
 * 여기서 갈라 두면 아래 저장과 카운터는 유형을 안 봐도 된다. blank 는 이 단계에서 이미
 * 완성된 코드가 되므로 워커는 code 와 구분하지 않는다. 워커에 유형별 분기를 넣지 않는 게
 * 목적이다. 샌드박스 쪽은 건드릴 일이 적을수록 좋다.
 */
async function buildSubmission(
    problem: Problem,
    body: { language?: string; sourceCode?: string; blanks?: Record<number, string>; answers?: Record<number, string> },
): Promise<{ language: LanguageId | null; sourceCode: string }> {
    if (problem.kind === "answer") {
        const answers = body.answers ?? {};
        if (Object.keys(answers).length === 0) {
            throw new HTTPException(400, { message: "답을 하나도 안 적었습니다" });
        }
        // 단답형에는 언어가 없다. 컬럼이 nullable 인 이유가 이것 하나다
        return { language: null, sourceCode: encodeAnswers(answers) };
    }

    if (problem.kind === "blank") {
        if (!problem.blankTemplate || !problem.blankLanguage) {
            throw new HTTPException(409, { message: "빈칸 문제가 아직 다 만들어지지 않았습니다" });
        }
        const filled = fillBlanks(problem.blankTemplate, problem.blankLines ?? [], body.blanks ?? {});
        return { language: problem.blankLanguage, sourceCode: filled };
    }

    if (!body.language) throw new HTTPException(400, { message: "언어를 고르세요" });
    if (!body.sourceCode?.trim()) throw new HTTPException(400, { message: "소스가 비어 있습니다" });
    // 지원 목록에 없는 언어면 여기서 걸린다. 채점 단계까지 흘러가서 죽지 않는다
    requireLanguage(body.language);
    return { language: body.language, sourceCode: body.sourceCode };
}

/**
 * 단답형 채점.
 *
 * 워커를 안 거치고 여기서 끝낸다. 샌드박스가 할 일이 없는데 큐를 태우면 대기만 는다.
 * 결과 모양은 코드 제출과 같게 맞춘다. 채점 현황과 점수 계산이 유형을 안 봐도 되게.
 *
 * 채점 결과(submission_results)에는 문항마다 한 줄씩 남긴다. 테스트케이스 표를 그대로
 * 쓰기 때문에 가능한 것이고, 덕분에 "몇 번 문항에서 틀렸는지"가 코드 문제와 같은 길로 나온다.
 */
async function gradeAnswerSubmission(
    problem: Problem,
    submissionId: number,
    answers: Record<number, string>,
): Promise<{ status: "done"; verdict: Verdict }> {
    const cases = await db
        .select()
        .from(testcases)
        .where(eq(testcases.problemId, problem.id))
        .orderBy(asc(testcases.idx));

    const outcomes = [] as Array<{ idx: number; testcaseId: number; ok: boolean; points: number }>;
    for (const tc of cases) {
        // 기댓값은 파일에 있다. 테스트케이스 저장 방식을 유형별로 나누지 않았다
        const expected = await readTestcaseFile(problem.id, tc.idx, "out").catch(() => "");
        const given = answers[tc.idx] ?? "";
        const ok = given.trim() !== "" && gradeAnswer(problem.checkerType, given, expected, problem.floatEpsilon);
        outcomes.push({ idx: tc.idx, testcaseId: tc.id, ok, points: ok ? tc.points : 0 });
    }

    const allOk = outcomes.length > 0 && outcomes.every((o) => o.ok);
    const verdict: Verdict = allOk ? "accepted" : "wrong_answer";
    const score = outcomes.reduce((a, o) => a + o.points, 0);
    const failed = outcomes.find((o) => !o.ok) ?? null;

    await db.transaction(async (tx) => {
        if (outcomes.length > 0) {
            await tx.insert(submissionResults).values(
                outcomes.map((o) => ({
                    submissionId,
                    testcaseId: o.testcaseId,
                    idx: o.idx,
                    verdict: (o.ok ? "accepted" : "wrong_answer") as Verdict,
                    timeMs: 0,
                    memoryKb: 0,
                    points: o.points,
                })),
            );
        }

        await tx
            .update(submissions)
            .set({
                status: "done",
                verdict,
                score,
                judgedCount: outcomes.length,
                failedIdx: failed?.idx ?? null,
                judgedAt: new Date(),
                claimedBy: null,
            })
            .where(eq(submissions.id, submissionId));

        if (allOk) {
            // 처음 맞힌 것만 센다. 워커의 judge.ts 와 같은 규칙이다
            const [prior] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(submissions)
                .where(
                    and(
                        eq(submissions.problemId, problem.id),
                        eq(submissions.userId, sql`(SELECT user_id FROM submissions WHERE id = ${submissionId})`),
                        eq(submissions.verdict, "accepted"),
                        ne(submissions.id, submissionId),
                    ),
                );
            if ((prior?.n ?? 0) === 0) {
                await tx
                    .update(problems)
                    .set({ acceptedCount: sql`${problems.acceptedCount} + 1` })
                    .where(eq(problems.id, problem.id));
                await tx.execute(sql`
                    UPDATE users SET solved_count = solved_count + 1
                    WHERE id = (SELECT user_id FROM submissions WHERE id = ${submissionId})
                `);
            }
        }
    });

    return { status: "done", verdict };
}

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

        const [problem] = await db.select().from(problems).where(eq(problems.id, body.problemId));
        if (!problem) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });

        const access = await problemAccess(user, problem);
        if (!access.canView) throw new HTTPException(404, { message: "문제를 찾을 수 없습니다" });
        if (!access.canSubmit) throw new HTTPException(403, { message: "제출할 수 없는 문제입니다" });

        // 유형별로 저장할 소스와 언어를 정한다. 여기서 정해지면 아래는 다 같은 길이다
        const { language, sourceCode } = await buildSubmission(problem, body);

        const sourceBytes = Buffer.byteLength(sourceCode, "utf8");
        if (sourceBytes > MAX_SOURCE_BYTES) {
            throw new HTTPException(413, { message: `소스가 너무 깁니다 (최대 ${MAX_SOURCE_BYTES}바이트)` });
        }

        const sub = await db.transaction(async (tx) => {
            const [row] = await tx
                .insert(submissions)
                .values({
                    problemId: problem.id,
                    userId: user.id,
                    collectionId: access.collection?.id ?? null,
                    language,
                    sourceCode,
                    sourceBytes,
                    // 단답형은 큐를 안 탄다. 아래에서 바로 채점하고 done 으로 바꾼다
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

        if (!needsJudge(problem.kind)) {
            // 단답형은 워커를 안 거친다. 여기서 채점하고 끝낸다
            const graded = await gradeAnswerSubmission(problem, sub.id, body.answers ?? {});
            return c.json({ submission: { id: sub.id, status: graded.status, verdict: graded.verdict } }, 201);
        }

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

        const [problem] = await db
            .select({ kind: problems.kind })
            .from(problems)
            .where(eq(problems.id, sub.problemId));
        const kind = problem?.kind ?? "code";

        /*
         * 단답형 제출은 소스 코드가 아니라 답 묶음이다.
         *
         * sourceCode 에 JSON 이 들어 있어서 그대로 내보내면 화면이 중괄호를 뿌린다.
         * 여기서 풀어 주고 sourceCode 는 안 내보낸다. 문항 지문도 같이 준다.
         * 지문 없이 "문항 0" 만 보여 주면 뭘 틀렸는지 알 수가 없다.
         */
        let answers: Array<{ idx: number; prompt: string; given: string }> | null = null;
        if (kind === "answer" && showSource) {
            const given = decodeAnswers(sub.sourceCode);
            const cases = await db
                .select({ idx: testcases.idx })
                .from(testcases)
                .where(eq(testcases.problemId, sub.problemId))
                .orderBy(asc(testcases.idx));
            answers = await Promise.all(
                cases.map(async (t) => ({
                    idx: t.idx,
                    prompt: await readTestcaseFile(sub.problemId, t.idx, "in").catch(() => ""),
                    given: given[t.idx] ?? "",
                })),
            );
        }

        return c.json({
            problemKind: kind,
            answers,
            submission: {
                ...sub,
                // 단답형은 위 answers 로 나간다. JSON 원문을 소스인 척 보내지 않는다
                sourceCode: showSource && kind !== "answer" ? sub.sourceCode : null,
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
