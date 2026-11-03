import fs from "node:fs/promises";
import path from "node:path";
import { eq, and, asc, ne, sql } from "drizzle-orm";
import {
    requireLanguage,
    effectiveRunLimits,
    resolveRunArgv,
    worstVerdict,
    MAX_OUTPUT_BYTES,
    STORED_OUTPUT_SNIPPET_BYTES,
    type Verdict,
    type LanguageSpec,
    type StepLimits,
    check,
} from "@ojik/core";
import {
    problems,
    testcases,
    submissions,
    submissionResults,
    users,
    type Db,
    type Submission,
    type Problem,
    type Testcase,
} from "@ojik/db";
import { config } from "./config";
import { prepareChecker, runChecker, CheckerError, type PreparedChecker } from "./specialjudge";
import { log } from "./log";
import { RunnerPool, type Box } from "./pool";
import * as isolate from "./isolate";


/** 컨테이너 안에서 본 박스 부속 파일 경로. meta 는 박스 밖이라야 제출 코드가 못 건드린다 */
function containerPath(box: Box, name: string): string {
    return `/var/local/lib/isolate/${box.boxId}/${name}`;
}

interface TcOutcome {
    idx: number;
    testcaseId: number;
    verdict: Verdict;
    timeMs: number;
    memoryKb: number;
    points: number;
    /** DB 에는 안 들어간다. 처음 실패한 케이스의 것만 제출 행에 남긴다.
     *  케이스마다 저장하면 출력이 큰 문제에서 소스보다 수십 배 무거워진다.
     *  숨은 케이스에서는 아예 null 이다. 아래 keepOutput 참고 */
    stdout: string | null;
    stderr: string | null;
}

/** 학생 코드 잘못이 아닌 실패. 위로 던지면 제출이 큐로 돌아가 재시도된다 */
export class JudgeError extends Error {}

export async function judge(
    db: Db,
    pool: RunnerPool,
    sub: Submission,
    judgeEnvId: number | null,
): Promise<void> {
    const started = Date.now();

    const [problem] = await db.select().from(problems).where(eq(problems.id, sub.problemId));
    if (!problem) throw new JudgeError(`problem ${sub.problemId} not found`);

    const tcs = await db
        .select()
        .from(testcases)
        .where(eq(testcases.problemId, sub.problemId))
        .orderBy(asc(testcases.idx));

    if (tcs.length === 0) {
        // 테스트케이스가 없으면 채점할 게 없다. KOJ 는 cp 가 실패해서 internal_error 로만 떨어졌고
        // 원인을 알려면 워커 로그를 봐야 했다. 여기서는 사유를 행에 남긴다
        await finalize(db, sub, problem, "internal_error", [], null, "문제에 테스트케이스가 없습니다", judgeEnvId);
        return;
    }

    // 단답형은 큐를 안 타므로 여기 올 일이 없다. 와 버렸으면 데이터가 어긋난 것이다
    if (!sub.language) throw new JudgeError(`제출 ${sub.id} 에 언어가 없습니다. 단답형이 큐에 들어왔습니까?`);
    const lang = requireLanguage(sub.language);
    await db
        .update(submissions)
        .set({ totalCount: tcs.length, judgedCount: 0 })
        .where(eq(submissions.id, sub.id));

    const boxCount = Math.min(config.WORKER_TC_PARALLEL, tcs.length);
    const boxes: Box[] = [];
    let checkerBox: Box | null = null;
    try {
        for (let i = 0; i < boxCount; i++) boxes.push(await pool.acquire(lang.runner));

        const compileErr = await compile(pool, boxes[0]!, lang, sub.sourceCode);
        if (compileErr !== null) {
            await finalize(db, sub, problem, "compile_error", [], compileErr, null, judgeEnvId);
            return;
        }

        // 컴파일 산출물을 나머지 박스로 한 번씩만 복사한다.
        // 테스트케이스마다 복사하면 정적 링크된 C 바이너리에선 그 비용이 실행보다 커진다
        for (let i = 1; i < boxes.length; i++) {
            await copyArtifacts(boxes[0]!, boxes[i]!, lang);
        }

        /*
         * 스페셜 저지면 체커를 따로 컴파일한다.
         *
         * 박스를 하나 더 잡는 이유는 이름 충돌이다. 컴파일 argv 가 lang.sourceName 에
         * 박혀 있어서 같은 박스에 두면 학생 소스와 체커 소스가 서로 덮어쓴다.
         *
         * 체커 박스는 하나만 잡는다. 케이스 병렬 실행과 겹치지만, 체커 실행은 파일을
         * 쓰고 바로 읽는 짧은 일이라 아래에서 한 번에 하나씩 돌린다.
         */
        let checker: PreparedChecker | null = null;
        if (problem.checkerType === "special") {
            if (!problem.checkerSource || !problem.checkerLanguage) {
                throw new JudgeError("스페셜 저지 문제인데 체커가 없습니다");
            }
            const checkerLang = requireLanguage(problem.checkerLanguage);
            checkerBox = await pool.acquire(checkerLang.runner);
            checker = await prepareChecker(
                pool,
                checkerBox,
                problem.checkerSource,
                problem.checkerLanguage,
                compile,
            );
        }

        const outcomes = await runTestcases(db, pool, boxes, lang, sub, problem, tcs, checker);
        const verdict = worstVerdict(outcomes.map((o) => o.verdict));
        await finalize(db, sub, problem, verdict, outcomes, null, null, judgeEnvId);

        log.info("judged", {
            submission: sub.id,
            verdict,
            tc: `${outcomes.length}/${tcs.length}`,
            ms: Date.now() - started,
        });
    } finally {
        for (const b of boxes) await pool.release(b);
        if (checkerBox) await pool.release(checkerBox);
    }
}

