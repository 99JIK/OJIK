import { PROBLEM_KINDS, type ProblemKind } from "./problemkind";
import { CHECKER_TYPES, type CheckerType } from "./limits";

/**
 * 밖에서 만든 파일로 문제와 교재를 한 번에 올린다.
 *
 * 화면에서 문제를 하나씩 등록하는 건 다섯 개만 넘어가도 못 할 짓이다. 출제자는 보통
 * 자기 에디터에서 문제를 쓰고 테스트케이스를 스크립트로 만든다. 그걸 그대로 올릴 수
 * 있어야 한다.
 *
 * 형식은 둘이다.
 *   문제   JSON 배열. 본문과 테스트케이스가 한 파일에 들어간다
 *   교재   마크다운 한 장. 설명 사이에 @problem 줄로 문제를 끼운다
 *
 * ZIP 은 안 쓴다. 압축을 풀려면 의존성이 하나 늘고, 폴더 구조 규칙을 또 설명해야 한다.
 * 테스트케이스가 아주 큰 문제는 지금도 화면에서 파일로 넣을 수 있다.
 */

export interface BulkTestcase {
    input: string;
    output: string;
    isSample?: boolean;
    points?: number;
}

export interface BulkProblem {
    title: string;
    statement?: string;
    inputDesc?: string;
    outputDesc?: string;
    hint?: string;
    timeLimitMs?: number;
    memoryLimitMb?: number;
    kind?: ProblemKind;
    checkerType?: CheckerType;
    floatEpsilon?: number;
    stopOnFirstFail?: boolean;
    isPublic?: boolean;
    difficulty?: number | null;
    testcases?: BulkTestcase[];
    /** kind=blank */
    blankTemplate?: string;
    blankLines?: number[];
    blankLanguage?: string;
    /** checkerType=special */
    checkerSource?: string;
    checkerLanguage?: string;
}

export interface BulkParse<T> {
    items: T[];
    /** 통째로 거부하지 않는다. 고칠 수 있게 어디가 왜 잘못됐는지 돌려준다 */
    errors: string[];
}

export const BULK_MAX_PROBLEMS = 100;

/** 붙여넣을 예시. 화면의 placeholder 로 쓴다 */
export const BULK_PROBLEM_SAMPLE = JSON.stringify(
    [
        {
            title: "A+B",
            statement: "두 정수를 입력받아 합을 출력하세요.",
            inputDesc: "한 줄에 두 정수 A, B",
            outputDesc: "A+B",
            timeLimitMs: 1000,
            memoryLimitMb: 256,
            testcases: [
                { input: "1 2\n", output: "3\n", isSample: true },
                { input: "5 7\n", output: "12\n" },
            ],
        },
    ],
    null,
    2,
);

/**
 * 문제 묶음 해석.
 *
 * 한 문제가 잘못돼도 나머지는 살린다. 50개짜리 파일에서 한 줄 때문에 전부 다시 만들게
 * 하면 안 된다.
 */
