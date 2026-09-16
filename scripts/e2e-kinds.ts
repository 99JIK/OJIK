import { requireApi, requireWorker } from "./preflight";
import { loadEnv } from "@ojik/core/env";
import { sql } from "drizzle-orm";
import { createDb } from "@ojik/db";

/**
 * 단답형과 빈칸 문제가 실제로 도는지 확인한다.
 *
 * 보는 것:
 *   1. 단답형은 큐를 안 타고 바로 채점된다. 부분 점수가 문항 배점대로 나온다
 *   2. 단답형 기댓값이 문제 상세에 안 나온다
 *   3. 빈칸은 채운 줄이 원본에 끼워져 실제로 컴파일되고 돌아간다
 *   4. 빈칸 원본이 학생에게 안 나간다
 *
 * 2 와 4 가 핵심이다. 답이 새면 문제를 낼 이유가 없다.
 *
 * API 와 워커가 떠 있어야 한다. 확인용 계정과 컬렉션을 지우므로 개발 DB 전용이다.
 */
loadEnv();

const BASE = `http://localhost:${process.env.PORT ?? 3000}/api`;
const STAMP = Date.now().toString(36);

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = "") {
    if (cond) {
        console.log(`  [OK]   ${name}`);
        pass++;
    } else {
        console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ""}`);
        fail++;
    }
}

interface Session {
    cookie: string;
    handle: string;
}

async function req<T>(
    s: Session | null,
    path: string,
    init?: RequestInit,
): Promise<{ status: number; body: T & { error?: string } }> {
    const r = await fetch(BASE + path, {
        ...init,
        headers: {
            "content-type": "application/json",
            ...(s ? { cookie: s.cookie } : {}),
            ...init?.headers,
        },
    });
    const t = await r.text();
    return { status: r.status, body: (t ? JSON.parse(t) : {}) as T & { error?: string } };
}

async function login(email: string, password: string): Promise<Session> {
    const r = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(`로그인 실패 ${email}: ${r.status}`);
    return { cookie: r.headers.get("set-cookie")!.split(";")[0]!, handle: email };
}

async function signup(handle: string): Promise<Session> {
    const r = await fetch(`${BASE}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, email: `${handle}@example.com`, password: "test12345678" }),
    });
    if (!r.ok) throw new Error(`가입 실패 ${handle}: ${r.status} ${await r.text()}`);
    return { cookie: r.headers.get("set-cookie")!.split(";")[0]!, handle };
}

