import {
    pgTable,
    serial,
    text,
    integer,
    timestamp,
    index,
    uniqueIndex,
    primaryKey,
} from "drizzle-orm/pg-core";
import {
    visibilityEnum,
    collectionPresetEnum,
    timingEnum,
    revealEnum,
    scoringEnum,
    joinPolicyEnum,
    itemKindEnum,
    memberRoleEnum,
} from "./enums";
import { users } from "./users";
import { problems } from "./problems";

/**
 * 문제를 묶는 모든 것. 교재, 문제집, 대회, 코딩테스트가 전부 이 테이블이다.
 *
 * 넷을 각각의 테이블로 두면 문제 목록, 진행률, 권한 검사, 제출 필터를 네 번 구현하게 된다.
 * 실제로 넷의 차이는 종류가 아니라 정책 축의 값이다.
 *
 *              timing     reveal      scoring   joinPolicy  본문
 *   교재        none       immediate   none      open        설명 + 문제
 *   문제집      fixed?     immediate   progress  members     문제만
 *   대회        fixed      frozen      icpc/ioi  register    문제만
 *   코딩테스트   per_user   after_end   none      invite      문제만
 *
 * 축을 직접 만지는 건 고급 설정이고, 화면은 preset 버튼으로 값을 채워 준다.
 * 축이 다섯이면 말이 안 되는 조합도 만들 수 있는데, 그걸 막는 건 스키마가 아니라 화면이다.
 */
export const collections = pgTable(
    "collections",
    {
        id: serial().primaryKey(),
        slug: text().notNull(),
        title: text().notNull(),
        /** 마크다운. 대회 안내문이나 교재 머리말 */
        description: text().notNull().default(""),

        /** 동작을 정하지 않는다. 어떤 의도로 만들었는지만 기록해 표시와 기본값에 쓴다 */
        preset: collectionPresetEnum().notNull().default("problemset"),

        // ---- 축 1: 시간 창 ----
        timing: timingEnum().notNull().default("none"),
        /** timing=fixed 일 때. 모두가 같은 시각에 시작하고 끝난다 */
        startsAt: timestamp({ withTimezone: true }),
        endsAt: timestamp({ withTimezone: true }),
        /** timing=per_user 일 때. 각자 시작 버튼을 누른 시점부터 이 분 만큼 */
        durationMinutes: integer(),

        // ---- 축 2: 결과 공개 ----
        reveal: revealEnum().notNull().default("immediate"),
        /** reveal=frozen 일 때. 종료 몇 분 전부터 스코어보드를 얼릴지 */
        freezeMinutes: integer().notNull().default(0),

        // ---- 축 3: 순위 ----
        scoring: scoringEnum().notNull().default("none"),
        /** scoring=icpc 일 때 오답 1회당 붙는 분 */
        penaltyMinutes: integer().notNull().default(20),

        // ---- 축 4: 참가 ----
        joinPolicy: joinPolicyEnum().notNull().default("open"),
        visibility: visibilityEnum().notNull().default("public"),

        ownerId: integer().references(() => users.id, { onDelete: "set null" }),
        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("collections_slug_idx").on(t.slug),
        index("collections_preset_idx").on(t.preset, t.id.desc()),
        index("collections_time_idx").on(t.startsAt.desc()),
    ],
);

/**
 * 컬렉션 안의 항목. 문제와 설명 문단이 한 목록에 순서대로 섞인다.
 * 설명을 섞을 수 있다는 것이 교재를 가능하게 하는 유일한 차이다.
 */
export const collectionItems = pgTable(
    "collection_items",
    {
        id: serial().primaryKey(),
        collectionId: integer()
            .notNull()
            .references(() => collections.id, { onDelete: "cascade" }),
        /** 목록 안의 순서. 0 이면 대회에서 A번 */
        idx: integer().notNull(),

        kind: itemKindEnum().notNull().default("problem"),

        /** kind=problem 일 때 */
        problemId: integer().references(() => problems.id, { onDelete: "cascade" }),
        /** scoring=ioi 일 때의 만점. 다른 채점 방식이면 무시된다 */
        points: integer().notNull().default(100),

        /** kind=text 일 때. 마크다운 */
        body: text(),
        /** kind=text 일 때 목차에 쓸 제목. 없으면 목차에 안 나온다 */
        heading: text(),
    },
    (t) => [
        uniqueIndex("collection_items_idx_idx").on(t.collectionId, t.idx),
        index("collection_items_problem_idx").on(t.problemId),
    ],
);

/**
 * 참가자. 문제집 멤버, 대회 등록, 코딩테스트 초대를 하나로 본다.
 *
 * timing=per_user 면 startedAt 과 endsAt 이 사람마다 다르다.
 * timing=fixed 면 컬렉션의 값을 쓰고 이 컬럼은 비어 있다. 한 코드로 둘 다 처리한다.
 */
export const collectionMembers = pgTable(
    "collection_members",
    {
        collectionId: integer()
            .notNull()
            .references(() => collections.id, { onDelete: "cascade" }),
        userId: integer()
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: memberRoleEnum().notNull().default("member"),

        /** null 이면 아직 시작 안 함. timing=per_user 에서만 의미 있다 */
        startedAt: timestamp({ withTimezone: true }),
        endsAt: timestamp({ withTimezone: true }),

        joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.collectionId, t.userId] }),
        index("collection_members_user_idx").on(t.userId),
    ],
);

export type Collection = typeof collections.$inferSelect;
export type CollectionItem = typeof collectionItems.$inferSelect;
export type CollectionMember = typeof collectionMembers.$inferSelect;
