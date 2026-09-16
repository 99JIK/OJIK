// 문제 설정의 허용 범위와 채점 산출물 상한.
// 매직넘버를 코드 여기저기 박지 않으려고 모아 둔다.

export const PROBLEM_LIMITS = {
    timeMs: { min: 100, max: 20_000, default: 1000 },
    memoryMb: { min: 16, max: 1024, default: 256 },
} as const;

/** 제출 프로그램의 stdout 상한 바이트. 넘으면 output_limit_exceeded */
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** 제출 소스 길이 상한 */
export const MAX_SOURCE_BYTES = 256 * 1024;

/** DB 와 화면에 남길 출력 조각 길이. 전문을 저장하면 DB 가 감당을 못 한다 */
export const STORED_OUTPUT_SNIPPET_BYTES = 4 * 1024;

/** 워커가 죽었다고 보고 큐로 되돌리기까지의 무응답 시간.
 *  heartbeat 주기보다 충분히 길어야 정상 워커를 뺏지 않는다 */
export const JUDGE_LEASE_TIMEOUT_MS = 120_000;
export const JUDGE_HEARTBEAT_INTERVAL_MS = 15_000;

/** 같은 제출을 몇 번까지 자동 재시도할지. 넘으면 internal_error 로 확정.
 *  KOJ 는 재시도가 아예 없어서 일시적 docker 오류에도 학생이 다시 제출해야 했다 */
export const MAX_JUDGE_ATTEMPTS = 3;

export const CHECKER_TYPES = ["exact", "trim", "float"] as const;
export type CheckerType = (typeof CHECKER_TYPES)[number];

export const CHECKER_LABEL: Record<CheckerType, string> = {
    exact: "완전 일치",
    trim: "공백 무시",
    float: "실수 오차 허용",
};
