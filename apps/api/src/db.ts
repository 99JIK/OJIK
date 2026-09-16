import { createDb } from "@ojik/db";
import { env } from "./env";

export const handle = createDb(env.DATABASE_URL);
export const db = handle.db;
