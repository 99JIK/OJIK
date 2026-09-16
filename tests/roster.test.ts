import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoster, makeTempPassword, resultCsv, ROSTER_SAMPLE } from "@ojik/core";

/**
 * 명단 파일 해석.
 *
 * 사람이 엑셀에서 만들어 올리는 파일이라 별별 모양이 다 온다. 통째로 거부하지 않고
 * 어느 줄이 왜 잘못됐는지 알려 주는 게 중요하다. 500명 명단에서 한 줄 때문에 전부
 * 다시 올리게 하면 안 된다.
 */

test("기본 모양을 읽는다", () => {
    const r = parseRoster("a01,a01@example.com,홍길동");
    assert.equal(r.errors.length, 0);
    assert.deepEqual(r.rows, [{ handle: "a01", email: "a01@example.com", name: "홍길동", line: 1 }]);
});

test("헤더 줄을 건너뛴다", () => {
    const r = parseRoster("handle,email,name\na01,a01@example.com,홍길동");
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0]?.handle, "a01");
});

test("한글 헤더도 알아본다", () => {
    const r = parseRoster("아이디,이메일,이름\na01,a01@example.com,홍길동");
    assert.equal(r.rows.length, 1);
});

test("헤더가 없어도 된다", () => {
    const r = parseRoster("a01,a01@example.com,홍길동\na02,a02@example.com,김영희");
    assert.equal(r.rows.length, 2);
});

test("예시 파일이 그대로 읽힌다", () => {
    const r = parseRoster(ROSTER_SAMPLE);
    assert.equal(r.errors.length, 0);
    assert.equal(r.rows.length, 2);
});

test("이름에 든 쉼표를 따옴표로 감싸면 살아남는다", () => {
    const r = parseRoster('a01,a01@example.com,"홍, 길동"');
    assert.equal(r.rows[0]?.name, "홍, 길동");
});

test("따옴표 두 개는 따옴표 하나다", () => {
    const r = parseRoster('a01,a01@example.com,"그는 ""길동"" 이다"');
    assert.equal(r.rows[0]?.name, '그는 "길동" 이다');
});

test("탭으로 나눈 것도 읽는다", () => {
    // 엑셀에서 복사해 붙이면 탭으로 온다
    const r = parseRoster("a01\ta01@example.com\t홍길동");
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0]?.email, "a01@example.com");
});

test("BOM 을 걷어낸다", () => {
    // 엑셀이 UTF-8 CSV 로 저장하면 앞에 붙는다
    const r = parseRoster("﻿a01,a01@example.com,홍길동");
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
    assert.equal(r.rows[0]?.handle, "a01");
});

test("빈 줄은 건너뛴다", () => {
    const r = parseRoster("a01,a01@example.com,\n\n\na02,a02@example.com,");
    assert.equal(r.rows.length, 2);
    assert.equal(r.errors.length, 0);
});

test("이름은 비워도 된다", () => {
    const r = parseRoster("a01,a01@example.com");
    assert.equal(r.errors.length, 0);
    assert.equal(r.rows[0]?.name, "");
});

test("잘못된 줄만 걸러내고 나머지는 살린다", () => {
    const r = parseRoster(["a01,a01@example.com,좋음", "한글아이디,b@example.com,나쁨", "a02,a02@example.com,좋음"].join("\n"));
    assert.equal(r.rows.length, 2, "멀쩡한 두 줄은 살아야 한다");
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0]?.line, 2);
});

test("주소 모양이 아니면 잡는다", () => {
    const r = parseRoster("a01,이건주소아님,홍길동");
    assert.equal(r.rows.length, 0);
    assert.match(r.errors[0]?.message ?? "", /이메일/);
});

test("파일 안에서 겹치는 아이디를 잡는다", () => {
    const r = parseRoster("a01,x@example.com,\nA01,y@example.com,");
    assert.equal(r.rows.length, 1, "대소문자만 다른 것도 같은 아이디다");
    assert.match(r.errors[0]?.message ?? "", /겹칩니다/);
});

test("파일 안에서 겹치는 이메일을 잡는다", () => {
    const r = parseRoster("a01,x@example.com,\na02,X@example.com,");
    assert.equal(r.rows.length, 1);
    assert.match(r.errors[0]?.message ?? "", /겹칩니다/);
});

test("임시 비밀번호에 헷갈리는 글자가 없다", () => {
    // 종이에 적어 나눠 주거나 불러 주는 상황이라 0 과 O, 1 과 l 이 섞이면 안 된다
    for (let i = 0; i < 50; i++) {
        const pw = makeTempPassword();
        assert.equal(pw.length, 12);
        assert.ok(!/[0O1lI]/.test(pw), pw);
    }
});

test("임시 비밀번호는 매번 다르다", () => {
    const set = new Set(Array.from({ length: 50 }, () => makeTempPassword()));
    assert.ok(set.size > 45, `${set.size}`);
});

test("결과 CSV 가 엑셀에서 안 깨진다", () => {
    const csv = resultCsv([{ handle: "a01", email: "a@example.com", name: "홍길동", password: "abc" }]);
    assert.ok(csv.startsWith("﻿"), "BOM 이 있어야 한글이 안 깨진다");
    assert.match(csv, /handle,email,name,password/);
    assert.match(csv, /a01,a@example\.com,홍길동,abc/);
});

test("결과 CSV 가 쉼표 든 이름을 감싼다", () => {
    const csv = resultCsv([{ handle: "a01", email: "a@example.com", name: "홍, 길동", password: "abc" }]);
    assert.match(csv, /"홍, 길동"/);
});
