import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { problems } from "./problems";

/**
 * 문제 풀이 글과 댓글.
 *
 * 읽기와 쓰기 모두 그 문제를 맞힌 사람에게만 연다. 권한 판정은 submissions 의
 * (problemId, userId) WHERE verdict='accepted' 부분 인덱스로 한 번에 끝난다.
 *
 * 하루 쓰기 한도를 세야 해서 (userId, createdAt) 인덱스를 따로 둔다. id 로 대신하면
 * 날짜 경계를 id 범위로 바꾸는 계산이 들어가고, 그건 나중에 읽을 때 뭘 하는지 모른다.
 */
export const solutions = pgTable(
    "solutions",
    {
        id: serial().primaryKey(),
        problemId: integer()
            .notNull()
            .references(() => problems.id, { onDelete: "cascade" }),
        userId: integer()
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        title: text().notNull(),
        /** 마크다운. 화면에서 수식과 도식까지 그대로 렌더한다 */
        body: text().notNull(),

        /** 댓글 수 캐시. 목록에서 매번 세면 글 수만큼 쿼리가 는다 */
        commentCount: integer().notNull().default(0),

        /**
         * 지운 글은 행을 남기고 표시만 한다. 댓글이 달린 글을 정말로 지우면 대화가 끊기고,
         * 남의 댓글까지 같이 사라진다. 본문은 화면에서 가린다
         */
        deletedAt: timestamp({ withTimezone: true }),

        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index("solutions_problem_idx").on(t.problemId, t.id.desc()),
        index("solutions_user_day_idx").on(t.userId, t.createdAt),
    ],
);

export const solutionComments = pgTable(
    "solution_comments",
    {
        id: serial().primaryKey(),
        solutionId: integer()
            .notNull()
            .references(() => solutions.id, { onDelete: "cascade" }),
        userId: integer()
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        body: text().notNull(),
        deletedAt: timestamp({ withTimezone: true }),
        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index("solution_comments_solution_idx").on(t.solutionId, t.id),
        index("solution_comments_user_day_idx").on(t.userId, t.createdAt),
    ],
);
