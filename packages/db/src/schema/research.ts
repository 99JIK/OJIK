import { pgTable, serial, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { consentKindEnum } from "./enums";
import { users } from "./users";

/**
 * 연구 이용 동의.
 *
 * 왜 지금 만드는가: 동의는 **나중에 받을 수 없다**. 데이터가 쌓인 뒤에 물으려면 이미
 * 떠난 사용자에게 연락해야 하고, 그건 사실상 불가능하다. 결국 수천 건 중 최근 몇 백 건만
 * 쓸 수 있는 상태가 된다. 지금 가입 화면에 선택 항목 하나를 두는 비용과 비교가 안 된다.
 *
 * version 은 동의 문구가 바뀌었을 때 누가 어떤 문구에 동의했는지 가리는 값이다.
 * 연구 심의에서 반드시 묻는다.
 *
 * 기본값은 꺼짐이어야 한다. 체크된 채로 가입시키면 동의로 인정되지 않는다.
 */
export const consents = pgTable(
    "consents",
    {
        id: serial().primaryKey(),
        userId: integer()
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        kind: consentKindEnum().notNull(),
        /** 동의받은 문구의 버전. 문구를 바꾸면 올린다 */
        version: text().notNull(),
        grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        /** 철회 시각. null 이면 유효 */
        revokedAt: timestamp({ withTimezone: true }),
    },
    (t) => [index("consents_user_idx").on(t.userId, t.kind)],
);

/**
 * 채점이 이뤄진 환경.
 *
 * "이 풀이는 평균 120ms" 같은 값은 어떤 기계에서 어떤 컴파일러로 쟀는지를 모르면
 * 해석할 수 없다. 특히 성능 코어와 효율 코어가 섞인 CPU 에서는 같은 코드가 2배까지
 * 차이 나므로, 환경을 안 남기면 시간 데이터 전체가 섞여 못 쓰게 된다.
 *
 * 제출마다 jsonb 를 박으면 무겁다. 서로 다른 환경은 몇 년 써도 수십 개뿐이라
 * 따로 두고 참조만 한다. 제출당 비용은 4바이트다.
 */
export const judgeEnvironments = pgTable(
    "judge_environments",
    {
        id: serial().primaryKey(),
        /** 같은 환경인지 판정하는 지문. 아래 값들을 이어 붙여 해시한다 */
        fingerprint: text().notNull(),

        workerId: text().notNull(),
        hostname: text().notNull(),
        /** x64, arm64. 아키텍처가 다르면 시간과 메모리가 다르게 나온다 */
        arch: text().notNull(),
        /** 컴파일러 버전이 여기 담긴다. 이미지가 바뀌면 다이제스트가 바뀐다 */
        runnerImages: text().notNull(),
        isolateVersion: text().notNull().default(""),

        firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("judge_environments_fp_idx").on(t.fingerprint)],
);

export type Consent = typeof consents.$inferSelect;
export type JudgeEnvironment = typeof judgeEnvironments.$inferSelect;
