import { requireApi, requireWorker } from "./preflight";
import { loadEnv } from "@ojik/core/env";
import { LANGUAGES, VERDICT_LABEL, type Verdict } from "@ojik/core";
import { FIXTURES } from "./lang-fixtures";

/**
 * 등록된 전 언어를 API 로 실제 제출해 판정까지 본다.
 *
 * smoke:judge 와 겹쳐 보이지만 보는 곳이 다르다. smoke 는 isolate 를 직접 불러서 DB 를 안 거치고,
 * 이건 로그인부터 판정 조회까지 실제 경로를 그대로 탄다. core 에 언어를 늘리고 마이그레이션을
 * 안 만들어 INSERT 가 깨지던 걸 smoke 가 통과시킨 적이 있어서 만들었다.
 *
 * API 와 워커가 떠 있어야 한다.
 */
loadEnv();

const BASE = `http://localhost:${process.env.PORT ?? 3000}/api`;
const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "admin1234";

let cookie = "";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(BASE + path, {
        ...init,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...init?.headers },
    });
    const setCookie = r.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!;
    const text = await r.text();
    if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${r.status} ${text.slice(0, 200)}`);
    return text ? (JSON.parse(text) as T) : (undefined as T);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 판정이 끝날 때까지 기다린다. 컨테이너를 처음 띄우는 언어는 첫 제출이 느리다 */
async function waitVerdict(id: number, timeoutMs: number): Promise<Verdict | null> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        const r = await call<{ submission: { status: string; verdict: Verdict | null } }>(`/submissions/${id}`);
        if (r.submission.status === "done") return r.submission.verdict;
        if (r.submission.status === "error") return "internal_error";
        await sleep(400);
    }
    return null;
}

async function main() {
    await requireApi();
    await requireWorker();

    await call("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });

    // A+B 형태의 문제를 고른다. 시드의 첫 문제가 그렇다
    const list = await call<{ problems: Array<{ id: number; title: string }> }>("/problems?limit=1");
    const problem = list.problems[0];
    if (!problem) throw new Error("문제가 없습니다. npm run db:seed 를 먼저 돌리세요.");
    console.log(`문제 ${problem.id} "${problem.title}" 로 확인합니다.\n`);

    let pass = 0;
    let fail = 0;
    for (const lang of LANGUAGES) {
        const fx = FIXTURES[lang.id as keyof typeof FIXTURES];
        if (!fx) {
            console.log(`  [FAIL] ${lang.label}: 확인용 소스가 없습니다 (scripts/lang-fixtures.ts)`);
            fail++;
            continue;
        }
        const t0 = Date.now();
        try {
            const r = await call<{ submission: { id: number } }>("/submissions", {
                method: "POST",
                body: JSON.stringify({ problemId: problem.id, language: lang.id, sourceCode: fx.ok }),
            });
            const id = r.submission.id;
            const verdict = await waitVerdict(id, 120_000);
            const took = ((Date.now() - t0) / 1000).toFixed(1);
            if (verdict === "accepted") {
                console.log(`  [OK]   ${lang.label}: ${VERDICT_LABEL[verdict]} (${took}s)`);
                pass++;
            } else {
                const shown = verdict ? VERDICT_LABEL[verdict] : "시간 안에 안 끝남";
                console.log(`  [FAIL] ${lang.label}: ${shown} (${took}s, 제출 ${id})`);
                fail++;
            }
        } catch (e) {
            console.log(`  [FAIL] ${lang.label}: ${e instanceof Error ? e.message : String(e)}`);
            fail++;
        }
    }

    console.log("\n== 테스트케이스 유출 ==");
    if (await leakCheck(problem.id)) pass++;
    else fail++;

    console.log(`\n통과 ${pass}, 실패 ${fail}`);
    process.exit(fail === 0 ? 0 : 1);
}

/**
 * 숨은 케이스에서 입력을 그대로 뱉고 일부러 틀리는 코드를 넣어 본다.
 *
 * 한때 실제로 샜다. 채점기가 케이스마다 stdout/stderr 을 저장했고 제출자가 그걸 볼 수 있어서,
 * print(input()) 으로 한 제출에 케이스 하나씩 뽑을 수 있었다. 공개 예제는 그대로 보여야 하므로
 * "아무것도 안 보여 주기" 로 막으면 안 된다. 그래서 여기서 둘 다 본다.
 */
async function leakCheck(problemId: number): Promise<boolean> {
    const d = await call<{
        samples: Array<{ idx: number; input: string }>;
        testcaseCount: number;
    }>(`/problems/${problemId}`);

    const sampleIdx = new Set(d.samples.map((t) => t.idx));
    if (d.samples.length === 0 || d.testcaseCount <= d.samples.length) {
        console.log("  [SKIP] 공개 예제와 숨은 케이스가 모두 있어야 확인할 수 있습니다");
        return true;
    }

    // 공개 예제는 정답을 내고, 그 외에는 읽은 입력을 뱉으며 틀린다
    const okInputs = d.samples.map((t) => t.input.trim().split(/\s+/).map(Number));
    const src =
        [
            "import sys",
            `SAMPLES = ${JSON.stringify(okInputs)}`,
            "vals = list(map(int, sys.stdin.read().split()))",
            "if vals in SAMPLES:",
            "    print(sum(vals))",
            "else:",
            '    print("LEAK", *vals)',
            '    print("LEAK", *vals, file=sys.stderr)',
        ].join("\n") + "\n";

    const r = await call<{ submission: { id: number } }>("/submissions", {
        method: "POST",
        body: JSON.stringify({ problemId, language: "python3", sourceCode: src }),
    });
    const verdict = await waitVerdict(r.submission.id, 120_000);
    if (verdict !== "wrong_answer") {
        console.log(`  [SKIP] 숨은 케이스에서 틀리게 만들지 못했습니다 (${verdict ?? "안 끝남"})`);
        return true;
    }

    const s = await call<{
        submission: { failedIdx: number | null; failedStdout: string | null; failedStderr: string | null };
    }>(`/submissions/${r.submission.id}`);

    const idx = s.submission.failedIdx;
    if (idx === null || sampleIdx.has(idx)) {
        console.log(`  [SKIP] 공개 예제에서 먼저 틀렸습니다 (idx ${idx})`);
        return true;
    }

    const shown = `${s.submission.failedStdout ?? ""}${s.submission.failedStderr ?? ""}`;
    if (shown.includes("LEAK")) {
        console.log(`  [FAIL] 숨은 케이스 ${idx} 의 입력이 제출자에게 보입니다: ${shown.trim()}`);
        return false;
    }
    console.log(`  [OK]   숨은 케이스 ${idx} 의 출력이 제출자에게 안 보임`);
    return true;
}

void main();