/** 성공하면 null, 실패하면 사용자에게 보여줄 컴파일 메시지 */
async function compile(
    pool: RunnerPool,
    box: Box,
    lang: LanguageSpec,
    source: string,
): Promise<string | null> {
    await fs.writeFile(path.join(box.hostDir, lang.sourceName), source, "utf8");
    if (!lang.compile) return null;

    const metaName = "compile.meta";
    const args = isolate.runArgs({
        boxId: box.boxId,
        argv: lang.compile.argv,
        limits: lang.compile.limits,
        stdoutFile: "compile.out",
        stderrFile: "compile.err",
        metaPath: containerPath(box, metaName),
        // 컴파일 산출물 크기 상한. 없으면 include 폭탄으로 박스를 채울 수 있다
        fsizeKb: 128 * 1024,
    });

    const r = await pool.exec(box, ["isolate", ...args]);
    const meta = isolate.parseMeta(await readIfExists(path.join(box.hostMetaDir, metaName)));
    const outcome = isolate.classify(meta, lang.compile.limits);

    if (outcome === "ok") return null;

    if (outcome === "internal_error") {
        // isolate 자체가 실패한 것은 학생 코드 문제가 아니다. 위로 던져서 재시도시킨다
        throw new JudgeError(`isolate failed during compile: ${meta.message || r.stderr}`);
    }

    const stderr = await readIfExists(path.join(box.hostDir, "compile.err"));
    const stdout = await readIfExists(path.join(box.hostDir, "compile.out"));
    let msg = (stderr || stdout).trim();

    if (outcome === "time_limit_exceeded") msg = msg || "컴파일 시간 초과";
    else if (outcome === "memory_limit_exceeded") msg = msg || "컴파일 메모리 초과";

    // 샌드박스 내부 경로를 그대로 노출하지 않는다
    msg = msg.split("/box/").join("").slice(0, 16 * 1024);
    return msg || "컴파일 실패";
}

async function copyArtifacts(from: Box, to: Box, lang: LanguageSpec): Promise<void> {
    const names = lang.compile?.artifacts ?? [lang.sourceName];
    if (names.includes("*")) {
        // Java 는 내부 클래스가 Main$1.class 로 몇 개 떨어질지 미리 모른다. 박스째 옮긴다
        const entries = await fs.readdir(from.hostDir);
        for (const e of entries) {
            if (e.startsWith("compile.")) continue;
            await fs.cp(path.join(from.hostDir, e), path.join(to.hostDir, e), { recursive: true });
        }
        return;
    }
    for (const n of names) {
        const dst = path.join(to.hostDir, n);
        await fs.copyFile(path.join(from.hostDir, n), dst);
        // 실행 비트가 안 넘어오면 전 케이스가 runtime_error 로 떨어진다
        await fs.chmod(dst, 0o755).catch(() => {});
    }
}

