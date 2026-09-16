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

/**
 * 다른 사람이 이 문제를 맞힌 기록을 만든다.
 *
 * 채점을 거치지 않고 행을 직접 넣는다. 강의 전용 문제에는 테스트케이스가 없어서 실제로
 * 풀게 할 수가 없고, 여기서 보려는 건 채점이 아니라 진도가 남의 기록을 세지 않는지다.
 *
 * 이게 없으면 그 문제를 푼 사람이 아무도 없어서, 진도가 본인 것만 세든 전부를 세든
 * 똑같이 0 이 나온다. 구분을 못 하는 검사는 통과해도 아무것도 안 알려 준다.
 */
async function fakeAccepted(handle: string, problemId: number): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 이 없습니다.");
    const h = createDb(url, { max: 1 });
    try {
        await h.db.execute(sql`
            INSERT INTO submissions (problem_id, user_id, language, source_code, source_bytes, status, verdict)
            SELECT ${problemId}, u.id, 'python3', 'x', 1, 'done', 'accepted'
            FROM users u WHERE lower(u.handle) = ${handle.toLowerCase()}
        `);
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

/** 업로드는 multipart 라 JSON 을 보내는 req 를 못 쓴다 */
async function post(s: Session | null, file: File): Promise<{ status: number; body: unknown }> {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`${BASE}/uploads`, {
        method: "POST",
        headers: s ? { cookie: s.cookie } : {},
        body: form,
    });
    const t = await r.text();
    return { status: r.status, body: t ? JSON.parse(t) : {} };
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

    console.log("\n== 강의에 담기 ==");
    {
        // 강사가 만든 문제를 자기 강의 항목으로 넣는다. 화면이 하는 일과 같은 순서다
        const put = await req(teacher, `/collections/${collectionId}/items`, {
            method: "PUT",
            body: JSON.stringify({ items: [{ kind: "problem", problemId, points: 100 }] }),
        });
        ok("강의 항목에 담는다 (200)", put.status === 200, `${put.status} ${put.body.error ?? ""}`);

        const detail = await req<{ items: Array<{ problemId: number | null }> }>(
            teacher,
            `/collections/e2e-course-${STAMP}`,
        );
        ok(
            "강의 상세에 문제가 보인다",
            (detail.body.items ?? []).some((i) => i.problemId === problemId),
        );

        // 수강생은 강의에 속해야 강의 전용 문제를 본다
        const before = await req(student, `/problems/${problemId}`);
        ok("명단에 없으면 문제를 못 본다 (404)", before.status === 404, `${before.status}`);

        await req(teacher, `/collections/${collectionId}/members`, {
            method: "PUT",
            body: JSON.stringify({ handles: [student.handle], role: "member" }),
        });
        const after = await req(student, `/problems/${problemId}`);
        ok("수강생이 되면 문제를 본다 (200)", after.status === 200, `${after.status}`);
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

        // 목록의 개수도 값으로 본다. 상태 코드만 보면 0 이 나와도 통과한다
        const mineList = await req<{ collections: Array<{ id: number; problemCount: number; memberCount: number }> }>(
            teacher,
            "/collections?mine=true",
        );
        const row = (mineList.body.collections ?? []).find((c) => c.id === collectionId);
        ok("내 목록에 뜬다", !!row);
        ok("목록의 문제 수가 맞다", row?.problemCount === 1, `${row?.problemCount}`);
        ok("목록의 인원이 맞다", row?.memberCount === 1, `${row?.memberCount}`);
    }

    console.log("\n== 그림 올리기 ==");
    {
        const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
        );

        const anon = await post(null, new File([png], "a.png", { type: "image/png" }));
        ok("비로그인은 못 올린다 (401)", anon.status === 401, `${anon.status}`);

        const plainTry = await post(plain, new File([png], "a.png", { type: "image/png" }));
        ok("일반 사용자는 못 올린다 (403)", plainTry.status === 403, `${plainTry.status}`);

        const good = await post(teacher, new File([png], "a.png", { type: "image/png" }));
        ok("강사는 올린다 (201)", good.status === 201, `${good.status}`);

        // 브라우저가 보내는 Content-Type 은 확장자에서 추측한 값이라 믿을 수 없다.
        // 내용이 png 가 아닌데 png 라고 하면 걸러야 한다
        const fake = new File([Buffer.from("<script>alert(1)</script>")], "a.png", { type: "image/png" });
        const bad = await post(teacher, fake);
        ok("내용이 형식과 다르면 막는다 (415)", bad.status === 415, `${bad.status}`);

        const svg = new File([Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")], "a.svg", {
            type: "image/svg+xml",
        });
        const svgTry = await post(teacher, svg);
        ok("svg 는 안 받는다 (415)", svgTry.status === 415, `${svgTry.status}`);

        const url = (good.body as { url?: string }).url ?? "";
        const fetched = await fetch(`http://localhost:${process.env.PORT ?? 3000}${url}`);
        ok("올린 그림을 로그인 없이 받는다 (200)", fetched.status === 200, `${fetched.status}`);
        ok("content-type 이 png", fetched.headers.get("content-type") === "image/png");

        // 이름 모양이 아니면 파일을 안 찾는다. 경로 조작이 여기서 끝난다
        for (const bad of ["../../.env", "abc.png", `${url.split("/").pop()}.txt`]) {
            const r = await fetch(
                `http://localhost:${process.env.PORT ?? 3000}/api/uploads/${encodeURIComponent(bad)}`,
            );
            ok(`이상한 이름은 404 (${bad})`, r.status === 404, `${r.status}`);
        }
    }

    // 진도 검사가 구분을 하려면 남이 푼 기록이 먼저 있어야 한다.
    // 아무도 안 푼 상태면 본인 것만 세든 전부를 세든 똑같이 0 이다
    await fakeAccepted(other.handle, problemId);

    console.log("\n== 수강생 관리 ==");
    {
        const put = await req<{ added: number; missing: string[] }>(
            teacher,
            `/collections/${collectionId}/members`,
            {
                method: "PUT",
                body: JSON.stringify({
                    handles: [student.handle, "없는핸들"],
                    role: "member",
                    // 위에서 이미 넣었으므로 갈아끼운다. 안 그러면 added 가 0 이다
                    replace: true,
                }),
            },
        );
        ok("명단을 넣는다 (200)", put.status === 200, `${put.status}`);
        ok("등록된 사람은 1명", put.body.added === 1, `${put.body.added}`);
        ok("없는 핸들을 돌려준다", (put.body.missing ?? []).includes("없는핸들"));

        const get = await req<{
            members: Array<{ handle: string; role: string; userId: number; solvedHere: number }>;
            problemCount: number;
        }>(teacher, `/collections/${collectionId}/members`);
        ok("명단을 본다 (200)", get.status === 200, `${get.status}`);
        ok(
            "넣은 사람이 보인다",
            (get.body.members ?? []).some((m) => m.handle === student.handle),
        );

        /*
         * 진도가 본인 것만 세는지.
         *
         * 값이 아니라 상태 코드만 보다가 한 번 놓쳤다. 상관 서브쿼리에서 바깥 컬럼을
         * drizzle 보간으로 쓰면 "user_id" 만 나가는데, 서브쿼리의 submissions 에도 같은
         * 이름이 있어서 조건이 늘 참이 됐다. 모든 사람의 정답 수를 세고 있었다.
         *
         * 이 강의 문제는 방금 만든 것이라 아무도 안 풀었다. 그러니 0 이어야 한다.
         */
        const mine = (get.body.members ?? []).find((m) => m.handle === student.handle);
        ok("진도가 본인 것만 센다", mine?.solvedHere === 0, `${mine?.solvedHere}`);
        ok("문제 수가 맞다", get.body.problemCount === 1, `${get.body.problemCount}`);

        // 본인이 풀면 오른다
        await fakeAccepted(student.handle, problemId);
        const after = await req<{ members: Array<{ handle: string; solvedHere: number }> }>(
            teacher,
            `/collections/${collectionId}/members`,
        );
        const mine2 = (after.body.members ?? []).find((m) => m.handle === student.handle);
        ok("본인이 풀면 진도가 오른다", mine2?.solvedHere === 1, `${mine2?.solvedHere}`);

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