export function parseBulkProblems(text: string): BulkParse<BulkProblem> {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        return { items: [], errors: [`JSON 을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`] };
    }

    // 문제 하나만 올리는 경우도 받는다. 배열로 감싸는 걸 잊기 쉽다
    const list = Array.isArray(raw) ? raw : [raw];
    const items: BulkProblem[] = [];
    const errors: string[] = [];

    list.forEach((entry, i) => {
        const at = `${i + 1}번째 문제`;
        if (typeof entry !== "object" || entry === null) {
            errors.push(`${at}: 객체가 아닙니다`);
            return;
        }
        const p = entry as Record<string, unknown>;

        const title = typeof p.title === "string" ? p.title.trim() : "";
        if (!title) {
            errors.push(`${at}: title 이 없습니다`);
            return;
        }
        if (p.kind !== undefined && !PROBLEM_KINDS.includes(p.kind as ProblemKind)) {
            errors.push(`${at} (${title}): 모르는 kind "${String(p.kind)}"`);
            return;
        }
        if (p.checkerType !== undefined && !CHECKER_TYPES.includes(p.checkerType as CheckerType)) {
            errors.push(`${at} (${title}): 모르는 checkerType "${String(p.checkerType)}"`);
            return;
        }

        const tcsRaw = Array.isArray(p.testcases) ? p.testcases : [];
        const testcases: BulkTestcase[] = [];
        let tcBad = false;
        tcsRaw.forEach((t, j) => {
            const tc = t as Record<string, unknown>;
            if (typeof tc?.input !== "string" || typeof tc?.output !== "string") {
                errors.push(`${at} (${title}): ${j + 1}번 테스트케이스에 input 이나 output 이 없습니다`);
                tcBad = true;
                return;
            }
            testcases.push({
                input: tc.input,
                output: tc.output,
                isSample: tc.isSample === true,
                points: typeof tc.points === "number" ? tc.points : 0,
            });
        });
        if (tcBad) return;

        items.push({
            title,
            statement: str(p.statement),
            inputDesc: str(p.inputDesc),
            outputDesc: str(p.outputDesc),
            hint: str(p.hint) || undefined,
            timeLimitMs: num(p.timeLimitMs),
            memoryLimitMb: num(p.memoryLimitMb),
            kind: (p.kind as ProblemKind) ?? "code",
            checkerType: (p.checkerType as CheckerType) ?? "trim",
            floatEpsilon: num(p.floatEpsilon),
            stopOnFirstFail: p.stopOnFirstFail === undefined ? undefined : p.stopOnFirstFail === true,
            isPublic: p.isPublic === true,
            difficulty: typeof p.difficulty === "number" ? p.difficulty : null,
            testcases,
            blankTemplate: str(p.blankTemplate) || undefined,
            blankLines: Array.isArray(p.blankLines) ? p.blankLines.filter((n): n is number => typeof n === "number") : undefined,
            blankLanguage: str(p.blankLanguage) || undefined,
            checkerSource: str(p.checkerSource) || undefined,
            checkerLanguage: str(p.checkerLanguage) || undefined,
        });
    });

    return { items, errors };
}

function str(v: unknown): string {
    return typeof v === "string" ? v : "";
}
function num(v: unknown): number | undefined {
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/* ------------------------------------------------------------------ */

export type CourseItem =
    | { kind: "text"; heading: string | null; body: string }
    | { kind: "problem"; problemId: number };

export const COURSE_SAMPLE = [
    "# 1주차 입출력",
    "",
    "표준 입력으로 받은 값을 그대로 다루는 연습입니다.",
    "수식도 됩니다: $O(n)$",
    "",
    "@problem 1",
    "@problem 2",
    "",
    "## 조금 더",
    "",
    "여러 줄 입력을 다뤄 봅니다.",
    "",
    "@problem 5",
].join("\n");

/**
 * 교재 마크다운 해석.
 *
 * 설명 문단 사이에 `@problem <문제번호>` 줄을 끼우면 그 자리에 문제가 들어간다.
 * 글을 쓰다가 문제를 끼우는 순서 그대로 화면에 나온다.
 *
 * 제목 줄(#, ##)은 바로 뒤에 오는 설명 덩어리의 소제목이 된다. 목차에 그 제목이 쓰인다.
 * 제목만 있고 설명이 없어도 항목 하나로 남긴다. 구분선 노릇을 하기 때문이다.
 *
 * 문제 번호로 참조한다. 제목으로 찾게 하면 같은 제목이 둘일 때 어느 것인지 알 수 없다.
 * 번호는 문제 목록에서 본다.
 */
export function parseCourseMarkdown(text: string): BulkParse<CourseItem> {
    const items: CourseItem[] = [];
    const errors: string[] = [];

    let heading: string | null = null;
    let buf: string[] = [];

    const flush = () => {
        const body = buf.join("\n").trim();
        if (body || heading) items.push({ kind: "text", heading, body });
        heading = null;
        buf = [];
    };

    const lines = text.replace(/^﻿/, "").split(/\r\n?|\n/);
    lines.forEach((line, i) => {
        const at = `${i + 1}줄`;

        const prob = /^@problem\s+(\S+)\s*$/.exec(line.trim());
        if (prob) {
            flush();
            const id = Number(prob[1]);
            if (!Number.isInteger(id) || id <= 0) {
                errors.push(`${at}: "${prob[1]}" 은 문제 번호가 아닙니다. @problem 12 처럼 씁니다`);
                return;
            }
            items.push({ kind: "problem", problemId: id });
            return;
        }

        const head = /^(#{1,6})\s+(.*)$/.exec(line);
        if (head) {
            // 새 제목이 나오면 앞 덩어리를 끊는다. 제목 하나에 문단 하나가 붙는다
            flush();
            heading = head[2]!.trim();
            return;
        }

        buf.push(line);
    });
    flush();

    return { items, errors };
}