async function runTestcases(
    db: Db,
    pool: RunnerPool,
    boxes: Box[],
    lang: LanguageSpec,
    sub: Submission,
    problem: Problem,
    tcs: Testcase[],
    /** 스페셜 저지가 아니면 null */
    checker: PreparedChecker | null,
): Promise<TcOutcome[]> {
    const limits = effectiveRunLimits(lang, problem.timeLimitMs, problem.memoryLimitMb);
    const argv = resolveRunArgv(lang, problem.memoryLimitMb);
    const tcDir = path.join(config.DATA_DIR, "problems", String(problem.id), "tc");

    const outcomes: TcOutcome[] = [];
    let stopped = false;
    let next = 0;
    let judged = 0;

    async function drain(box: Box): Promise<void> {
        for (;;) {
            if (stopped) return;
            const i = next++;
            if (i >= tcs.length) return;
            const tc = tcs[i]!;

            const o = await runOne(pool, box, lang, argv, limits, problem, tcDir, tc, checker);
            outcomes.push(o);
            judged++;

            // 진행률은 화면에 바로 보여야 하니 케이스마다 쓴다. 행 하나 UPDATE 라 비용은 작다
            await db
                .update(submissions)
                .set({ judgedCount: judged })
                .where(eq(submissions.id, sub.id))
                .catch(() => {});

            // 첫 오답에서 멈추는 건 자원 절약이지 판정 규칙이 아니다.
            // 부분점수 문제는 problem.stopOnFirstFail 을 꺼야 점수가 제대로 나온다
            if (problem.stopOnFirstFail && o.verdict !== "accepted") {
                stopped = true;
                return;
            }
        }
    }

    await Promise.all(boxes.map((b) => drain(b)));
    outcomes.sort((a, b) => a.idx - b.idx);
    return outcomes;
}

async function runOne(
    pool: RunnerPool,
    box: Box,
    lang: LanguageSpec,
    argv: string[],
    limits: StepLimits,
    problem: Problem,
    tcDir: string,
    tc: Testcase,
    checker: PreparedChecker | null,
): Promise<TcOutcome> {
    // 이 테스트케이스 하나만 박스에 넣는다. 제출 단위로 TC 전체를 복사하는 KOJ 와의 차이.
    // BOX_ROOT 가 tmpfs 면 이 복사는 메모리 안에서 끝난다
    await fs.copyFile(path.join(tcDir, `${tc.idx}.in`), path.join(box.hostDir, "stdin"));

    // 앞 케이스 출력이 남아 있으면 이번 실행이 실패했을 때 그걸 정답과 비교하게 된다
    await fs.rm(path.join(box.hostDir, "stdout"), { force: true });
    await fs.rm(path.join(box.hostDir, "stderr"), { force: true });

    const metaName = "run.meta";
    await pool.exec(box, [
        "isolate",
        ...isolate.runArgs({
            boxId: box.boxId,
            argv,
            limits,
            stdinFile: "stdin",
            stdoutFile: "stdout",
            stderrFile: "stderr",
            metaPath: containerPath(box, metaName),
            fsizeKb: Math.ceil(MAX_OUTPUT_BYTES / 1024),
        }),
    ]);

    const meta = isolate.parseMeta(await readIfExists(path.join(box.hostMetaDir, metaName)));
    const outcome = isolate.classify(meta, limits);

    /**
     * 출력을 남기는 건 공개 케이스뿐이다.
     *
     * 숨은 케이스의 출력을 제출자에게 보여 주면 테스트케이스가 새어 나간다.
     * print(input()) 처럼 입력을 그대로 뱉고 일부러 틀리면, 한 제출에 케이스 하나씩
     * 뽑아낼 수 있다. stderr 도 같은 경로라 함께 막는다.
     *
     * 대신 숨은 케이스에서 런타임 에러가 나면 제출자가 스택 트레이스를 못 본다.
     * 케이스 유출보다는 이쪽이 낫다고 보고 막는 쪽을 택했다.
     */
    const keepOutput = tc.isSample;

    const base = {
        idx: tc.idx,
        testcaseId: tc.id,
        timeMs: Math.round(meta.time * 1000),
        memoryKb: meta.memoryKb,
        points: 0,
        stderr: keepOutput ? snippet(await readIfExists(path.join(box.hostDir, "stderr"))) : null,
    };

    if (outcome === "internal_error") {
        throw new JudgeError(`isolate failed on tc ${tc.idx}: ${meta.message}`);
    }
    if (outcome !== "ok") {
        return { ...base, verdict: outcome, stdout: null };
    }

    const actual = await readFileCapped(path.join(box.hostDir, "stdout"), MAX_OUTPUT_BYTES);
    if (actual === null) {
        return { ...base, verdict: "output_limit_exceeded", stdout: null };
    }
    const expected = await fs.readFile(path.join(tcDir, `${tc.idx}.out`));

    /*
     * 비교.
     *
     * 스페셜 저지는 체커 프로그램이 판정한다. 체커가 규약을 벗어나면 CheckerError 가
     * 올라오는데, 그걸 JudgeError 로 바꿔 채점 오류로 만든다. 학생 코드는 멀쩡한데
     * 출제자가 체커를 잘못 쓴 것이라 오답으로 떨어뜨리면 안 된다.
     */
    let ok: boolean;
    if (checker) {
        const input = await fs.readFile(path.join(tcDir, `${tc.idx}.in`));
        try {
            const r = await runChecker(pool, checker, { input, expected, actual }, problem.memoryLimitMb);
            ok = r.ok;
        } catch (e) {
            if (e instanceof CheckerError) throw new JudgeError(e.message);
            throw e;
        }
    } else {
        ok = check(problem.checkerType, actual, expected, problem.floatEpsilon).ok;
    }

    return {
        ...base,
        verdict: ok ? "accepted" : "wrong_answer",
        points: ok ? tc.points : 0,
        stdout: keepOutput ? snippet(actual.toString("utf8")) : null,
    };
}

