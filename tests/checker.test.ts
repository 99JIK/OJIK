import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../apps/worker/src/checker";
import { worstVerdict, effectiveRunLimits, requireLanguage, resolveRunArgv } from "@ojik/core";

const buf = (s: string) => Buffer.from(s, "utf8");

test("trim: 줄 끝 공백과 마지막 개행을 무시한다", () => {
    assert.equal(check("trim", buf("3\n"), buf("3"), 0).ok, true);
    assert.equal(check("trim", buf("3   \n\n\n"), buf("3\n"), 0).ok, true);
    assert.equal(check("trim", buf("1 2\r\n3\r\n"), buf("1 2\n3\n"), 0).ok, true);
});

test("trim: 줄 안쪽 공백은 무시하지 않는다", () => {
    // 여기까지 봐주면 "1 2" 와 "12" 가 같아진다. 그건 틀린 판정이다
    assert.equal(check("trim", buf("1 2\n"), buf("12\n"), 0).ok, false);
});

test("exact: 마지막 개행 하나도 다르면 틀린다", () => {
    assert.equal(check("exact", buf("3\n"), buf("3"), 0).ok, false);
    assert.equal(check("exact", buf("3\n"), buf("3\n"), 0).ok, true);
});

test("float: 절대오차와 상대오차 중 하나만 만족하면 통과", () => {
    const eps = 1e-6;
    assert.equal(check("float", buf("1.0000001"), buf("1.0"), eps).ok, true);
    assert.equal(check("float", buf("1.1"), buf("1.0"), eps).ok, false);
    // 0 근처에서 상대오차만 보면 사실상 완전 일치를 요구하게 된다. 절대오차가 구해 줘야 함
    assert.equal(check("float", buf("0.0000001"), buf("0.0"), eps).ok, true);
    // 큰 값에서는 절대오차로는 못 맞추고 상대오차가 구해 줘야 함
    assert.equal(check("float", buf("1000000.5"), buf("1000000.0"), 1e-6).ok, true);
});

test("float: 토큰 개수가 다르면 틀린다", () => {
    assert.equal(check("float", buf("1 2"), buf("1 2 3"), 1e-6).ok, false);
});

test("float: 숫자가 아닌 토큰은 완전 일치를 본다", () => {
    assert.equal(check("float", buf("YES 1.0"), buf("YES 1.0"), 1e-6).ok, true);
    assert.equal(check("float", buf("yes 1.0"), buf("YES 1.0"), 1e-6).ok, false);
});

test("worstVerdict: 가장 나쁜 하나가 제출의 판정이 된다", () => {
    assert.equal(worstVerdict(["accepted", "accepted"]), "accepted");
    // 시간 초과가 오답으로 뭉개지면 안 된다. KOJ 가 이걸 못 했다
    assert.equal(worstVerdict(["accepted", "wrong_answer", "time_limit_exceeded"]), "time_limit_exceeded");
    assert.equal(worstVerdict(["wrong_answer", "runtime_error"]), "runtime_error");
    assert.equal(worstVerdict(["accepted", "internal_error"]), "internal_error");
    // 결과가 하나도 없으면 정답일 리 없다
    assert.equal(worstVerdict([]), "internal_error");
});

test("언어 보정: C 는 그대로, 인터프리터는 늘어난다", () => {
    const c = effectiveRunLimits(requireLanguage("c"), 1000, 256);
    assert.equal(c.timeMs, 1000);
    assert.equal(c.memoryKb, 256 * 1024);

    const py = effectiveRunLimits(requireLanguage("python3"), 1000, 256);
    assert.equal(py.timeMs, 1000 * 3 + 2000);
    assert.ok(py.memoryKb > 256 * 1024);

    // 벽시계는 CPU 상한보다 항상 커야 한다. 안 그러면 정상 풀이가 벽시계에 먼저 걸린다
    assert.ok(py.wallMs > py.timeMs);
});

test("Java 는 스레드가 여러 개 필요하다", () => {
    // procLimit 이 1 이면 JVM 이 GC 스레드를 못 띄워 전 제출이 런타임 에러가 된다
    assert.ok(requireLanguage("java").run.procLimit > 1);
});

test("resolveRunArgv: JVM 힙이 문제 제한으로 치환된다", () => {
    const argv = resolveRunArgv(requireLanguage("java"), 512);
    assert.ok(argv.includes("-Xmx512m"), argv.join(" "));
    assert.ok(!argv.some((a) => a.includes("{memMb}")), "치환 안 된 자리가 남음");
});

test("requireLanguage: 모르는 언어는 조용히 통과시키지 않는다", () => {
    // KOJ 채점 이미지는 여기서 nil 을 반환해 다음 줄에서 죽었다
    assert.throws(() => requireLanguage("rust"), /unsupported language/);
});
