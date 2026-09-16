import { sql } from "drizzle-orm";
import { createDb } from "@ojik/db";

/**
 * e2e 스크립트가 시작할 때 보는 것들.
 *
 * API 나 워커가 안 떠 있으면 fetch 가 ECONNREFUSED 스택 트레이스를 뱉는데, 거기에는
 * "무엇을 띄워야 하는지" 가 안 적혀 있다. 실제로 그 상태로 세 스크립트를 연달아 돌리면
 * 같은 트레이스가 세 번 나온다. 한 줄로 알려 주고 끝낸다.
 */

export function apiBase(): string {
    return `http://localhost:${process.env.PORT ?? 3000}/api`;
}

/** 죽는 대신 안내하고 끝낸다. 스크립트가 아니라 환경 문제라 스택은 도움이 안 된다 */
function bail(lines: string[]): never {
    console.error("\n" + lines.join("\n") + "\n");
    process.exit(1);
}

export async function requireApi(): Promise<void> {
    const url = `${apiBase()}/health`;
    try {
        const r = await fetch(url);
        if (!r.ok) {
            bail([`API 가 ${r.status} 를 돌려줍니다 (${url}).`, "  로그를 보고 왜 안 뜨는지 확인하세요."]);
        }
    } catch {
        bail([
            `API 에 못 붙었습니다 (${url}).`,
            "  다른 터미널에서 띄우세요:  npm run dev:api",
            "  인프라가 먼저입니다:      npm run infra:up",
        ]);
    }
}

/**
 * 채점이 필요한 스크립트만 부른다.
 *
 * 워커가 없으면 제출이 큐에 쌓인 채로 끝나고, 스크립트는 "시간 안에 안 끝남" 을 보여 준다.
 * 그건 채점이 틀렸다는 뜻으로 읽히기 쉬워서 미리 막는다.
 */
export async function requireWorker(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) bail(["DATABASE_URL 이 없습니다.", "  저장소 루트의 .env 를 보세요."]);

    const h = createDb(url, { max: 1 });
    try {
        const rows = await h.db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM judge_workers
            WHERE last_seen_at > now() - interval '60 seconds'
        `);
        const [row] = Array.from(rows as Iterable<{ n: number }>);
        if (Number(row?.n ?? 0) === 0) {
            bail([
                "채점 워커가 안 돌고 있습니다.",
                "  다른 터미널에서 띄우세요:  npm run dev:worker",
                "  워커가 없으면 제출이 큐에 쌓인 채로 끝나고, 결과가 안 나옵니다.",
            ]);
        }
    } catch (e) {
        if (e instanceof Error && e.message.includes("judge_workers")) throw e;
        bail([
            "PostgreSQL 에 못 붙었습니다.",
            "  먼저 인프라를 띄우세요:  npm run infra:up",
            `  원인: ${e instanceof Error ? e.message : String(e)}`,
        ]);
    } finally {
        await h.close().catch(() => {});
    }
}
