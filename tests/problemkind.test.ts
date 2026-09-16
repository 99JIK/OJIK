import { test } from "node:test";
import assert from "node:assert/strict";
import {
    fillBlanks,
    blankOut,
    encodeAnswers,
    decodeAnswers,
    needsJudge,
    canAssist,
    check,
    gradeAnswer,
} from "@ojik/core";

/**
 * 문제 유형의 순수 규칙.
 *
 * 빈칸은 원본에 채운 줄을 끼우는 일이고, 출제자가 보는 줄 번호와 코드의 인덱스가
 * 하나 어긋나기 쉬운 자리다. 단답형은 제출 하나에 답이 여러 개라 직렬화가 왕복해야 한다.
 */

test("빈칸을 채우면 그 줄만 바뀐다", () => {
    const t = "a\nb\nc";
    assert.equal(fillBlanks(t, [2], { 2: "X" }), "a\nX\nc");
});

test("줄 번호는 1 부터 센다", () => {
    // 사람이 에디터에서 보는 번호와 같아야 출제자가 안 헷갈린다
    const t = "first\nsecond";
    assert.equal(fillBlanks(t, [1], { 1: "Z" }), "Z\nsecond");
});

test("안 채운 칸은 빈 줄이 된다", () => {
    // 컴파일 에러가 나겠지만 그게 맞는 결과다. 원본을 되살리면 안 푼 사람이 통과한다
    assert.equal(fillBlanks("a\nb\nc", [2], {}), "a\n\nc");
});

test("원본 줄 수를 넘는 번호는 무시한다", () => {
    // 출제자가 코드를 줄이고 줄 번호를 안 고친 경우. 채점이 통째로 죽는 것보다 낫다
    assert.equal(fillBlanks("a\nb", [5], { 5: "X" }), "a\nb");
    assert.equal(fillBlanks("a\nb", [0], { 0: "X" }), "a\nb");
});

test("여러 칸을 한 번에 채운다", () => {
    assert.equal(fillBlanks("1\n2\n3\n4", [2, 4], { 2: "B", 4: "D" }), "1\nB\n3\nD");
});

test("학생에게 보여 줄 코드는 비운 줄이 지워진다", () => {
    assert.deepEqual(blankOut("a\nb\nc", [2]), ["a", "", "c"]);
});

test("빈칸이 없으면 원본 그대로", () => {
    assert.deepEqual(blankOut("a\nb", []), ["a", "b"]);
    assert.equal(fillBlanks("a\nb", [], {}), "a\nb");
});

test("단답형 답이 왕복해도 그대로다", () => {
    const a = { 0: "O(n log n)", 1: "스택", 2: "" };
    assert.deepEqual(decodeAnswers(encodeAnswers(a)), a);
});

test("답에 든 줄바꿈과 따옴표가 살아남는다", () => {
    const a = { 0: '첫 줄\n둘째 "인용"' };
    assert.deepEqual(decodeAnswers(encodeAnswers(a)), a);
});

test("깨진 답 묶음은 빈 것으로 읽는다", () => {
    // 옛 제출이나 손으로 넣은 행을 만나도 채점이 죽으면 안 된다
    assert.deepEqual(decodeAnswers("이건 JSON 이 아님"), {});
    assert.deepEqual(decodeAnswers("null"), {});
    assert.deepEqual(decodeAnswers('{"answers": 3}'), {});
});

test("단답형만 채점기를 안 탄다", () => {
    assert.equal(needsJudge("code"), true);
    assert.equal(needsJudge("blank"), true);
    assert.equal(needsJudge("answer"), false);
});

test("조교 이상 판정", () => {
    assert.equal(canAssist("member"), false);
    assert.equal(canAssist("ta"), true);
    assert.equal(canAssist("manager"), true);
    assert.equal(canAssist(null), false);
    assert.equal(canAssist(undefined), false);
});

test("단답형은 양끝 공백을 무시한다", () => {
    // checker 의 trim 은 줄 끝 공백만 없앤다. 앞 공백은 프로그램 출력에서 뜻을 가질 수
    // 있어서 남기는데, 한 줄짜리 답에서는 그냥 오타다
    const buf = (s: string) => Buffer.from(s, "utf8");
    assert.equal(check("trim", buf(" 스택"), buf("스택"), 1e-6).ok, false, "checker 는 앞 공백을 남긴다");
    assert.equal(gradeAnswer("trim", " 스택 ", "스택", 1e-6), true);
    assert.equal(gradeAnswer("exact", " 스택 ", "스택", 1e-6), true);
});

test("단답형도 문제의 비교 규칙을 그대로 쓴다", () => {
    // 코드 제출과 단답형이 서로 다른 규칙으로 맞다고 하면 설명할 수가 없다
    assert.equal(gradeAnswer("exact", "스택", "큐", 1e-6), false);
    assert.equal(gradeAnswer("exact", "Stack", "stack", 1e-6), false, "exact 는 대소문자를 가린다");
    assert.equal(gradeAnswer("float", "3.14159", "3.1416", 1e-3), true);
    assert.equal(gradeAnswer("float", "3.1", "3.1416", 1e-6), false);
});
