import type { CheckerType } from "./limits";

/**
 * 출력 비교. 문제마다 규칙을 고를 수 있게 한다.
 *
 * core 에 둔다. 워커가 제출 출력을 비교하는 데 쓰고, API 가 단답형 답안을 비교하는 데
 * 쓴다. 두 곳이 같은 규칙으로 맞다고 해야 "코드로는 맞는데 단답형으로는 틀리다" 같은
 * 일이 안 생긴다.
 *
 * KOJ 는 비교 방식이 코드에 박혀 있어서 "줄 끝 공백 때문에 틀렸습니다"가 반복됐다.
 * 기본값을 trim 으로 두는 이유다. BOJ 도 같은 규칙이다.
 */

export interface CheckResult {
    ok: boolean;
    /** 안 맞았을 때 어디서 갈렸는지. 운영자 확인용이고 학생에게는 안 보여준다 */
    detail?: string;
}

export function check(
    type: CheckerType,
    actual: Buffer,
    expected: Buffer,
    floatEpsilon: number,
): CheckResult {
    switch (type) {
        case "exact":
            return actual.equals(expected)
                ? { ok: true }
                : { ok: false, detail: firstDiff(actual.toString("utf8"), expected.toString("utf8")) };
        case "trim": {
            const a = normalize(actual.toString("utf8"));
            const e = normalize(expected.toString("utf8"));
            return a === e ? { ok: true } : { ok: false, detail: firstDiff(a, e) };
        }
        case "float":
            return checkFloat(actual.toString("utf8"), expected.toString("utf8"), floatEpsilon);
        case "special":
            /*
             * 여기 오면 안 된다.
             *
             * 스페셜 저지는 문자열 비교가 아니라 체커 프로그램이 판정한다. 워커가 유형을
             * 보고 다른 길로 보내야 하는데, 여기로 왔다는 건 그 분기를 빠뜨렸다는 뜻이다.
             * 조용히 trim 으로 떨어뜨리면 답이 여러 개인 문제에서 맞는 답이 전부 틀린다.
             */
            throw new Error("스페셜 저지는 check() 로 판정하지 않습니다. 워커의 분기가 빠졌습니다.");
    }
}

/** CRLF 를 LF 로, 줄 끝 공백 제거, 끝의 빈 줄 제거 */
function normalize(s: string): string {
    const lines = s.replace(/\r\n?/g, "\n").split("\n");
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
    return lines.map((l) => l.replace(/[ \t]+$/, "")).join("\n");
}

/**
 * 토큰 단위 비교. 숫자로 읽히는 토큰만 오차를 허용하고 나머지는 완전 일치를 본다.
 * 상대오차와 절대오차 중 하나만 만족하면 통과. 값이 0 근처일 때 상대오차만 보면
 * 사실상 완전 일치를 요구하게 되기 때문이다.
 */
function checkFloat(actual: string, expected: string, eps: number): CheckResult {
    const a = actual.split(/\s+/).filter(Boolean);
    const e = expected.split(/\s+/).filter(Boolean);
    if (a.length !== e.length) {
        return { ok: false, detail: `토큰 개수가 다름: 출력 ${a.length}, 정답 ${e.length}` };
    }
    for (let i = 0; i < e.length; i++) {
        const av = a[i]!;
        const ev = e[i]!;
        if (av === ev) continue;
        const an = Number(av);
        const en = Number(ev);
        if (!Number.isFinite(an) || !Number.isFinite(en)) {
            return { ok: false, detail: `토큰 ${i}: 출력 ${trunc(av)}, 정답 ${trunc(ev)}` };
        }
        const diff = Math.abs(an - en);
        if (diff <= eps) continue;
        if (diff <= eps * Math.abs(en)) continue;
        return { ok: false, detail: `토큰 ${i}: 출력 ${av}, 정답 ${ev} (오차 ${diff})` };
    }
    return { ok: true };
}

function firstDiff(a: string, e: string): string {
    const al = a.split("\n");
    const el = e.split("\n");
    const n = Math.max(al.length, el.length);
    for (let i = 0; i < n; i++) {
        if (al[i] !== el[i]) {
            return `${i + 1}번째 줄: 출력 ${trunc(al[i] ?? "(없음)")}, 정답 ${trunc(el[i] ?? "(없음)")}`;
        }
    }
    return "길이만 다름";
}

function trunc(s: string, n = 80): string {
    return s.length > n ? s.slice(0, n) + "..." : s;
}

/**
 * 스페셜 저지의 실행 규약.
 *
 * testlib 을 쓰지 않는다. 그건 체커 소스가 testlib.h 를 포함해야 하고 이미지에 그 헤더를
 * 넣어야 한다. 답이 여러 개인 문제를 내려고 헤더 하나를 이미지에 박는 건 과하다.
 *
 * 대신 규약을 최소로 정한다. 체커는 argv 로 파일 세 개를 받는다.
 *
 *   argv[1]  입력       테스트케이스의 입력
 *   argv[2]  기대 출력   출제자가 넣은 정답 파일
 *   argv[3]  제출 출력   학생 프로그램이 낸 것
 *
 * 판정은 종료 코드로 한다.
 *
 *   0        정답
 *   1        오답
 *   그 외     채점 오류. 체커가 잘못된 것이지 학생이 틀린 게 아니다
 *
 * 종료 코드를 쓰는 이유는 stdout 파싱보다 오해할 여지가 적어서다. 체커가 죽거나 시간
 * 초과가 나면 그 자체로 0 이 아닌 값이 되므로, 따로 다룰 필요 없이 채점 오류가 된다.
 * 오답을 1 로 못 박는 것도 같은 이유다. 체커가 우연히 0 을 내서 틀린 답이 통과하는 일이
 * 없어야 한다.
 *
 * 체커의 stderr 은 운영자에게만 보인다. 왜 틀렸는지 적어 두면 문제를 고칠 때 쓸모가 있다.
 */
export const CHECKER_EXIT = {
    accepted: 0,
    wrongAnswer: 1,
} as const;

/** 체커에 넘길 파일 이름. 샌드박스 안의 상대 경로다 */
export const CHECKER_FILES = {
    input: "checker.in",
    expected: "checker.ans",
    actual: "checker.out",
} as const;

/** 체커 소스 길이 상한. 채점기를 대신 돌리는 프로그램이라 길 이유가 없다 */
export const MAX_CHECKER_BYTES = 64 * 1024;