async function cleanup(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 이 없습니다.");
    const h = createDb(url, { max: 1 });
    try {
        await h.db.execute(sql`
            DELETE FROM problems WHERE owner_collection_id IN
                (SELECT id FROM collections WHERE slug LIKE 'kind-%')
        `);
        await h.db.execute(sql`DELETE FROM collections WHERE slug LIKE 'kind-%'`);
        await h.db.execute(sql`DELETE FROM users WHERE handle LIKE 'kd\\_%'`);
    } finally {
        await h.close();
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitJudged(s: Session, id: number): Promise<string | null> {
    for (let i = 0; i < 150; i++) {
        const r = await req<{ submission: { status: string; verdict: string | null } }>(s, `/submissions/${id}`);
        const sub = r.body.submission;
        if (sub.status === "done") return sub.verdict;
        if (sub.status === "error") return "internal_error";
        await sleep(400);
    }
    return null;
}

const BASE_PROBLEM = {
    statement: "확인용",
    inputDesc: "",
    outputDesc: "",
    timeLimitMs: 2000,
    memoryLimitMb: 256,
};

async function main() {
    await requireApi();
    await requireWorker();

    await cleanup();

    const admin = await login("admin@example.com", "admin1234");
    const student = await signup(`kd_s_${STAMP}`);

    // 강의 하나를 만들고 학생을 넣는다. 강의 전용 문제로 만들어야 아카이브를 안 더럽힌다
    const col = await req<{ collection: { id: number } }>(admin, "/collections", {
        method: "POST",
        body: JSON.stringify({ slug: `kind-${STAMP}`, title: "유형 확인", preset: "course" }),
    });
    const collectionId = col.body.collection.id;
    await req(admin, `/collections/${collectionId}/members`, {
        method: "PUT",
        body: JSON.stringify({ handles: [student.handle], role: "member" }),
    });

    console.log("== 단답형 ==");
    {
        const made = await req<{ problem: { id: number } }>(admin, "/problems", {
            method: "POST",
            body: JSON.stringify({
                ...BASE_PROBLEM,
                title: "개념 확인",
                kind: "answer",
                checkerType: "trim",
                ownerCollectionId: collectionId,
            }),
        });
        ok("단답형 문제를 만든다 (201)", made.status === 201, `${made.status} ${made.body.error ?? ""}`);
        const pid = made.body.problem.id;

        // 문항은 테스트케이스로 넣는다. input 이 지문, output 이 기대 답
        const tc = await req(admin, `/problems/${pid}/testcases`, {
            method: "PUT",
            body: JSON.stringify({
                testcases: [
                    { input: "퀵 정렬의 평균 시간 복잡도는?", output: "O(n log n)", isSample: false, points: 40 },
                    { input: "LIFO 로 동작하는 자료구조는?", output: "스택", isSample: false, points: 60 },
                ],
            }),
        });
        ok("문항을 넣는다 (200)", tc.status === 200, `${tc.status} ${tc.body.error ?? ""}`);

        // 학생이 보는 화면에 기댓값이 없어야 한다
        const view = await req<{
            problem: Record<string, unknown>;
            samples: unknown[];
            answerItems: Array<{ idx: number; points: number; prompt: string }>;
        }>(student, `/problems/${pid}`);
        ok("문항 지문이 보인다", (view.body.answerItems ?? []).length === 2, `${view.body.answerItems?.length}`);
        ok("배점이 보인다", view.body.answerItems?.[0]?.points === 40, `${view.body.answerItems?.[0]?.points}`);

        const raw = JSON.stringify(view.body);
        ok("기대 답이 안 나간다", !raw.includes("O(n log n)") && !raw.includes("스택"), "응답에 답이 들어 있음");
        ok("예제 목록은 비어 있다", (view.body.samples ?? []).length === 0);

        // 하나만 맞히면 부분 점수
        const half = await req<{ submission: { id: number; status: string; verdict: string } }>(
            student,
            "/submissions",
            {
                method: "POST",
                body: JSON.stringify({ problemId: pid, answers: { 0: " O(n log n) ", 1: "큐" } }),
            },
        );
        ok("큐를 안 타고 바로 끝난다", half.body.submission.status === "done", half.body.submission.status);
        ok("하나 틀리면 오답", half.body.submission.verdict === "wrong_answer", half.body.submission.verdict);

        const detail = await req<{ submission: { score: number; failedIdx: number | null } }>(
            student,
            `/submissions/${half.body.submission.id}`,
        );
        ok("맞힌 문항 배점만 받는다", detail.body.submission.score === 40, `${detail.body.submission.score}`);
        ok("틀린 문항 번호가 나온다", detail.body.submission.failedIdx === 1, `${detail.body.submission.failedIdx}`);

        const full = await req<{ submission: { verdict: string } }>(student, "/submissions", {
            method: "POST",
            body: JSON.stringify({ problemId: pid, answers: { 0: "O(n log n)", 1: "스택" } }),
        });
        ok("전부 맞히면 정답", full.body.submission.verdict === "accepted", full.body.submission.verdict);

        const empty = await req(student, "/submissions", {
            method: "POST",
            body: JSON.stringify({ problemId: pid, answers: {} }),
        });
        ok("빈 답은 막는다 (400)", empty.status === 400, `${empty.status}`);
    }

    console.log("\n== 출제자 ==");
    {
        // 문제에 문제가 있을 때 누구에게 말할지가 분명해야 한다
        const list = await req<{ problems: Array<{ id: number; authorHandle: string | null }> }>(
            student,
            "/problems?limit=5",
        );
        ok("목록에 출제자가 있다", (list.body.problems ?? []).every((p) => "authorHandle" in p));

        const first = (list.body.problems ?? [])[0];
        if (first) {
            const d = await req<{ author: { handle: string } | null }>(student, `/problems/${first.id}`);
            ok("상세의 출제자가 목록과 같다", d.body.author?.handle === first.authorHandle,
                `${d.body.author?.handle} vs ${first.authorHandle}`);
        }
    }

    console.log("\n== 빈칸 채우기 ==");
    {
        const template = ["#include <stdio.h>", "int main(void){", "    int a,b;", "    BLANK", "    return 0;", "}"].join(
            "\n",
        );

        const made = await req<{ problem: { id: number } }>(admin, "/problems", {
            method: "POST",
            body: JSON.stringify({
                ...BASE_PROBLEM,
                title: "빈칸 확인",
                kind: "blank",
                blankTemplate: template,
                blankLines: [4],
                blankLanguage: "c",
                ownerCollectionId: collectionId,
            }),
        });
        ok("빈칸 문제를 만든다 (201)", made.status === 201, `${made.status} ${made.body.error ?? ""}`);
        const pid = made.body.problem.id;

        await req(admin, `/problems/${pid}/testcases`, {
            method: "PUT",
            body: JSON.stringify({
                testcases: [{ input: "3 4\n", output: "7\n", isSample: true, points: 100 }],
            }),
        });

        const view = await req<{
            problem: Record<string, unknown>;
            blank: { lines: string[]; blankLines: number[]; language: string } | null;
        }>(student, `/problems/${pid}`);
        ok("골격이 내려온다", !!view.body.blank, "blank 가 null");
        ok("비운 줄이 비어 있다", view.body.blank?.lines[3] === "", `"${view.body.blank?.lines[3]}"`);
        ok("나머지 줄은 그대로다", view.body.blank?.lines[1] === "int main(void){", view.body.blank?.lines[1]);
        ok("채점 언어가 정해져 있다", view.body.blank?.language === "c", `${view.body.blank?.language}`);
        ok("원본이 안 나간다", !JSON.stringify(view.body).includes("BLANK"), "응답에 원본 표시가 들어 있음");

        const good = await req<{ submission: { id: number } }>(student, "/submissions", {
            method: "POST",
            body: JSON.stringify({
                problemId: pid,
                blanks: { 4: '    if (scanf("%d %d", &a, &b) == 2) printf("%d\\n", a + b);' },
            }),
        });
        ok("빈칸 제출을 받는다 (201)", good.status === 201, `${good.status} ${good.body.error ?? ""}`);

        const verdict = await waitJudged(student, good.body.submission.id);
        ok("채운 줄이 끼워져 정답이 된다", verdict === "accepted", `${verdict}`);

        const bad = await req<{ submission: { id: number } }>(student, "/submissions", {
            method: "POST",
            body: JSON.stringify({ problemId: pid, blanks: {} }),
        });
        const badVerdict = await waitJudged(student, bad.body.submission.id);
        /*
         * 안 채우면 통과하면 안 된다. 어떤 판정인지는 원본에 달렸다.
         * 이 골격은 빈 줄로 둬도 컴파일이 되고 출력만 안 나와서 오답이 된다.
         * 빈 줄이 문법을 깨는 골격이면 컴파일 에러다. 둘 다 맞는 결과다.
         */
        ok("안 채우면 통과하지 못한다", badVerdict !== "accepted", `${badVerdict}`);

        const noTemplate = await req(admin, "/problems", {
            method: "POST",
            body: JSON.stringify({
                ...BASE_PROBLEM,
                title: "원본 없는 빈칸",
                kind: "blank",
                ownerCollectionId: collectionId,
            }),
        });
        ok("원본 없이 빈칸 문제를 못 만든다 (400)", noTemplate.status === 400, `${noTemplate.status}`);
    }

    await cleanup();
    console.log(`\n통과 ${pass}, 실패 ${fail}`);
    process.exit(fail === 0 ? 0 : 1);
}

void main();
