import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadEnv } from "@ojik/core/env";
import { createDb } from "./client";

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
    console.error("DATABASE_URL 이 없습니다. .env 를 확인하세요.");
    process.exit(1);
}

const h = createDb(url, { max: 1 });
// URL.pathname 을 쓰면 Windows 에서 /C:/... 가 되어 깨진다
const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
await migrate(h.db, { migrationsFolder: folder });
await h.close();
console.log("migrated");
