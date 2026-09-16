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

    console.log(`\n통과 ${pass}, 실패 ${fail}`);
    process.exit(fail === 0 ? 0 : 1);
}

void main();
