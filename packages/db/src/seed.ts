import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { createDb } from "./client";
import {
    users,
    userEmails,
    problems,
    testcases,
    tags,
    problemTags,
    collections,
    collectionItems,
    collectionMembers,
} from "./schema/index";
import { PRESET_DEFAULTS, type CollectionPreset, type Role } from "@ojik/core";
import { loadEnv } from "@ojik/core/env";

loadEnv();

/**
 * 개발용 초기 데이터. 빈 DB 에 넣는 걸 전제로 한다.
 * 이미 데이터가 있으면 아무것도 안 하고 끝낸다. 운영 DB 에 잘못 돌려도 덮어쓰지 않게.
 *
 * 컬렉션은 프리셋 네 가지를 하나씩 넣는다. 축 조합이 실제로 도는지 보는 표본이다.
 */

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

async function hash(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const h = await scrypt(plain, salt, 64);
    return `scrypt$${salt.toString("hex")}$${h.toString("hex")}`;
}

function requireEnv(key: string): string {
    const v = process.env[key];
    if (!v) {
        console.error(`${key} 가 없습니다. .env 를 확인하세요.`);
        process.exit(1);
    }
    return v;
}

// loadEnv 가 절대경로로 바꿔 놓는다. 여기서 cwd 를 걱정할 필요가 없다
const DATA_DIR = requireEnv("DATA_DIR");

async function writeTc(problemId: number, idx: number, input: string, output: string) {
    const dir = path.join(DATA_DIR, "problems", String(problemId), "tc");
    await fs.mkdir(dir, { recursive: true });
    const inBuf = Buffer.from(input.replace(/\r\n?/g, "\n"), "utf8");
    const outBuf = Buffer.from(output.replace(/\r\n?/g, "\n"), "utf8");
    await fs.writeFile(path.join(dir, `${idx}.in`), inBuf);
    await fs.writeFile(path.join(dir, `${idx}.out`), outBuf);
    return {
        inputSha256: createHash("sha256").update(inBuf).digest("hex"),
        inputBytes: inBuf.length,
        outputSha256: createHash("sha256").update(outBuf).digest("hex"),
        outputBytes: outBuf.length,
    };
}

const SEED_PROBLEMS = [
    {
        title: "A+B",
        statement: "두 정수 A와 B를 입력받은 다음, A+B를 출력하는 프로그램을 작성하시오.",
        inputDesc: "첫째 줄에 A와 B가 주어진다. ($0 < A, B < 10$)",
        outputDesc: "첫째 줄에 A+B를 출력한다.",
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        cases: [
            { in: "1 2\n", out: "3\n", sample: true },
            { in: "5 4\n", out: "9\n", sample: true },
            { in: "9 9\n", out: "18\n", sample: false },
            { in: "1 9\n", out: "10\n", sample: false },
        ],
    },
    {
        title: "N개의 합",
        statement: "N개의 정수가 주어질 때, 그 합을 출력하시오.",
        inputDesc: "첫째 줄에 N ($1 \\le N \\le 100000$), 둘째 줄에 N개의 정수가 주어진다.",
        outputDesc: "첫째 줄에 합을 출력한다.",
        timeLimitMs: 2000,
        memoryLimitMb: 256,
        cases: [
            { in: "3\n1 2 3\n", out: "6\n", sample: true },
            { in: "1\n-5\n", out: "-5\n", sample: false },
            { in: "5\n10 20 30 40 50\n", out: "150\n", sample: false },
        ],
    },
    {
        title: "무한 루프 잡기",
        statement:
            "시간 제한이 제대로 걸리는지 확인하는 문제다. 입력을 읽고 그대로 출력하면 된다.\n\n무한 루프를 제출하면 시간 초과가 나와야 한다.",
        inputDesc: "한 줄이 주어진다.",
        outputDesc: "입력을 그대로 출력한다.",
        timeLimitMs: 500,
        memoryLimitMb: 128,
        cases: [{ in: "hello\n", out: "hello\n", sample: true }],
    },
];

const SEED_TAGS = [
    { slug: "math", name: "수학" },
    { slug: "implementation", name: "구현" },
    { slug: "io", name: "입출력" },
];

