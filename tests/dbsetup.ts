import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "@ojik/db";

/**
 * DB 를 쓰는 테스트의 공통 준비.
 *
 * 붙는 것과 워커가 없는 것을 확인한다. 둘 다 안 보고 바로 질의하면 실패가 스택 트레이스로
 * 나오는데, 테스트 하나당 한 번씩 나오므로 화면이 ECONNREFUSED 로 뒤덮인다. 실제로
 * 그랬고, 원인이 "DB 를 안 띄웠다" 라는 걸 알아보기 어려웠다.
 */

export async function openTestDb(max: number): Promise<DbHandle> {
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error(
            "DATABASE_URL 이 없습니다.\n" +
                "  저장소 루트에 .env 가 있는지 보세요. .env.example 을 복사해 쓰면 됩니다.",
        );
    }

    const h = createDb(url, { max });
    try {
        await h.db.execute(sql`SELECT 1`);
    } catch (e) {
        await h.close().catch(() => {});
        const why = e instanceof Error ? e.message : String(e);
        throw new Error(
            `PostgreSQL 에 못 붙었습니다 (${url.replace(/:\/\/[^@]*@/, "://***@")}).\n` +
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
