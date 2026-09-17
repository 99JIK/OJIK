import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBulkProblems, parseCourseMarkdown, BULK_PROBLEM_SAMPLE, COURSE_SAMPLE } from "@ojik/core";

/**
 * 밖에서 만든 파일을 읽는 부분.
 *
 * 사람이 직접 쓰거나 스크립트로 만든 파일이라 별별 모양이 다 온다. 하나가 잘못됐다고
 * 전부 거부하면 50개짜리 파일에서 한 줄 때문에 다시 만들게 된다. 어디가 왜 잘못됐는지만
 * 알려 주고 나머지는 살리는 게 요점이다.
 */

test("문제 하나를 읽는다", () => {
    const r = parseBulkProblems('[{"title":"A+B","testcases":[{"input":"1 2","output":"3"}]}]');
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0]?.title, "A+B");
    assert.equal(r.items[0]?.testcases?.length, 1);
});

test("예시가 그대로 읽힌다", () => {
    const r = parseBulkProblems(BULK_PROBLEM_SAMPLE);
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0]?.testcases?.[0]?.isSample, true);
});

test("배열로 안 감싸도 받는다", () => {
    // 하나만 올릴 때 배열로 감싸는 걸 잊기 쉽다
    const r = parseBulkProblems('{"title":"하나만"}');
    assert.equal(r.items.length, 1);
    assert.equal(r.errors.length, 0);
});

test("JSON 이 깨지면 이유를 말한다", () => {
    const r = parseBulkProblems("{이건 JSON 이 아님");
    assert.equal(r.items.length, 0);
    assert.match(r.errors[0] ?? "", /JSON/);
});

test("제목 없는 문제만 걸러내고 나머지는 살린다", () => {
    const r = parseBulkProblems('[{"title":"좋음"},{"statement":"제목 없음"},{"title":"좋음2"}]');
    assert.equal(r.items.length, 2);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0] ?? "", /title/);
});

test("모르는 유형을 잡는다", () => {
    const r = parseBulkProblems('[{"title":"x","kind":"이상한거"}]');
    assert.equal(r.items.length, 0);
    assert.match(r.errors[0] ?? "", /kind/);
});

test("모르는 비교 방식을 잡는다", () => {
    const r = parseBulkProblems('[{"title":"x","checkerType":"대충"}]');
    assert.equal(r.items.length, 0);
    assert.match(r.errors[0] ?? "", /checkerType/);
});

test("테스트케이스에 output 이 없으면 그 문제를 버린다", () => {
    // 절반만 넣으면 채점이 이상해진다. 통째로 거부하고 어디가 문제인지 말한다
    const r = parseBulkProblems('[{"title":"x","testcases":[{"input":"1"}]}]');
    assert.equal(r.items.length, 0);
    assert.match(r.errors[0] ?? "", /테스트케이스/);
});

test("기본값이 채워진다", () => {
    const r = parseBulkProblems('[{"title":"x"}]');
    assert.equal(r.items[0]?.kind, "code");
    assert.equal(r.items[0]?.checkerType, "trim");
    assert.deepEqual(r.items[0]?.testcases, []);
});

test("교재 마크다운을 읽는다", () => {
    const r = parseCourseMarkdown(COURSE_SAMPLE);
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
    const kinds = r.items.map((i) => i.kind);
    assert.deepEqual(kinds, ["text", "problem", "problem", "text", "problem"]);
});

test("제목이 소제목이 된다", () => {
    const r = parseCourseMarkdown("# 1주차\n\n설명입니다.");
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0]?.kind, "text");
    assert.equal((r.items[0] as { heading: string }).heading, "1주차");
    assert.equal((r.items[0] as { body: string }).body, "설명입니다.");
});

test("제목만 있어도 항목으로 남는다", () => {
    // 구분선 노릇을 한다
    const r = parseCourseMarkdown("## 연습\n\n@problem 3");
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0]?.kind, "text");
    assert.equal(r.items[1]?.kind, "problem");
});

test("문제 참조가 순서대로 들어간다", () => {
    const r = parseCourseMarkdown("@problem 7\n설명\n@problem 8");
    assert.deepEqual(
        r.items.map((i) => (i.kind === "problem" ? i.problemId : "text")),
        [7, "text", 8],
    );
});

test("문제 번호가 아니면 잡는다", () => {
    const r = parseCourseMarkdown("@problem A+B");
    assert.equal(r.items.length, 0);
    assert.match(r.errors[0] ?? "", /문제 번호/);
});

test("빈 문서는 빈 결과", () => {
    assert.deepEqual(parseCourseMarkdown("").items, []);
    assert.deepEqual(parseCourseMarkdown("   \n\n  ").items, []);
});

test("코드 블록 안의 문장은 그대로 남는다", () => {
    const md = ["설명", "", "```c", "int main(){}", "```"].join("\n");
    const r = parseCourseMarkdown(md);
    assert.equal(r.items.length, 1);
    assert.match((r.items[0] as { body: string }).body, /int main/);
});
