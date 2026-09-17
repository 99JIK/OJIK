import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
    shapesToSvg,
    svgToShapes,
    isOurSvg,
    shapeToSvg,
    type Shape,
} from "../apps/web/src/lib/svgshapes";
import { extractSvgAt, findSvgBlocks, replaceRange } from "../apps/web/src/lib/svgblock";

/**
 * 그림판의 순수 부분.
 *
 * 넣기와 되읽기가 같은 규칙을 반대로 쓰는 짝이라, 한쪽만 고치면 그림이 조용히 망가진다.
 * 왕복해서 같은 값이 나오는지가 여기서 제일 중요한 검사다.
 *
 * svgToShapes 가 DOMParser 를 쓰므로 jsdom 을 전역에 올린다.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.DOMParser = dom.window.DOMParser;

function roundTrip(shapes: Shape[]): Shape[] {
    return svgToShapes(shapesToSvg(shapes));
}

test("선이 왕복해도 그대로다", () => {
    const s: Shape[] = [{ kind: "line", color: "", width: 2, x1: 10, y1: 20, x2: 90, y2: 40 }];
    assert.deepEqual(roundTrip(s), s);
});

test("네모가 왕복해도 그대로다", () => {
    const s: Shape[] = [{ kind: "rect", color: "", width: 2, x1: 10, y1: 10, x2: 60, y2: 50 }];
    assert.deepEqual(roundTrip(s), s);
});

test("네모를 거꾸로 그려도 정규화된다", () => {
    // 오른쪽 아래에서 왼쪽 위로 끌어도 같은 네모여야 한다
    const back = roundTrip([{ kind: "rect", color: "", width: 2, x1: 60, y1: 50, x2: 10, y2: 10 }]);
    assert.deepEqual(back, [{ kind: "rect", color: "", width: 2, x1: 10, y1: 10, x2: 60, y2: 50 }]);
});

test("타원이 왕복해도 그대로다", () => {
    const s: Shape[] = [{ kind: "ellipse", color: "", width: 2, x1: 0, y1: 0, x2: 40, y2: 20 }];
    assert.deepEqual(roundTrip(s), s);
});

test("화살표가 왕복해도 그대로다", () => {
    // 화살촉은 그릴 때 만들어지는 것이라 되읽을 때는 선만 본다
    const s: Shape[] = [{ kind: "arrow", color: "", width: 2, x1: 0, y1: 0, x2: 50, y2: 50 }];
    assert.deepEqual(roundTrip(s), s);
});

test("자유선이 왕복해도 그대로다", () => {
    const s: Shape[] = [
        { kind: "pen", color: "", width: 2, points: [[0, 0], [10, 5], [20, 0]] },
    ];
    assert.deepEqual(roundTrip(s), s);
});

test("글자가 왕복해도 그대로다", () => {
    const s: Shape[] = [{ kind: "text", color: "", width: 2, x1: 10, y1: 20, text: "정점 A" }];
    assert.deepEqual(roundTrip(s), s);
});

test("색과 굵기가 왕복해도 그대로다", () => {
    const s: Shape[] = [{ kind: "line", color: "#ef4444", width: 4, x1: 0, y1: 0, x2: 10, y2: 10 }];
    assert.deepEqual(roundTrip(s), s);
});

test("기본 색과 굵기는 속성으로 안 적힌다", () => {
    // 용량 때문에 뺀다. 도형마다 stroke 와 stroke-width 를 적으면 본문이 금방 커진다
    const svg = shapeToSvg({ kind: "line", color: "", width: 2, x1: 0, y1: 0, x2: 1, y2: 1 });
    assert.ok(!svg.includes("stroke="), svg);
    assert.ok(!svg.includes("stroke-width="), svg);
});

test("도형 몇 개짜리 그림은 작다", () => {
    const shapes: Shape[] = Array.from({ length: 10 }, (_, i) => ({
        kind: "line" as const,
        color: "",
        width: 2,
        x1: i * 10,
        y1: 0,
        x2: i * 10,
        y2: 100,
    }));
    const bytes = new TextEncoder().encode(shapesToSvg(shapes)).length;
    assert.ok(bytes < 700, `${bytes}바이트`);
});

test("글자에 든 특수문자가 SVG 를 안 깨뜨린다", () => {
    const svg = shapesToSvg([{ kind: "text", color: "", width: 2, x1: 0, y1: 0, text: `a<b & c"d` }]);
    assert.ok(svg.includes("&lt;"), svg);
    assert.ok(svg.includes("&amp;"), svg);
    // 되읽으면 원문이 돌아온다
    assert.equal(svgToShapes(svg)[0]?.text, `a<b & c"d`);
});

test("우리가 만든 SVG 인지 알아본다", () => {
    assert.ok(isOurSvg(shapesToSvg([{ kind: "line", color: "", width: 2, x1: 0, y1: 0, x2: 1, y2: 1 }])));
    assert.ok(!isOurSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`));
    assert.ok(!isOurSvg("<p>그림 아님</p>"));
});

test("화살촉은 id 를 안 만든다", () => {
    // marker 를 쓰면 defs 와 id 가 생기고, 한 본문에 그림이 둘이면 id 가 부딪친다
    const svg = shapesToSvg([{ kind: "arrow", color: "", width: 2, x1: 0, y1: 0, x2: 10, y2: 10 }]);
    assert.ok(!svg.includes("id="), svg);
    assert.ok(!svg.includes("<defs"), svg);
});

test("본문에서 커서가 든 그림을 찾는다", () => {
    const svg = shapesToSvg([{ kind: "line", color: "", width: 2, x1: 0, y1: 0, x2: 1, y2: 1 }]);
    const text = `앞글\n\n${svg}\n\n뒷글`;
    const start = text.indexOf("<svg");

    assert.equal(extractSvgAt(text, start + 5)?.svg, svg);
    assert.equal(extractSvgAt(text, 2), null, "앞글에서는 안 잡혀야 한다");
    assert.equal(extractSvgAt(text, text.length - 1), null, "뒷글에서는 안 잡혀야 한다");
});

test("그림이 둘이면 커서가 든 쪽을 찾는다", () => {
    const a = shapesToSvg([{ kind: "line", color: "", width: 2, x1: 0, y1: 0, x2: 1, y2: 1 }]);
    const b = shapesToSvg([{ kind: "rect", color: "", width: 2, x1: 0, y1: 0, x2: 9, y2: 9 }]);
    const text = `${a}\n사이\n${b}`;

    assert.equal(findSvgBlocks(text).length, 2);
    assert.equal(extractSvgAt(text, 5)?.svg, a);
    assert.equal(extractSvgAt(text, text.length - 5)?.svg, b);
});

test("닫는 태그가 없으면 안 잡는다", () => {
    assert.deepEqual(findSvgBlocks("<svg viewBox='0 0 1 1'>"), []);
});

test("범위를 바꾸면 나머지는 그대로다", () => {
    const text = "앞<svg></svg>뒤";
    const b = findSvgBlocks(text)[0]!;
    assert.equal(replaceRange(text, b.start, b.end, "X"), "앞X뒤");
});
