import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * 마크다운 렌더링과 살균.
 *
 * DOM 이 필요해서 jsdom 을 쓴다. 브라우저를 띄우지 않고도 "스크립트가 정말 막히는지"와
 * "수식이 없을 때 KaTeX 를 안 받는지"를 확인할 수 있다. 후자가 번들 크기의 핵심이다.
 */

let renderMarkdown: (src: string) => Promise<{ html: string; hasDiagram: boolean }>;

before(async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    // DOMPurify 와 KaTeX 가 전역 DOM 을 본다
    Object.assign(globalThis, {
        window: dom.window,
        document: dom.window.document,
        Node: dom.window.Node,
        DocumentFragment: dom.window.DocumentFragment,
        HTMLElement: dom.window.HTMLElement,
    });
    ({ renderMarkdown } = await import("../apps/web/src/lib/markdown"));
});

async function html(src: string): Promise<string> {
    return (await renderMarkdown(src)).html;
}

test("기본 문법", async () => {
    assert.match(await html("**굵게** 와 *기울임*"), /<strong>굵게<\/strong>/);
    assert.match(await html("- 하나\n- 둘"), /<ul>/);
    assert.match(await html("| a | b |\n|---|---|\n| 1 | 2 |"), /<table>/);
    assert.match(await html("`scanf` 를 쓴다"), /<code>scanf<\/code>/);
    assert.match(await html("[보기](https://example.com)"), /href="https:\/\/example\.com"/);
});

test("script 태그를 지운다", async () => {
    const h = await html("안녕<script>alert(1)</script>");
    // 출제자가 외부에서 복사해 붙일 수 있다. 허용 목록 방식이라 통과할 수 없어야 한다
    assert.doesNotMatch(h, /<script/i);
});

test("이벤트 속성을 지운다", async () => {
    assert.doesNotMatch(await html('<img src="x" onerror="alert(1)">'), /onerror/i);
});

test("javascript: 링크를 지운다", async () => {
    assert.doesNotMatch(await html("[클릭](javascript:alert(1))"), /javascript:/i);
});

test("허용된 태그는 남긴다", async () => {
    assert.match(await html("<strong>진하게</strong>"), /<strong>진하게<\/strong>/);
});

test("수식이 있으면 렌더한다", async () => {
    assert.match(await html("값은 $a + b$ 이다"), /katex/);
    assert.match(await html("$$\sum_{i=1}^{n} i$$"), /katex/);
});

test("수식이 없으면 KaTeX 를 안 부른다", async () => {
    // 이게 깨지면 모든 문제 페이지가 250KB 를 더 받는다
    assert.doesNotMatch(await html("그냥 글"), /katex/);
    assert.doesNotMatch(await html("가격은 100$ 입니다"), /katex/);
});

test("마크다운이 수식 속 밑줄을 먹지 않는다", async () => {
    // $a_1 + a_2$ 에서 _1 + a_ 가 강조로 해석되면 식이 깨진다
    const h = await html("$a_1 + a_2$");
    assert.match(h, /katex/);
    assert.doesNotMatch(h, /<em>/);
});

test("깨진 수식은 원문을 보여준다", async () => {
    // 빈칸이 나오면 출제자가 뭐가 틀렸는지 모른다
    const h = await html("$\frac{1}{$");
    assert.ok(h.length > 0);
});

test("mermaid 블록을 자리표시자로 남긴다", async () => {
    const r = await renderMarkdown("```mermaid\ngraph TD; A-->B;\n```");
    assert.match(r.html, /ojik-mermaid/);
    assert.equal(r.hasDiagram, true);
});

test("도식이 없으면 hasDiagram 이 false", async () => {
    assert.equal((await renderMarkdown("글만 있음")).hasDiagram, false);
});

test("수식과 목록이 섞여도 안 깨진다", async () => {
    const h = await html("- 시간 복잡도는 $O(n \log n)$\n- 공간은 $O(n)$");
    assert.match(h, /<li>/);
    assert.match(h, /katex/);
});

test("빈 본문은 빈 결과", async () => {
    assert.equal(await html(""), "");
    assert.equal(await html("   "), "");
});
