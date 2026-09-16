import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, boolean, timestamp, index, primaryKey, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";
import { checkerTypeEnum } from "./enums";
import { users } from "./users";

export const problems = pgTable(
    "problems",
    {
        /** BOJ 처럼 이 id 가 곧 문제 번호다. 별도 표시번호를 두지 않는다 */
        id: serial().primaryKey(),
        title: text().notNull(),

        /** 본문은 마크다운. 수식은 KaTeX 로 렌더 */
        statement: text().notNull().default(""),
        inputDesc: text().notNull().default(""),
        outputDesc: text().notNull().default(""),
        hint: text(),

        timeLimitMs: integer().notNull().default(1000),
        memoryLimitMb: integer().notNull().default(256),

        checkerType: checkerTypeEnum().notNull().default("trim"),
        /** checkerType 이 float 일 때만 의미 있음. 상대/절대 오차 허용치 */
        floatEpsilon: doublePrecision().notNull().default(1e-6),

        /** 첫 오답에서 남은 테스트케이스를 중단할지. BOJ 기본 동작.
         *  대회 부분점수 문제는 false 로 둬야 점수가 나온다 */
        stopOnFirstFail: boolean().notNull().default(true),

        isPublic: boolean().notNull().default(false),
        /** 대회 문제를 대회 종료 전까지 감출 때 씀. null 이면 isPublic 만 본다 */
        publicFrom: timestamp({ withTimezone: true }),

        /** 1..30 정도의 임의 난이도. 값의 의미는 운영자가 정하는 것이지 객관 지표가 아님 */
        difficulty: integer(),

        /**
         * 테스트케이스를 교체할 때마다 올린다.
         *
         * 케이스를 강화하면 그 전 제출의 판정은 옛 기준이 된다. 이 값이 없으면
         * "정답률 40%"가 서로 다른 기준의 두 집단을 섞은 숫자인지 알 수 없다.
         */
        testcaseVersion: integer().notNull().default(1),

        acceptedCount: integer().notNull().default(0),
        submissionCount: integer().notNull().default(0),

        /**
         * 이 문제가 특정 강의에 묶여 있는지. null 이면 공개 아카이브 문제다.
         *
         * 강사는 자기 강의에 묶인 문제만 만들고 고칠 수 있다. 공개 아카이브는 출제자가 관리한다.
         * 강사 수가 늘면 아무나 아카이브에 문제를 쌓게 되고, 그건 되돌리기 어렵다.
         *
         * 컬렉션을 지우면 딸린 문제도 같이 지운다. 강의 전용 문제는 그 강의 밖에서 쓸 데가 없고,
         * 남겨 두면 주인 없는 문제가 목록에 안 보이는 채로 쌓인다. 공개로 올릴 문제는
         * 관리자가 이 값을 null 로 비우면 아카이브로 옮겨진다.
         *
         * 타입은 순환 참조를 피하려고 여기서 collections 를 import 하지 않는다.
         * 외래키는 마이그레이션에서 건다
         */
        ownerCollectionId: integer(),

        createdBy: integer().references(() => users.id, { onDelete: "set null" }),
        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index("problems_public_idx").on(t.isPublic, t.id),
        index("problems_difficulty_idx").on(t.difficulty),
        /** 강의 문제 목록. null 이 대부분이라 부분 인덱스로 둔다 */
        index("problems_owner_collection_idx")
            .on(t.ownerCollectionId)
            .where(sql`${t.ownerCollectionId} IS NOT NULL`),
    ],
);

export const tags = pgTable(
    "tags",
    {
        id: serial().primaryKey(),
        slug: text().notNull(),
        name: text().notNull(),
    },
    (t) => [uniqueIndex("tags_slug_idx").on(t.slug)],
);

export const problemTags = pgTable(
    "problem_tags",
    {
        problemId: integer()
            .notNull()
            .references(() => problems.id, { onDelete: "cascade" }),
        tagId: integer()
            .notNull()
            .references(() => tags.id, { onDelete: "cascade" }),
    },
    (t) => [primaryKey({ columns: [t.problemId, t.tagId] }), index("problem_tags_tag_idx").on(t.tagId)],
);

export const testcases = pgTable(
    "testcases",
    {
        id: serial().primaryKey(),
        problemId: integer()
            .notNull()
            .references(() => problems.id, { onDelete: "cascade" }),
        /** 문제 안에서의 순번. 파일명이 이 값으로 정해진다: tc/{idx}.in, tc/{idx}.out */
        idx: integer().notNull(),
        /** 문제 본문에 예제로 노출되는지. 예제는 비공개 문제라도 볼 수 있어야 함 */
        isSample: boolean().notNull().default(false),
        /** 부분점수용. 전부 같은 값이면 사실상 개수 비율 채점 */
        points: integer().notNull().default(0),

        /** 파일 본체는 {DATA_DIR}/problems/{problemId}/tc/ 아래에 있다.
         *  DB 는 해시와 크기만 들고, 이게 곧 무결성 검사 수단이다.
         *  KOJ 는 경로 문자열만 들고 있어서 DB 만 복구하면 행은 있고 파일이 없는 상태가 됐다 */
        inputSha256: text().notNull(),
        inputBytes: integer().notNull(),
        outputSha256: text().notNull(),
        outputBytes: integer().notNull(),

        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("testcases_problem_idx_idx").on(t.problemId, t.idx)],
);

export type Problem = typeof problems.$inferSelect;
export type Testcase = typeof testcases.$inferSelect;
