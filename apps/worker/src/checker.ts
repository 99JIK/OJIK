import type { CheckerType } from "@ojik/core";

/**
 * 출력 비교. 문제마다 규칙을 고를 수 있게 한다.
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
