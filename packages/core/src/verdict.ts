// 채점 결과 분류. 상태(lifecycle)와 판정(verdict)을 분리한다.
// KOJ 는 둘을 섞어 써서 "시간 초과인데 최종 상태는 wrong_answer" 같은 일이 생겼다.

/** 제출의 생애주기. 채점이 어디까지 갔는지만 나타낸다 */
export const SUBMISSION_STATUSES = ["queued", "judging", "done", "canceled"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** 채점 판정. status 가 done 일 때만 값이 있다 */
export const VERDICTS = [
    "accepted",
    "wrong_answer",
    "time_limit_exceeded",
    "memory_limit_exceeded",
    "output_limit_exceeded",
    "runtime_error",
    "compile_error",
    "internal_error",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABEL: Record<Verdict, string> = {
    accepted: "맞았습니다",
    wrong_answer: "틀렸습니다",
    time_limit_exceeded: "시간 초과",
    memory_limit_exceeded: "메모리 초과",
    output_limit_exceeded: "출력 초과",
    runtime_error: "런타임 에러",
    compile_error: "컴파일 에러",
    internal_error: "채점 오류",
};

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
    queued: "기다리는 중",
    judging: "채점 중",
    done: "채점 완료",
    canceled: "채점 취소",
};

/** 사용자 잘못이 아닌 판정. 재채점 대상을 고를 때 쓴다 */
export function isSystemFault(v: Verdict): boolean {
    return v === "internal_error";
}

/** 최종 판정 집계. 테스트케이스 결과 중 가장 나쁜 것 하나가 제출의 판정이 된다.
 *  앞쪽일수록 나쁨. accepted 는 전부 accepted 일 때만 남는다 */
const SEVERITY: readonly Verdict[] = [
    "internal_error",
    "compile_error",
    "output_limit_exceeded",
    "memory_limit_exceeded",
    "time_limit_exceeded",
    "runtime_error",
    "wrong_answer",
    "accepted",
];

export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
    if (verdicts.length === 0) return "internal_error";
    let worstIdx = SEVERITY.length - 1;
    for (const v of verdicts) {
        const i = SEVERITY.indexOf(v);
        if (i >= 0 && i < worstIdx) worstIdx = i;
    }
    return SEVERITY[worstIdx]!;
}
