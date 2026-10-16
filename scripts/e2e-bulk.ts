import { requireApi } from "./preflight";
import { loadEnv } from "@ojik/core/env";
import { parseBulkProblems } from "@ojik/core";
import { sql } from "drizzle-orm";
import { createDb } from "@ojik/db";

/**
 * 묶음 올리기와 내려받기가 실제로 도는지 확인한다.
 *
 * 보는 것:
 *   1. JSON 하나로 문제 여러 개가 올라간다. 하나가 잘못돼도 나머지는 올라간다
 *   2. 내려받은 것을 그대로 되올릴 수 있다 (왕복)
 *   3. 테스트케이스 본문과 배점이 왕복에서 안 깨진다
 *   4. 남의 문제는 못 받는다
 *   5. 교재 마크다운이 왕복한다
 *
 * 4 가 핵심이다. 내려받기에는 기대 출력과 체커 소스가 통째로 들어 있어서, 권한이 새면
 * 그 문제의 답을 주는 것과 같다.
 *
 * API 가 떠 있어야 한다. 확인용 계정과 컬렉션을 지우므로 개발 DB 전용이다.
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
                (SELECT id FROM collections WHERE slug LIKE 'bulk-%')
        `);
        await h.db.execute(sql`DELETE FROM collections WHERE slug LIKE 'bulk-%'`);
        await h.db.execute(sql`DELETE FROM users WHERE handle LIKE 'bk\\_%'`);
    } finally {
        await h.close();
    }
}

/* 일부러 섞어 둔다. 2번은 title 이 없어서 떨어지고 나머지 둘은 올라가야 한다 */
const UPLOAD = JSON.stringify([
    {
        title: `묶음 A ${STAMP}`,
        statement: "두 수를 더하세요.",
        inputDesc: "A B",
        outputDesc: "A+B",
        timeLimitMs: 1500,
        memoryLimitMb: 128,
        stopOnFirstFail: false,
        testcases: [
            { input: "1 2\n", output: "3\n", isSample: true },
            { input: "5 7\n", output: "12\n", points: 40 },
        ],
    },
    { statement: "제목이 없다" },
    {
        title: `묶음 B ${STAMP}`,
        statement: "곱하세요.",
        timeLimitMs: 2000,
        memoryLimitMb: 256,
        checkerType: "float",
        floatEpsilon: 1e-3,
        testcases: [{ input: "2 3\n", output: "6.0\n" }],
    },
]);

