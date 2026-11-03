import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "@ojik/db";
import { testDatabaseUrl } from "../scripts/testdburl";

/**
 * DB 를 쓰는 테스트의 공통 준비.
 *
 * 붙는 것과 워커가 없는 것을 확인한다. 둘 다 안 보고 바로 질의하면 실패가 스택 트레이스로
 * 나오는데, 테스트 하나당 한 번씩 나오므로 화면이 ECONNREFUSED 로 뒤덮인다. 실제로
 * 그랬고, 원인이 "DB 를 안 띄웠다" 라는 걸 알아보기 어려웠다.
 */

export async function openTestDb(max: number): Promise<DbHandle> {
    /*
     * 개발 DB 가 아니라 테스트 DB 를 쓴다.
     *
     * 같은 DB 를 쓰면 워커가 테스트가 만든 큐 행을 집어 간다. 그래서 테스트마다 워커를
     * 멈췄다 켜야 했다. 나눠 두면 워커를 켜 둔 채로 돌릴 수 있다.
     *
     * 테스트는 submissions 를 비우므로 개발 DB 를 가리키는 일이 절대 없어야 한다.
     * 주소를 한 곳에서만 정하고 scripts 도 같은 함수를 본다.
     */
    const url = testDatabaseUrl();
    const shown = url.replace(/:\/\/[^@]*@/, "://***@");

    const h = createDb(url, { max });
    try {
        await h.db.execute(sql`SELECT 1`);
    } catch (e) {
        await h.close().catch(() => {});
        throw new Error(
            [
                `테스트 DB 에 못 붙었습니다 (${shown}).`,
                "  한 번만 준비하면 됩니다:  npm run db:test",
                "  인프라가 먼저입니다:      npm run infra:up",
                `  원인: ${e instanceof Error ? e.message : String(e)}`,
            ].join("\n"),
        );
    }

    // 시드가 안 돌았으면 테스트가 엉뚱한 곳에서 실패한다. 여기서 짚어 준다
    const rows = await h.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM problems`);
    const [seeded] = Array.from(rows as Iterable<{ n: number }>);
    if (Number(seeded?.n ?? 0) === 0) {
        await h.close().catch(() => {});
        throw new Error(["테스트 DB 에 시드 데이터가 없습니다.", "  npm run db:test 를 돌리세요."].join("\n"));
    }
    return h;
}

/***@")}).\n` +
                "  먼저 인프라를 띄우세요:  npm run infra:up\n" +
                "  이미 띄웠다면 마이그레이션이 안 돌았을 수 있습니다:  npm run db:migrate\n" +
                `  원인: ${why}`,
        );
    }
    return h;
}

/**
 * 워커가 떠 있으면 테스트가 만든 큐 행을 가로채서 결과가 흔들린다.
 * 조용히 실패하면 원인을 찾는 데 오래 걸리므로 시작할 때 분명히 막는다.
 */
export async function ensureNoLiveWorker(h: DbHandle): Promise<void> {
    const rows = await h.db.execute<{ id: string }>(sql`
        SELECT id FROM judge_workers WHERE last_seen_at > now() - interval '60 seconds'
    `);
    const live = Array.from(rows as Iterable<{ id: string }>);
    if (live.length > 0) {
        throw new Error(
            `워커가 돌고 있습니다 (${live.map((w) => w.id).join(", ")}).\n` +
                "  테스트가 만든 제출을 워커가 가로채서 결과가 흔들립니다. 워커를 멈추고 다시 돌리세요.",
        );
    }
}
