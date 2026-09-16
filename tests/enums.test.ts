import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { loadEnv } from "@ojik/core/env";
import {
    LANGUAGE_IDS,
    VERDICTS,
    SUBMISSION_STATUSES,
    ROLES,
    CHECKER_TYPES,
    COLLECTION_PRESETS,
} from "@ojik/core";
import { type DbHandle } from "@ojik/db";
import { openTestDb } from "./dbsetup";

/**
 * core 의 상수와 DB 의 enum 이 같은지 본다.
 *
 * 있었던 사고라서 둔다. core 에 언어 4종을 늘리고 마이그레이션을 안 만들어, 새 언어로 제출하면
 * INSERT 가 깨지는 상태로 커밋됐다. smoke:judge 는 isolate 를 직접 불러서 DB 를 안 거치기 때문에
 * 전 언어 통과로 나왔다. 상수만 고치고 db:generate 를 잊으면 여기서 걸린다.
 *
 * DB 에만 있고 core 에 없는 값도 걸러야 한다. 그건 상수에서 뺐는데 마이그레이션을 안 만든 경우로,
 * 남은 값이 든 과거 행을 코드가 못 읽는다.
 */

loadEnv();

let h: DbHandle;

before(async () => {
    h = await openTestDb(2);
});

after(async () => {
    await h.close();
});

async function pgEnumValues(name: string): Promise<string[]> {
    const rows = await h.db.execute<{ label: string }>(sql`
        SELECT e.enumlabel AS label
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = ${name}
        ORDER BY e.enumsortorder
    `);
    return Array.from(rows as Iterable<{ label: string }>).map((r) => r.label);
}

/** 순서는 안 본다. ALTER TYPE ADD VALUE 의 위치가 상수 배열 순서와 꼭 같지는 않다 */
const cases: Array<[string, readonly string[]]> = [
    ["language", LANGUAGE_IDS],
    ["verdict", VERDICTS],
    ["submission_status", SUBMISSION_STATUSES],
    ["role", ROLES],
    ["checker_type", CHECKER_TYPES],
    ["collection_preset", COLLECTION_PRESETS],
];

for (const [typeName, constants] of cases) {
    test(`${typeName} enum 이 core 상수와 일치한다`, async () => {
        const inDb = await pgEnumValues(typeName);
        assert.ok(inDb.length > 0, `DB 에 ${typeName} 타입이 없습니다. 마이그레이션이 안 돌았습니다.`);

        const missing = constants.filter((c) => !inDb.includes(c));
        const extra = inDb.filter((d) => !constants.includes(d));

        assert.deepEqual(
            missing,
            [],
            `core 에는 있는데 DB 에 없습니다: ${missing.join(", ")}. npm run db:generate 를 잊었습니다.`,
        );
        assert.deepEqual(
            extra,
            [],
            `DB 에는 있는데 core 에 없습니다: ${extra.join(", ")}. 그 값이 든 과거 행을 못 읽습니다.`,
        );
    });
}

test("등록된 전 언어로 실제 캐스팅이 된다", async () => {
    // enum 목록 비교와 별개로, 값을 실제로 넣어 본다. 목록은 맞는데 타입이 다른 경우를 잡는다
    for (const id of LANGUAGE_IDS) {
        const rows = await h.db.execute<{ v: string }>(sql`SELECT ${id}::language AS v`);
        const [row] = Array.from(rows as Iterable<{ v: string }>);
        assert.equal(row?.v, id);
    }
});