async function main() {
    await requireApi();
    await cleanup();

    const admin = await login("admin@example.com", "admin1234");
    const outsider = await signup(`bk_out_${STAMP}`);

    const col = await req<{ collection: { id: number } }>(admin, "/collections", {
        method: "POST",
        body: JSON.stringify({ slug: `bulk-${STAMP}`, title: "묶음 확인", preset: "course" }),
    });
    const collectionId = col.body.collection.id;

    console.log("== 올리기 ==");
    const up = await req<{
        created: Array<{ id: number; title: string; testcases: number }>;
        errors: string[];
    }>(admin, "/problems/import", {
        method: "POST",
        body: JSON.stringify({ json: UPLOAD, ownerCollectionId: collectionId }),
    });

    ok("올리기가 200", up.status === 200, `${up.status} ${up.body.error ?? ""}`);
    ok("되는 것만 올라간다 (2개)", up.body.created?.length === 2, `${up.body.created?.length}`);
    ok("안 되는 것은 이유가 나온다", (up.body.errors ?? []).length === 1, JSON.stringify(up.body.errors));
    ok(
        "테스트케이스도 같이 올라간다",
        up.body.created?.[0]?.testcases === 2,
        `${up.body.created?.[0]?.testcases}`,
    );

    const ids = up.body.created.map((c) => c.id);

    console.log("== 내려받기 ==");
    const down = await req<{ json: string; count: number; skipped: Array<{ id: number; why: string }> }>(
        admin,
        `/problems/export?ids=${ids.join(",")}`,
    );
    ok("내려받기가 200", down.status === 200, `${down.status} ${down.body.error ?? ""}`);
    ok("고른 개수만큼 나온다", down.body.count === 2, `${down.body.count}`);
    ok("빠진 것이 없다", (down.body.skipped ?? []).length === 0, JSON.stringify(down.body.skipped));

    const back = parseBulkProblems(down.body.json);
    ok("받은 파일이 그대로 읽힌다", back.errors.length === 0, JSON.stringify(back.errors));

    const a = back.items.find((p) => p.title.startsWith("묶음 A"));
    ok("제한이 왕복한다", a?.timeLimitMs === 1500 && a?.memoryLimitMb === 128, JSON.stringify(a?.timeLimitMs));
    ok("부분점수 끄기가 왕복한다", a?.stopOnFirstFail === false, `${a?.stopOnFirstFail}`);
    ok("예제 표시가 왕복한다", a?.testcases?.[0]?.isSample === true, `${a?.testcases?.[0]?.isSample}`);
    ok("배점이 왕복한다", a?.testcases?.[1]?.points === 40, `${a?.testcases?.[1]?.points}`);
    ok(
        "테스트케이스 본문이 왕복한다",
        a?.testcases?.[0]?.input === "1 2\n" && a?.testcases?.[0]?.output === "3\n",
        JSON.stringify(a?.testcases?.[0]),
    );

    const b = back.items.find((p) => p.title.startsWith("묶음 B"));
    ok("실수 비교 설정이 왕복한다", b?.checkerType === "float" && b?.floatEpsilon === 1e-3, JSON.stringify(b?.floatEpsilon));

    console.log("== 되올리기 ==");
    const again = await req<{ created: Array<{ id: number }>; errors: string[] }>(admin, "/problems/import", {
        method: "POST",
        body: JSON.stringify({ json: down.body.json, ownerCollectionId: collectionId }),
    });
    ok("받은 파일을 그대로 되올릴 수 있다", again.body.created?.length === 2, JSON.stringify(again.body.errors));

    console.log("== 권한 ==");
    const stolen = await req<{ count: number; skipped: Array<{ id: number; why: string }> }>(
        outsider,
        `/problems/export?ids=${ids.join(",")}`,
    );
    ok("남의 문제는 안 나온다", stolen.body.count === 0, `${stolen.body.count}`);
    ok("왜 빠졌는지는 알려 준다", (stolen.body.skipped ?? []).length === 2, JSON.stringify(stolen.body.skipped));

    const anon = await fetch(`${BASE}/problems/export?ids=${ids[0]}`);
    ok("로그인 안 하면 막는다 (401)", anon.status === 401, `${anon.status}`);

    const none = await req(admin, "/problems/export?ids=");
    ok("번호가 없으면 막는다 (400)", none.status === 400, `${none.status}`);

    console.log("== 교재 ==");
    const md = [`# 1주차`, "", "설명 문단입니다.", "", `@problem ${ids[0]}`, "", "## 더", "", `@problem ${ids[1]}`].join(
        "\n",
    );
    const imp = await req<{ items: number; problems: number; errors: string[] }>(
        admin,
        `/collections/${collectionId}/import`,
        { method: "POST", body: JSON.stringify({ markdown: md }) },
    );
    ok("교재가 올라간다", imp.status === 200, `${imp.status} ${imp.body.error ?? ""}`);
    ok("문제 참조가 들어간다", imp.body.problems === 2, `${imp.body.problems}`);

    const exp = await req<{ markdown: string; items: number }>(admin, `/collections/${collectionId}/export`);
    ok("교재를 내려받는다", exp.status === 200, `${exp.status} ${exp.body.error ?? ""}`);
    ok(
        "문제 참조가 왕복한다",
        exp.body.markdown.includes(`@problem ${ids[0]}`) && exp.body.markdown.includes(`@problem ${ids[1]}`),
        exp.body.markdown,
    );
    ok("설명 문단이 왕복한다", exp.body.markdown.includes("설명 문단입니다."), exp.body.markdown);

    const reimp = await req<{ items: number; problems: number }>(admin, `/collections/${collectionId}/import`, {
        method: "POST",
        body: JSON.stringify({ markdown: exp.body.markdown }),
    });
    ok("받은 교재를 되올려도 항목 수가 같다", reimp.body.items === imp.body.items, `${reimp.body.items} vs ${imp.body.items}`);

    const mine = await req<{ markdown: string }>(outsider, `/collections/${collectionId}/export`);
    ok("남의 교재는 못 받는다 (403)", mine.status === 403, `${mine.status}`);

    await cleanup();

    console.log(`\n${pass} 통과, ${fail} 실패`);
    process.exit(fail === 0 ? 0 : 1);
}

void main();