/**
 * 결과 확정. 제출 갱신과 케이스별 결과 삽입을 한 트랜잭션으로 묶는다.
 * 중간에 죽으면 제출은 judging 으로 남고, lease 가 끊겨 다른 워커가 회수한다.
 */
async function finalize(
    db: Db,
    sub: Submission,
    problem: Problem,
    verdict: Verdict,
    outcomes: TcOutcome[],
    compileOutput: string | null,
    judgeError: string | null,
    judgeEnvId: number | null,
): Promise<void> {
    const totalPoints = outcomes.reduce((s, o) => s + o.points, 0);
    // 부분점수를 안 쓰는 문제(testcase.points 가 전부 0)는 통과 개수 비율로 환산한다
    const usesPoints = outcomes.some((o) => o.points > 0);
    const passed = outcomes.filter((o) => o.verdict === "accepted").length;
    const score = usesPoints
        ? totalPoints
        : outcomes.length > 0
          ? Math.round((passed / outcomes.length) * 100)
          : 0;

    // 사용자가 보는 건 처음 틀린 케이스 하나뿐이다. 그것만 제출 행에 남긴다
    const failed = outcomes.find((o) => o.verdict !== "accepted") ?? null;

    await db.transaction(async (tx) => {
        if (outcomes.length > 0) {
            await tx.insert(submissionResults).values(
                outcomes.map((o) => ({
                    submissionId: sub.id,
                    testcaseId: o.testcaseId,
                    idx: o.idx,
                    verdict: o.verdict,
                    timeMs: o.timeMs,
                    memoryKb: o.memoryKb,
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
                maxTimeMs: outcomes.length ? Math.max(...outcomes.map((o) => o.timeMs)) : null,
                maxMemoryKb: outcomes.length ? Math.max(...outcomes.map((o) => o.memoryKb)) : null,
                compileOutput,
                judgeError,
                failedIdx: failed?.idx ?? null,
                failedStdout: failed?.stdout ?? null,
                failedStderr: failed?.stderr ?? null,
                judgeEnvId,
                testcaseVersion: problem.testcaseVersion,
                judgedAt: new Date(),
                claimedBy: null,
                claimedAt: null,
                heartbeatAt: null,
            })
            .where(eq(submissions.id, sub.id));

        if (verdict !== "accepted") return;

        // 이 유저가 이 문제를 처음 맞힌 건지. 두 번째부터는 카운터를 올리지 않는다.
        // 재채점으로 판정이 뒤집히면 이 캐시는 어긋날 수 있다. 바로잡는 건 scripts/recount.ts
        const [prior] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(submissions)
            .where(
                and(
                    eq(submissions.problemId, sub.problemId),
                    eq(submissions.userId, sub.userId),
                    eq(submissions.verdict, "accepted"),
                    ne(submissions.id, sub.id),
                ),
            );
        if ((prior?.n ?? 0) > 0) return;

        await tx
            .update(problems)
            .set({ acceptedCount: sql`${problems.acceptedCount} + 1` })
            .where(eq(problems.id, problem.id));
        await tx
            .update(users)
            .set({ solvedCount: sql`${users.solvedCount} + 1` })
            .where(eq(users.id, sub.userId));
    });
}

async function readIfExists(p: string): Promise<string> {
    try {
        return await fs.readFile(p, "utf8");
    } catch {
        return "";
    }
}

/** 상한을 넘으면 null. 다 읽어 놓고 재는 게 아니라 크기부터 본다 */
async function readFileCapped(p: string, maxBytes: number): Promise<Buffer | null> {
    try {
        const st = await fs.stat(p);
        if (st.size > maxBytes) return null;
        return await fs.readFile(p);
    } catch {
        return Buffer.alloc(0);
    }
}

function snippet(s: string): string | null {
    if (!s) return null;
    return s.length > STORED_OUTPUT_SNIPPET_BYTES
        ? s.slice(0, STORED_OUTPUT_SNIPPET_BYTES) + "\n...(잘림)"
        : s;
}
