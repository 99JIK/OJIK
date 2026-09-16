import { sql, type SQL } from "drizzle-orm";
import {
    pgTable,
    serial,
    text,
    timestamp,
    integer,
    boolean,
    index,
    uniqueIndex,
    type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { roleEnum } from "./enums";

/** citext 확장을 안 쓰고 lower() 표현식 인덱스로 대소문자 무시 유일성을 건다 */
function lower(col: AnyPgColumn): SQL {
    return sql`lower(${col})`;
}

export const users = pgTable(
    "users",
    {
        id: serial().primaryKey(),
        /** 공개 표시명. 로그인은 이메일로 한다 */
        handle: text().notNull(),
        passwordHash: text().notNull(),
        displayName: text(),
        role: roleEnum().notNull().default("user"),

        /** 목록과 랭킹에서 매번 제출 테이블을 집계하면 느리다.
         *  채점 확정 트랜잭션에서 같이 갱신하는 캐시값. 진짜 값은 submissions 집계.
         *  재채점으로 어긋나면 scripts/recount.ts 로 바로잡는다 */
        solvedCount: integer().notNull().default(0),
        submissionCount: integer().notNull().default(0),

        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        lastLoginAt: timestamp({ withTimezone: true }),
    },
    (t) => [
        uniqueIndex("users_handle_lower_idx").on(lower(t.handle)),
        index("users_solved_idx").on(t.solvedCount.desc()),
    ],
);

/**
 * 계정의 이메일. 한 계정에 둘까지 둔다.
 *
 * 왜 별도 테이블인가: 나중에 학교 메일을 추가로 등록해 학교 인증을 받거나, 주소를 바꿀 때
 * 기존 주소를 살려 둔 채로 갈아탈 수 있어야 한다. users.email 하나로는 둘 다 안 된다.
 *
 * verifiedAt 은 지금 전부 null 이다. 인증 없이 가입을 받되 컬럼은 미리 만들어 둔다.
 * 나중에 인증을 붙일 때 마이그레이션이 필요 없고, 학교 배지는 verifiedAt 이 있는 주소만 본다.
 *
 * 개수 상한(2)은 API 에서 검사한다. 제약으로 박으면 늘릴 때 마이그레이션이 필요하다.
 */
export const userEmails = pgTable(
    "user_emails",
    {
        id: serial().primaryKey(),
        userId: integer()
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        email: text().notNull(),
        /** 알림을 받을 주소. 계정당 하나 */
        isPrimary: boolean().notNull().default(false),
        /** 소유 확인 시각. 지금은 항상 null */
        verifiedAt: timestamp({ withTimezone: true }),
        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        // 주소는 전체에서 유일하다. 두 계정이 같은 주소를 쓰면 로그인이 갈린다
        uniqueIndex("user_emails_lower_idx").on(lower(t.email)),
        index("user_emails_user_idx").on(t.userId),
    ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserEmail = typeof userEmails.$inferSelect;