async function main() {
    const h = createDb(requireEnv("DATABASE_URL"), { max: 1 });

    const [existing] = await h.db.select({ n: sql<number>`count(*)::int` }).from(users);
    if ((existing?.n ?? 0) > 0) {
        console.log("이미 데이터가 있습니다. 아무것도 하지 않습니다.");
        await h.close();
        return;
    }

    async function mkUser(handle: string, email: string, password: string, displayName: string, role: Role) {
        const [u] = await h.db
            .insert(users)
            .values({ handle, passwordHash: await hash(password), displayName, role })
            .returning();
        await h.db.insert(userEmails).values({ userId: u!.id, email, isPrimary: true });
        return u!;
    }

    const admin = await mkUser("admin", "admin@example.com", "admin1234", "관리자", "admin");
    const student = await mkUser("student", "student@example.com", "student1234", "학생", "user");

    const tagRows = await h.db.insert(tags).values(SEED_TAGS).returning();

    const problemIds: number[] = [];
    for (const p of SEED_PROBLEMS) {
        const { cases, ...fields } = p;
        const [row] = await h.db
            .insert(problems)
            .values({ ...fields, isPublic: true, createdBy: admin.id })
            .returning();
        problemIds.push(row!.id);

        const tcRows = [];
        for (let i = 0; i < cases.length; i++) {
            const cse = cases[i]!;
            const files = await writeTc(row!.id, i, cse.in, cse.out);
            tcRows.push({ problemId: row!.id, idx: i, isSample: cse.sample, points: 0, ...files });
        }
        await h.db.insert(testcases).values(tcRows);
        await h.db
            .insert(problemTags)
            .values({ problemId: row!.id, tagId: tagRows[0]!.id })
            .onConflictDoNothing();

        console.log(`문제 ${row!.id}: ${row!.title} (테스트케이스 ${tcRows.length}개)`);
    }

    // ---- 컬렉션: 프리셋 네 가지를 하나씩 ----
    const now = Date.now();

    async function mkCollection(
        preset: CollectionPreset,
        slug: string,
        title: string,
        description: string,
        extra: Record<string, unknown> = {},
    ) {
        const [c] = await h.db
            .insert(collections)
            .values({
                ...PRESET_DEFAULTS[preset],
                preset,
                slug,
                title,
                description,
                ownerId: admin.id,
                ...extra,
            })
            .returning();
        return c!;
    }

    const course = await mkCollection(
        "course",
        "basics",
        "입출력부터 시작하기",
        "처음 온라인 저지를 쓰는 사람을 위한 안내입니다.",
    );
    await h.db.insert(collectionItems).values([
        {
            collectionId: course.id,
            idx: 0,
            kind: "text",
            heading: "표준 입출력",
            body: "대부분의 문제는 **표준 입력**으로 받아 **표준 출력**으로 답합니다.\n\n파일을 열 필요가 없습니다. C라면 `scanf`, Python이라면 `input()`을 씁니다.",
        },
        { collectionId: course.id, idx: 1, kind: "problem", problemId: problemIds[0]! },
        {
            collectionId: course.id,
            idx: 2,
            kind: "text",
            heading: "반복 입력",
            body: "개수가 먼저 주어지고 그만큼 읽는 형태가 흔합니다.",
        },
        { collectionId: course.id, idx: 3, kind: "problem", problemId: problemIds[1]! },
    ]);

    const set = await mkCollection("problemset", "week-1", "1주차 실습", "기본 입출력 연습입니다.");
    await h.db
        .insert(collectionItems)
        .values(
            problemIds.map((pid, i) => ({
                collectionId: set.id,
                idx: i,
                kind: "problem" as const,
                problemId: pid,
            })),
        );
    await h.db.insert(collectionMembers).values({ collectionId: set.id, userId: student.id });

    const contest = await mkCollection("contest", "sample-contest", "샘플 대회", "축 조합 확인용입니다.", {
        startsAt: new Date(now - 60 * 60 * 1000),
        endsAt: new Date(now + 60 * 60 * 1000),
        freezeMinutes: 30,
    });
    await h.db.insert(collectionItems).values(
        problemIds.slice(0, 2).map((pid, i) => ({
            collectionId: contest.id,
            idx: i,
            kind: "problem" as const,
            problemId: pid,
        })),
    );
    await h.db.insert(collectionMembers).values({ collectionId: contest.id, userId: student.id });

    const exam = await mkCollection("exam", "sample-exam", "샘플 코딩 테스트", "시작을 누르면 60분이 흐릅니다.", {
        durationMinutes: 60,
    });
    await h.db.insert(collectionItems).values({
        collectionId: exam.id,
        idx: 0,
        kind: "problem",
        problemId: problemIds[0]!,
    });
    await h.db.insert(collectionMembers).values({ collectionId: exam.id, userId: student.id });

    console.log("\n컬렉션: 교재, 문제집, 대회, 코딩 테스트 각 1개");

    await h.close();
    console.log("\n계정 (로그인은 이메일로):");
    console.log("  admin@example.com   / admin1234   (관리자)");
    console.log("  student@example.com / student1234 (일반)");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
