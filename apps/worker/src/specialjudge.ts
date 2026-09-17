import fs from "node:fs/promises";
import path from "node:path";
import {
    requireLanguage,
    CHECKER_EXIT,
    CHECKER_FILES,
    type LanguageSpec,
    type StepLimits,
} from "@ojik/core";
import * as isolate from "./isolate";
import type { RunnerPool, Box } from "./pool";

/**
 * 스페셜 저지.
 *
 * 출제자가 쓴 체커 프로그램이 판정한다. 답이 여러 개인 문제(아무 최단 경로나, 조건을
 * 만족하는 아무 배치나)는 문자열 비교로 채점이 안 된다.
 *
 * 체커도 학생 코드와 같은 샌드박스에서 돈다. 출제자가 쓴 것이니 믿어도 될 것 같지만,
 * 무한 루프나 메모리 폭주는 악의가 없어도 일어난다. 그게 워커를 멈추면 다른 사람의 채점까지
 * 같이 선다.
 *
 * 체커는 제출당 한 번 컴파일하고 케이스마다 실행한다. 케이스마다 컴파일하면 케이스 20개짜리
 * 문제에서 컴파일이 채점보다 오래 걸린다.
 */

/** 체커가 잘못된 것이지 학생이 틀린 게 아닐 때 */
export class CheckerError extends Error {}

/**
 * 체커 실행 제한.
 *
 * 학생 프로그램의 제한과 따로 둔다. 체커는 보통 출력을 훑기만 하므로 넉넉할 이유가 없고,
 * 문제의 시간 제한을 따라가게 하면 제한이 빡빡한 문제에서 체커가 먼저 끊긴다.
 */
const CHECKER_LIMITS: StepLimits = {
    timeMs: 10_000,
    wallMs: 20_000,
    memoryKb: 512 * 1024,
    procLimit: 1,
};

export interface PreparedChecker {
    lang: LanguageSpec;
    /** 체커 전용 박스. 학생 코드가 쓰는 박스와 겹치면 안 된다 */
    box: Box;
}

/**
 * 체커를 컴파일한다. 실패하면 CheckerError 를 던진다.
 *
 * 컴파일 실패를 학생에게 compile_error 로 보이면 안 된다. 학생 코드는 멀쩡한데 출제자가
 * 체커를 잘못 쓴 것이다. 채점 오류로 올려서 운영자가 보게 한다.
 *
 * 체커는 학생 코드와 다른 박스를 쓴다. 컴파일 argv 가 lang.sourceName 에 박혀 있어서
 * (Main.c, Main.java) 같은 박스에 두면 서로 덮어쓴다.
 */
export async function prepareChecker(
    pool: RunnerPool,
    box: Box,
    source: string,
    languageId: string,
    compileFn: (pool: RunnerPool, box: Box, lang: LanguageSpec, src: string) => Promise<string | null>,
): Promise<PreparedChecker> {
    const lang = requireLanguage(languageId);
    const err = await compileFn(pool, box, lang, source);
    if (err !== null) throw new CheckerError(`체커 컴파일 실패:\n${err}`);
    return { lang, box };
}

/**
 * 케이스 하나를 체커로 판정한다.
 *
 * 체커 박스에 입력, 기대 출력, 제출 출력 세 파일을 넣고 argv 로 그 이름을 넘긴다.
 * 학생 프로그램이 쓰던 박스에 두지 않는 건, 학생 코드가 그 파일을 덮어쓸 수 있어서다.
 */
export async function runChecker(
    pool: RunnerPool,
    checker: PreparedChecker,
    files: { input: Buffer; expected: Buffer; actual: Buffer },
    memoryLimitMb: number,
): Promise<{ ok: boolean; detail: string }> {
    const box = checker.box;

    await fs.writeFile(path.join(box.hostDir, CHECKER_FILES.input), files.input);
    await fs.writeFile(path.join(box.hostDir, CHECKER_FILES.expected), files.expected);
    await fs.writeFile(path.join(box.hostDir, CHECKER_FILES.actual), files.actual);
    await fs.rm(path.join(box.hostDir, "checkerrun.err"), { force: true });

    const metaName = "checkrun.meta";
    const args = isolate.runArgs({
        boxId: box.boxId,
        argv: [
            ...checker.lang.run.argv.map((a) => a.replace("{memMb}", String(memoryLimitMb))),
            CHECKER_FILES.input,
            CHECKER_FILES.expected,
            CHECKER_FILES.actual,
        ],
        limits: CHECKER_LIMITS,
        /*
         * 체커의 stdout 을 CHECKER_FILES.actual 과 다른 이름으로 받는다.
         *
         * 같은 이름이면 isolate 가 리다이렉트로 그 파일을 열면서 비운다. 체커가 읽어야 할
         * 제출 출력이 사라져서 빈 파일을 보게 되고, 맞는 답도 오답이 된다. 실제로 그랬다.
         */
        stdoutFile: "checkerrun.out",
        stderrFile: "checkerrun.err",
        // 컨테이너 안에서 본 meta 자리. judge.ts 의 containerPath 와 같은 규칙이다
        metaPath: `/var/local/lib/isolate/${box.boxId}/${metaName}`,
        // 체커가 큰 파일을 만들 이유가 없다. 폭주를 파일 단계에서 끊는다
        fsizeKb: 4 * 1024,
    });

    await pool.exec(box, ["isolate", ...args]);
    const meta = isolate.parseMeta(await read(path.join(box.hostMetaDir, metaName)));
    const detail = (await read(path.join(box.hostDir, "checkerrun.err"))).trim().slice(0, 4096);

    /*
     * 종료 코드로 판정한다.
     *
     * isolate 는 정상 종료(0)면 status 와 exitcode 를 아예 안 적는다. 0 이 아닌 종료는
     * status=RE 에 exitcode 를 적는다. 그래서 "status 가 없으면 0" 으로 읽어야 한다.
     * exitcode 만 보면 정답인 경우가 null 이라 못 가른다.
     *
     * 시간 초과(TO)와 시그널(SG)은 exitcode 가 없다. 아래 채점 오류로 떨어진다.
     */
    if (meta.status === null) return { ok: true, detail };
    if (meta.status === "RE" && meta.exitcode === CHECKER_EXIT.wrongAnswer) return { ok: false, detail };

    const why =
        meta.status === "TO"
            ? "시간 초과"
            : meta.status === "SG"
              ? `시그널 ${meta.exitsig ?? "?"} 로 종료`
              : meta.status === "XX"
                ? `샌드박스 오류: ${meta.message}`
                : `종료 코드 ${meta.exitcode ?? "?"}`;

    throw new CheckerError(
        [
            `체커가 규약을 벗어났습니다 (${why}).`,
            "  0 은 정답, 1 은 오답입니다. 그 외는 전부 채점 오류로 봅니다.",
            detail ? `  체커 stderr: ${detail}` : "",
        ]
            .filter(Boolean)
            .join("\n"),
    );
}

async function read(p: string): Promise<string> {
    try {
        return await fs.readFile(p, "utf8");
    } catch {
        return "";
    }
}
