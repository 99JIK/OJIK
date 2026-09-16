import { loadEnv } from "@ojik/core/env";
import { sql } from "drizzle-orm";
import { createDb } from "@ojik/db";

/**
 * 강사 권한이 실제로 맞물리는지 확인한다.
 *
 * 보는 것:
 *   1. 일반 사용자는 강의를 못 연다
 *   2. 강사는 강의를 열고, 자기 강의에만 문제를 낸다
 *   3. 강사가 낸 문제는 공개 아카이브 목록에 안 나온다
 *   4. 남의 강의는 못 고친다
 *   5. 수강생 명단을 넣고, 보고, 한 명 빼는 것까지 된다
 *
 * 권한은 라우트마다 따로 붙는 것이라, 한 군데 빠뜨려도 나머지가 멀쩡해 보인다.
 * 그래서 규칙 단위가 아니라 라우트 단위로 훑는다.
 *
 * API 가 떠 있어야 한다. 테스트 계정과 거기 딸린 강의를 지우므로 개발 DB 전용이다.
 */
loadEnv();

const BASE = `http://localhost:${process.env.PORT ?? 3000}/api`;
/** 핸들은 20자까지라 타임스탬프를 36진수로 줄여 쓴다 */
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

/** 확인용 계정을 새로 만든다. 기존 계정의 권한을 건드리지 않으려는 것 */
async function signup(handle: string): Promise<Session> {
    const r = await fetch(`${BASE}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            handle,
            email: `${handle}@example.com`,
            password: "test12345678",
        }),
    });
    if (!r.ok) throw new Error(`가입 실패 ${handle}: ${r.status} ${await r.text()}`);
    const sc = r.headers.get("set-cookie");
    if (!sc) throw new Error("쿠키를 못 받았습니다");
    return { cookie: sc.split(";")[0]!, handle };
}

async function login(email: string, password: string): Promise<Session> {
    const r = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(`로그인 실패 ${email}: ${r.status}`);
    return { cookie: r.headers.get("set-cookie")!.split(";")[0]!, handle: "admin" };
}

/** 확인용 계정을 권한만 바꿔 준다. set-role 과 같은 일을 API 없이 한다 */
async function setRole(handle: string, role: string): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 이 없습니다.");
    const h = createDb(url, { max: 1 });
    try {
        await h.db.execute(sql`UPDATE users SET role = ${role}::role WHERE lower(handle) = ${handle.toLowerCase()}`);
    } finally {
        await h.close();
    }
}

/** 지난 실행이 남긴 확인용 계정과 그 강의를 지운다 */
async function cleanup(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 이 없습니다.");
    const h = createDb(url, { max: 1 });
    try {
        // 컬렉션을 지우면 딸린 강의 전용 문제가 FK cascade 로 따라 지워진다
        await h.db.execute(sql`
            DELETE FROM collections WHERE owner_id IN
                (SELECT id FROM users WHERE handle LIKE 'e2e\_%')
        `);
        await h.db.execute(sql`DELETE FROM users WHERE handle LIKE 'e2e\_%'`);
    } finally {
        await h.close();
    }
}

const PROBLEM = {
    title: "확인용 과제",
    statement: "A+B",
    inputDesc: "두 수",
    outputDesc: "합",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
};

async function main() {
    await cleanup();

    const admin = await login("admin@example.com", "admin1234");
    const plain = await signup(`e2e_p_${STAMP}`);
    const teacher = await signup(`e2e_t_${STAMP}`);
    const other = await signup(`e2e_o_${STAMP}`);
    const student = await signup(`e2e_s_${STAMP}`);

    console.log("== 일반 사용자 ==");
    {
        const r = await req(plain, "/collections", {
            method: "POST",
            body: JSON.stringify({ slug: `e2e_p_${STAMP}`, title: "열면 안 되는 강의", preset: "course" }),
        });
        ok("강의를 못 연다 (403)", r.status === 403, `${r.status}`);
    }

    await setRole(teacher.handle, "instructor");
    await setRole(other.handle, "instructor");

    console.log("\n== 강사 ==");
    let collectionId = 0;
    {
        const r = await req<{ collection: { id: number } }>(teacher, "/collections", {
            method: "POST",
            body: JSON.stringify({ slug: `e2e-course-${STAMP}`, title: "확인용 강의", preset: "course" }),
        });
        ok("강의를 연다 (201)", r.status === 201, `${r.status} ${r.body.error ?? ""}`);
        collectionId = r.body.collection?.id ?? 0;
        if (!collectionId) {
            console.log("\n강의를 못 만들어서 나머지를 못 봅니다.");
            process.exit(1);
        }

        const own = await req(teacher, `/collections/${collectionId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: "고친 제목" }),
        });
        ok("자기 강의를 고친다 (200)", own.status === 200, `${own.status} ${own.body.error ?? ""}`);

        const arch = await req(teacher, "/problems", {
            method: "POST",
            body: JSON.stringify({ ...PROBLEM, ownerCollectionId: null }),
        });
        ok("공개 아카이브에는 못 낸다 (403)", arch.status === 403, `${arch.status}`);
    }

    console.log("\n== 강의 전용 문제 ==");
    let problemId = 0;
    {
        const r = await req<{ problem: { id: number } }>(teacher, "/problems", {
            method: "POST",
            body: JSON.stringify({ ...PROBLEM, ownerCollectionId: collectionId }),
        });
        ok("자기 강의에 문제를 낸다 (201)", r.status === 201, `${r.status} ${r.body.error ?? ""}`);
        problemId = r.body.problem?.id ?? 0;

        const pub = await req<{ problems: Array<{ id: number }> }>(null, "/problems?limit=100");
        ok(
            "공개 아카이브 목록에 안 나온다",
            !(pub.body.problems ?? []).some((p) => p.id === problemId),
        );

        const asAdmin = await req<{ problems: Array<{ id: number }> }>(admin, "/problems?limit=100");
        ok(
            "관리자 목록에도 안 나온다",
            !(asAdmin.body.problems ?? []).some((p) => p.id === problemId),
        );

        const mine = await req<{ problems: Array<{ id: number }> }>(
            teacher,
            `/problems?collectionId=${collectionId}`,
        );
        ok("강의 문제 목록에는 나온다", (mine.body.problems ?? []).some((p) => p.id === problemId));

        const move = await req(teacher, `/problems/${problemId}`, {
            method: "PATCH",
            body: JSON.stringify({ ownerCollectionId: null }),
        });
        ok("아카이브로 못 옮긴다 (403)", move.status === 403, `${move.status}`);
    }

    console.log("\n== 남의 강의 ==");
    {
        const r = await req(other, `/collections/${collectionId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: "뺏기" }),
        });
        ok("남의 강의를 못 고친다 (403)", r.status === 403, `${r.status}`);

        const p = await req(other, `/problems/${problemId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: "뺏기" }),
        });
        ok("남의 강의 문제를 못 고친다 (403)", p.status === 403, `${p.status}`);

        const tc = await req(other, `/problems/${problemId}/testcases`);
        ok("남의 강의 문제의 테스트케이스를 못 본다 (403)", tc.status === 403, `${tc.status}`);

        const list = await req(other, `/problems?collectionId=${collectionId}`);
        ok("남의 강의 문제 목록을 못 본다 (403)", list.status === 403, `${list.status}`);
    }

    console.log("\n== 수강생 관리 ==");
    {
        const put = await req<{ added: number; missing: string[] }>(
            teacher,
            `/collections/${collectionId}/members`,
            {
                method: "PUT",
                body: JSON.stringify({ handles: [student.handle, "없는핸들"], role: "member" }),
            },
        );
        ok("명단을 넣는다 (200)", put.status === 200, `${put.status}`);
        ok("등록된 사람은 1명", put.body.added === 1, `${put.body.added}`);
        ok("없는 핸들을 돌려준다", (put.body.missing ?? []).includes("없는핸들"));

        const get = await req<{ members: Array<{ handle: string; role: string }>; problemCount: number }>(
            teacher,
            `/collections/${collectionId}/members`,
        );
        ok("명단을 본다 (200)", get.status === 200, `${get.status}`);
        ok(
            "넣은 사람이 보인다",
            (get.body.members ?? []).some((m) => m.handle === student.handle),
        );

        const byStudent = await req(student, `/collections/${collectionId}/members`);
        ok("수강생은 명단을 못 본다 (403)", byStudent.status === 403, `${byStudent.status}`);

        // 수강생을 조교로 올리면 강의를 고칠 수 있어야 한다
        const sid = (get.body.members ?? []).find((m) => m.handle === student.handle) as
            | { userId: number }
            | undefined;
        if (sid) {
            const up = await req(teacher, `/collections/${collectionId}/members/${sid.userId}`, {
                method: "PATCH",
                body: JSON.stringify({ role: "manager" }),
            });
            ok("수강생을 조교로 올린다 (200)", up.status === 200, `${up.status}`);

            const edit = await req(student, `/collections/${collectionId}`, {
                method: "PATCH",
                body: JSON.stringify({ title: "조교가 고침" }),
            });
            ok("조교가 강의를 고친다 (200)", edit.status === 200, `${edit.status} ${edit.body.error ?? ""}`);

            const rm = await req(teacher, `/collections/${collectionId}/members/${sid.userId}`, {
                method: "DELETE",
            });
            ok("한 명만 뺀다 (200)", rm.status === 200, `${rm.status}`);

            const after = await req<{ members: Array<{ handle: string }> }>(
                teacher,
                `/collections/${collectionId}/members`,
            );
            ok("뺀 사람은 명단에 없다", !(after.body.members ?? []).some((m) => m.handle === student.handle));
        }
    }

    await cleanup();
    console.log(`\n통과 ${pass}, 실패 ${fail}`);
    process.exit(fail === 0 ? 0 : 1);
}

void main();
