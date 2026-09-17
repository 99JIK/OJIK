import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { loadEnv } from "@ojik/core/env";
import { testDatabaseUrl } from "./testdburl";

/**
 * 테스트용 DB 를 만들고 마이그레이션과 시드를 돌린다.
 *
 * 개발 DB 와 나누는 이유는 워커다. 테스트는 submissions 를 비우고 큐에 행을 넣는데,
 * 같은 DB 를 보는 워커가 그걸 집어 간다. 그래서 테스트마다 워커를 멈췄다 켜야 했고,
 * 잊으면 20건이 가드에 막혔다. DB 를 나누면 워커를 켜 둔 채로 테스트를 돌릴 수 있다.
 *
 * 컨테이너를 따로 띄우지 않는다. 같은 Postgres 안에 데이터베이스만 하나 더 만든다.
 * 메모리도 포트도 더 안 쓴다.
 *
 *   npm run db:test
 */
loadEnv();

const target = testDatabaseUrl();
const dbName = new URL(target).pathname.slice(1);

// 데이터베이스를 만들려면 다른 데이터베이스에 붙어 있어야 한다. postgres 를 쓴다
const adminUrl = new URL(target);
adminUrl.pathname = "/postgres";

const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) {
        // 식별자는 매개변수로 못 넘긴다. 이름이 우리가 만든 것이라 안전하다
        await admin.unsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
        console.log(`데이터베이스 ${dbName} 을(를) 만들었습니다.`);
    } else {
        console.log(`데이터베이스 ${dbName} 이(가) 이미 있습니다.`);
    }
} catch (e) {
    console.error(
        `\n테스트 DB 를 만들지 못했습니다.\n` +
            `  인프라가 떠 있는지 보세요:  npm run infra:up\n` +
            `  원인: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
} finally {
    await admin.end();
}

/** 마이그레이션과 시드는 DATABASE_URL 을 읽는다. 자식 프로세스에만 바꿔 넘긴다 */
function run(script: string) {
    const r = spawnSync("npm", ["run", script], {
        stdio: "inherit",
        shell: true,
        env: { ...process.env, DATABASE_URL: target },
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
}

run("db:migrate");
run("db:seed");

console.log(`\n테스트 DB 준비 끝: ${target.replace(/:\/\/[^@]*@/, "://***@")}`);
console.log("이제 워커를 켜 둔 채로 npm test 를 돌릴 수 있습니다.");
