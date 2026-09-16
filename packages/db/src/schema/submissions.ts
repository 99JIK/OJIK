import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { languageEnum, submissionStatusEnum, verdictEnum } from "./enums";
import { users } from "./users";
import { problems, testcases } from "./problems";
import { collections } from "./collections";
import { judgeEnvironments } from "./research";

/**
 * 제출 테이블이 곧 채점 큐다. RabbitMQ 를 두지 않는다.
 *
 * KOJ 가 MQ 때문에 겪은 것들이 여기서 구조적으로 사라진다.
 * - 메시지 유실: 큐 상태가 행 자체라서 유실될 대상이 없다. MQ 재시작 개념이 없음
 * - publish 실패로 생기는 고아 제출: DB 저장이 곧 큐 등록이라 둘이 어긋날 수 없다
 * - 재채점 수단 없음: status 를 queued 로 되돌리는 UPDATE 한 줄
 * - 워커 급사 시 멈춤: heartbeatAt 이 끊긴 행을 다른 워커가 회수한다
 *
 * 꺼내기는 SELECT ... FOR UPDATE SKIP LOCKED. 낮은 지연은 LISTEN/NOTIFY 로 깨워서 얻는다.
 */
export const submissions = pgTable(
    "submissions",
    {
        id: serial().primaryKey(),
        problemId: integer()
            .notNull()
            .references(() => problems.id, { onDelete: "cascade" }),
        userId: integer()
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        /** 시간 제한이 있는 컬렉션(대회, 코딩테스트) 안에서의 제출이면 그 컬렉션.
         *  스코어보드 집계 범위이자 우선순위 근거이고, 결과 공개 규칙도 여기서 나온다 */
        collectionId: integer().references(() => collections.id, { onDelete: "set null" }),

        /**
         * 제출 언어. 단답형(problems.kind=answer)에는 없다.
         *
         * 목록에 가짜 언어를 넣는 것도 생각했지만, 그러면 언어별 통계에 단답형이 섞이고
         * 채점 현황의 언어 필터에 뜻 없는 항목이 생긴다. 없는 것은 없다고 둔다.
         */
        language: languageEnum(),
        sourceCode: text().notNull(),
        sourceBytes: integer().notNull(),

        status: submissionStatusEnum().notNull().default("queued"),
        /** status 가 done 일 때만 채워진다 */
        verdict: verdictEnum(),

        /** 통과 테스트케이스 비율로 계산한 점수. 부분점수 안 쓰면 0 또는 100 */
        score: integer().notNull().default(0),
        /** 전체 테스트케이스 중 가장 오래 걸린 값 */
        maxTimeMs: integer(),
        maxMemoryKb: integer(),

        /** 채점 중 진행률 표시용. 화면의 "채점 중 (37%)" */
        judgedCount: integer().notNull().default(0),
        totalCount: integer().notNull().default(0),

        /** 컴파일 에러 메시지. 경로가 섞여 나가지 않게 워커가 한 번 걸러서 넣는다 */
        compileOutput: text(),
        /** internal_error 일 때 운영자가 볼 원인. 사용자에게는 안 보여준다 */
        judgeError: text(),

        /**
         * 처음 실패한 케이스의 출력 조각. 케이스마다 저장하면 출력이 큰 문제에서
         * 소스보다 수십 배 무거워진다(20케이스 x 8KB = 160KB). 사용자가 보는 건
         * 처음 틀린 것 하나뿐이라 그것만 남긴다.
         */
        failedIdx: integer(),
        failedStdout: text(),
        failedStderr: text(),

        // ---- 큐 제어 컬럼 ----
        /** 높을수록 먼저. 대회 제출을 연습 제출보다 앞세울 때 쓴다 */
        priority: integer().notNull().default(0),
        /** 자동 재시도 횟수. MAX_JUDGE_ATTEMPTS 를 넘기면 internal_error 로 확정 */
        attempts: integer().notNull().default(0),
        /** 지금 잡고 있는 워커 id. 회수 판단과 장애 추적용 */
        claimedBy: text(),
        claimedAt: timestamp({ withTimezone: true }),
        /** 워커가 살아 있다는 신호. 끊기면 다른 워커가 회수한다 */
        heartbeatAt: timestamp({ withTimezone: true }),

        /**
         * 어떤 환경에서 채점했는지. 시간과 메모리 값을 해석하려면 필요하다.
         * 하드웨어와 컴파일러가 다르면 같은 코드가 다른 숫자를 낸다.
         */
        judgeEnvId: integer().references(() => judgeEnvironments.id, { onDelete: "set null" }),
        /** 채점 시점의 problems.testcase_version. 판정이 어느 기준인지 가린다 */
        testcaseVersion: integer(),

        /** 재채점으로 큐에 다시 들어가면 갱신된다. 대기 시간 계산 기준 */
        queuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        judgedAt: timestamp({ withTimezone: true }),
        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

        /** 대회 중 다른 사람 코드를 못 보게 하는 표시. 대회 종료 후 운영자가 풀어 준다 */
        isCodePublic: boolean().notNull().default(false),
    },
    (t) => [
        // 큐 꺼내기 전용 부분 인덱스. queued 행만 담으므로 테이블이 아무리 커져도 작게 유지된다
        index("submissions_queue_idx")
            .on(t.priority.desc(), t.id.asc())
            .where(sql`${t.status} = 'queued'`),
        // 죽은 워커가 잡고 있는 행 회수용. judging 행만 담는다
        index("submissions_lease_idx")
            .on(t.heartbeatAt.asc())
            .where(sql`${t.status} = 'judging'`),

        index("submissions_user_idx").on(t.userId, t.id.desc()),
        index("submissions_problem_idx").on(t.problemId, t.id.desc()),
        index("submissions_collection_idx").on(t.collectionId, t.id.desc()),
        // 문제별 첫 해결 판정과 맞힌 사람 수 집계
        index("submissions_ac_idx")
            .on(t.problemId, t.userId)
            .where(sql`${t.verdict} = 'accepted'`),
    ],
);

/** 테스트케이스별 결과. 부분점수와 "몇 번에서 틀렸는지" 표시에 쓴다 */
export const submissionResults = pgTable(
    "submission_results",
    {
        id: serial().primaryKey(),
        submissionId: integer()
            .notNull()
            .references(() => submissions.id, { onDelete: "cascade" }),
        testcaseId: integer().references(() => testcases.id, { onDelete: "set null" }),
        /** testcase 가 지워져도 순번은 남아야 결과를 읽을 수 있다 */
        idx: integer().notNull(),

        verdict: verdictEnum().notNull(),
        timeMs: integer().notNull().default(0),
        memoryKb: integer().notNull().default(0),
        points: integer().notNull().default(0),

        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("submission_results_submission_idx").on(t.submissionId, t.idx)],
);

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type SubmissionResult = typeof submissionResults.$inferSelect;
