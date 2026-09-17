import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * 워커 현황. 채점에 꼭 필요하진 않지만 없으면 "채점이 안 도는데 워커가 살아 있나"를
 * 서버에 붙어서 확인해야 한다. KOJ 에서 반복된 1차 확인 작업이다.
 */
export const judgeWorkers = pgTable(
    "judge_workers",
    {
        /** 설정값 또는 hostname-pid. 제출의 claimedBy 와 맞춰 본다 */
        id: text().primaryKey(),
        hostname: text().notNull(),
        /** 같은 호스트에서 재시작할 때 죽은 등록인지 가리는 데 쓴다 */
        pid: integer().notNull().default(0),
        version: text().notNull().default(""),

        /** 이 워커가 동시에 잡을 수 있는 제출 수 */
        capacity: integer().notNull().default(1),
        /** 지금 잡고 있는 수 */
        busy: integer().notNull().default(0),

        startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("judge_workers_seen_idx").on(t.lastSeenAt.desc())],
);

export type JudgeWorker = typeof judgeWorkers.$inferSelect;
