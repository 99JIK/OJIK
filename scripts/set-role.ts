import { sql } from "drizzle-orm";
import { loadEnv } from "@ojik/core/env";
import { ROLES, ROLE_LABEL, type Role } from "@ojik/core";
import { createDb, users } from "@ojik/db";

loadEnv();

/**
 * 사용자 권한을 바꾼다.
 *
 * 관리자 화면이 아직 없어서 첫 운영자를 만들 방법이 필요하다.
 * 화면이 생겨도 이건 남겨 두는 게 낫다. 스스로 권한을 내려버렸을 때 돌아올 길이 필요하다.
 *
 *   npm run set-role -- <handle> <admin|staff|user>
 *   npm run set-role            (현재 목록만 보여줌)
 */

const [handle, role] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
    console.error("DATABASE_URL 이 없습니다.");
    process.exit(1);
}

const h = createDb(url, { max: 1 });

if (!handle) {
    const rows = await h.db
        .select({ id: users.id, handle: users.handle, role: users.role })
        .from(users)
        .orderBy(users.id);
    console.log("사용자 목록:");
    for (const r of rows) {
        console.log(`  ${String(r.id).padStart(3)}  ${r.handle.padEnd(20)} ${ROLE_LABEL[r.role]} (${r.role})`);
    }
    console.log("\n사용법: npm run set-role -- <handle> <" + ROLES.join("|") + ">");
    await h.close();
    process.exit(0);
}

if (!role || !ROLES.includes(role as Role)) {
    console.error(`권한은 ${ROLES.join(", ")} 중 하나여야 합니다.`);
    await h.close();
    process.exit(1);
}

const [updated] = await h.db.execute<{ id: number; handle: string; role: string }>(sql`
    UPDATE users SET role = ${role}::role
    WHERE lower(handle) = lower(${handle})
    RETURNING id, handle, role
`);

if (!updated) {
    console.error(`사용자 '${handle}' 를 찾을 수 없습니다.`);
    await h.close();
    process.exit(1);
}

const u = updated as unknown as { handle: string; role: Role };
console.log(`${u.handle} -> ${ROLE_LABEL[u.role]} (${u.role})`);
// 토큰에 든 role 을 믿지 않고 요청마다 DB 를 보므로 재로그인이 필요 없다
console.log("다시 로그인하지 않아도 바로 반영됩니다.");

await h.close();
