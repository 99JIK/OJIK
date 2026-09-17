import { test } from "node:test";
import assert from "node:assert/strict";
import { SOLUTION_LIMITS, dailyWriteLimit, containsLink } from "@ojik/core";

/**
 * 풀이 공유의 순수 규칙. DB 가 필요 없다.
 *
 * 한도 계산과 링크 판별은 값이 바뀌면 조용히 정책이 달라지는 자리라, 경계를 박아 둔다.
 */

test("하루 한도는 기본값에서 시작한다", () => {
    assert.equal(dailyWriteLimit(0), SOLUTION_LIMITS.dailyBase);
    assert.equal(dailyWriteLimit(9), SOLUTION_LIMITS.dailyBase);
});

test("맞힌 수 10당 1씩 는다", () => {
    assert.equal(dailyWriteLimit(10), SOLUTION_LIMITS.dailyBase + 1);
    assert.equal(dailyWriteLimit(19), SOLUTION_LIMITS.dailyBase + 1);
    assert.equal(dailyWriteLimit(20), SOLUTION_LIMITS.dailyBase + 2);
});

test("아무리 많이 풀어도 상한을 안 넘는다", () => {
    assert.equal(dailyWriteLimit(1000), SOLUTION_LIMITS.dailyMax);
    assert.equal(dailyWriteLimit(100_000), SOLUTION_LIMITS.dailyMax);
});

test("상한에 닿는 지점", () => {
    // dailyBase + solved/10 이 dailyMax 가 되는 첫 값
    const need = (SOLUTION_LIMITS.dailyMax - SOLUTION_LIMITS.dailyBase) * SOLUTION_LIMITS.dailyPerSolved;
    assert.equal(dailyWriteLimit(need), SOLUTION_LIMITS.dailyMax);
    assert.equal(dailyWriteLimit(need - SOLUTION_LIMITS.dailyPerSolved), SOLUTION_LIMITS.dailyMax - 1);
});

test("한도는 음수 입력에도 기본값 아래로 안 내려간다", () => {
    // solvedCount 는 음수가 될 일이 없지만, recount 버그로 음수가 와도 0 이나 음수 한도를 주면 안 된다
    assert.ok(dailyWriteLimit(-5) <= SOLUTION_LIMITS.dailyBase);
    assert.ok(dailyWriteLimit(0) >= 1);
});

test("벌거벗은 URL 을 링크로 본다", () => {
    assert.ok(containsLink("여기 참고 https://example.com/a"));
    assert.ok(containsLink("http://example.com"));
    assert.ok(containsLink("www.example.com 보세요"));
});

test("마크다운 링크를 링크로 본다", () => {
    assert.ok(containsLink("[여기](https://example.com)"));
    assert.ok(containsLink("[메일](mailto:a@b.c)"));
});

test("보통 글은 링크가 아니다", () => {
    assert.ok(!containsLink("이분 탐색으로 풀었습니다. O(n log n) 입니다."));
    assert.ok(!containsLink("a[i] = b[j] 로 두면 됩니다"));
    assert.ok(!containsLink("시간 3.5초, 메모리 128MB"));
});

test("코드 블록 안의 배열 접근을 링크로 오인하지 않는다", () => {
    const src = ["```cpp", "for (int i = 0; i < n; i++) dp[i] = dp[i - 1] + a[i];", "```"].join("\n");
    assert.ok(!containsLink(src));
});

test("대소문자를 가리지 않는다", () => {
    assert.ok(containsLink("HTTPS://EXAMPLE.COM"));
    assert.ok(containsLink("WWW.EXAMPLE.COM"));
});
