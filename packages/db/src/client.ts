import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Sql = ReturnType<typeof postgres>;
export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
    sql: Sql;
    db: Db;
    close: () => Promise<void>;
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
    const sql = postgres(url, {
        max: opts.max ?? 10,
        // NOTICE 는 마이그레이션 때 대량으로 나온다. 로그를 덮어서 진짜 경고를 묻는다
        onnotice: () => {},
    });
    const db = drizzle(sql, { schema, casing: "snake_case" });
    return { sql, db, close: () => sql.end({ timeout: 5 }) };
}

export { schema };
