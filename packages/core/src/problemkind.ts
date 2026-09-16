import { check } from "./checker";
import type { CheckerType } from "./limits";

// 문제 유형. 채점 경로가 갈리는 지점이라 한곳에 모은다.

/**
 * 셋 다 테스트케이스 표를 그대로 쓴다. 유형마다 표를 따로 두면 채점 결과와 점수 계산을
 * 세 번 구현하게 되고, 한 문제집에 섞여 있을 때 점수를 합칠 수가 없다.
 *
 *   code    코드를 내면 샌드박스에서 돌린다. 입력을 주고 출력을 비교한다
 *   blank   빈칸만 채운다. 서버가 원본에 끼워 완성 코드를 만들고 code 와 같은 길로 보낸다
 *   answer  단답형. 채점기를 안 탄다. 문항 지문을 보여 주고 적은 답을 기댓값과 비교한다
 *
 * 테스트케이스가 유형마다 뜻이 다르다.
 *   code, blank   input 은 프로그램 입력, output 은 기대 출력
 *   answer        input 은 문항 지문(마크다운), output 은 기대 답
 */
export const PROBLEM_KINDS = ["code", "blank", "answer"] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

export const PROBLEM_KIND_LABEL: Record<ProblemKind, string> = {
    code: "코드 제출",
    blank: "빈칸 채우기",
    answer: "단답형",
};

export const PROBLEM_KIND_DESCRIPTION: Record<ProblemKind, string> = {
    code: "학생이 프로그램을 짜서 냅니다. 샌드박스에서 돌려 출력을 비교합니다.",
    blank: "코드를 주고 비운 줄만 채우게 합니다. 채운 줄을 끼워 완성한 뒤 돌립니다.",
    answer: "문항마다 답을 적게 합니다. 채점기를 안 쓰므로 개념 확인에 씁니다.",
};

/** 샌드박스를 거치는 유형인지. 아니면 API 가 바로 채점한다 */
export function needsJudge(kind: ProblemKind): boolean {
    return kind !== "answer";
}

/** 단답형 답안 한 벌. 제출의 sourceCode 에 이 모양으로 담긴다 */
export interface AnswerSheet {
    /** 테스트케이스 idx 별 답 */
    answers: Record<number, string>;
}

/**
 * 단답형 제출은 소스 코드가 아니라 답 묶음이다.
 *
 * submissions 표를 따로 나누지 않으려고 sourceCode 에 JSON 을 넣는다. 유형이 셋인데
 * 표가 셋이면 채점 현황, 점수 계산, 재채점을 세 번 구현하게 된다. 대신 읽을 때는 반드시
 * 이 함수를 거쳐서, 어디선가 소스 코드로 착각하고 그대로 화면에 뿌리는 일을 막는다.
 */
export function encodeAnswers(answers: Record<number, string>): string {
    return JSON.stringify({ answers } satisfies AnswerSheet);
}

export function decodeAnswers(sourceCode: string): Record<number, string> {
    try {
        const parsed = JSON.parse(sourceCode) as AnswerSheet;
        return parsed?.answers && typeof parsed.answers === "object" ? parsed.answers : {};
    } catch {
        return {};
    }
}

/**
 * 빈칸 문제에서 채운 줄을 원본에 끼워 넣는다.
 *
 * 줄 번호는 1부터다. 사람이 에디터에서 보는 번호와 같아야 출제자가 헷갈리지 않는다.
 * 비운 줄에 학생이 안 채웠으면 빈 줄로 둔다. 컴파일 에러가 나겠지만 그게 맞는 결과다.
 *
 * 원본 줄 수를 넘는 번호는 무시한다. 출제자가 코드를 줄이고 줄 번호를 안 고쳤을 때
 * 채점이 통째로 죽는 것보다는 그 칸이 없는 채로 도는 게 낫다.
 */
export function fillBlanks(template: string, blankLines: number[], filled: Record<number, string>): string {
    const lines = template.split("\n");
    for (const n of blankLines) {
        const i = n - 1;
        if (i < 0 || i >= lines.length) continue;
        lines[i] = filled[n] ?? "";
    }
    return lines.join("\n");
}

/**
 * 학생에게 보여 줄 코드. 비운 줄은 지운다.
 *
 * 서버가 원본을 들고 있고 줄 번호만 저장한다. 빈칸 친 사본을 따로 저장하면 원본을 고칠 때
 * 둘이 어긋난다.
 */
export function blankOut(template: string, blankLines: number[]): string[] {
    const lines = template.split("\n");
    const set = new Set(blankLines);
    return lines.map((l, i) => (set.has(i + 1) ? "" : l));
}

/** 빈칸 한 칸의 길이 상한. 한 줄을 채우는 것이라 길 이유가 없다 */
export const BLANK_MAX_BYTES = 2000;
/** 단답형 답 하나의 길이 상한 */
export const ANSWER_MAX_BYTES = 2000;

/**
 * 단답형 답 하나를 채점한다.
 *
 * 문제의 비교 규칙(exact, trim, float)을 그대로 쓰되, 양쪽 끝 공백을 먼저 없앤다.
 * checker 의 trim 은 줄 끝 공백만 없애고 앞 공백은 남긴다. 프로그램 출력에서는 앞 공백이
 * 뜻을 가질 수 있어서 그렇게 만든 것인데, 한 줄짜리 답에서는 그냥 오타다.
 *
 * exact 를 고른 문제에서도 끝 공백은 없앤다. 여기서 exact 는 "대소문자와 글자를 정확히"
 * 라는 뜻이지 "스페이스를 정확히" 가 아니다.
 */
export function gradeAnswer(
    checkerType: CheckerType,
    given: string,
    expected: string,
    floatEpsilon: number,
): boolean {
    return check(checkerType, Buffer.from(given.trim(), "utf8"), Buffer.from(expected.trim(), "utf8"), floatEpsilon).ok;
}
