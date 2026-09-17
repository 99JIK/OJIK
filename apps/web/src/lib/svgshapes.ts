/**
 * 그림판이 다루는 도형과 SVG 문자열 사이의 변환.
 *
 * 화면과 떼어 둔 이유는 둘이다. 하나는 테스트, 다른 하나는 되읽기다. 그림판이 넣은
 * SVG 를 다시 열어 고치려면 SVG 를 도형 목록으로 되돌려야 하는데, 그건 넣을 때 쓴
 * 규칙을 그대로 뒤집는 일이라 같은 파일에 있어야 어긋나지 않는다.
 *
 * 도형 목록을 따로 저장하지 않는다. data 속성에 JSON 을 박아 두면 되읽기는 쉬워지지만
 * 본문 용량이 두 배가 된다. 문제 본문에 들어가는 그림이라 작은 쪽을 택했다.
 */

export type Tool = "select" | "line" | "arrow" | "rect" | "ellipse" | "text" | "pen";

export interface Shape {
    kind: Exclude<Tool, "select">;
    /** 선 색. "" 이면 본문 글자색을 따른다 (다크 모드에서도 보인다) */
    color: string;
    width: number;
    /** line, arrow, rect, ellipse 에서 두 점 */
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    /** pen 의 점들 */
    points?: Array<[number, number]>;
    /** text */
    text?: string;
}

export const CANVAS = { w: 640, h: 360 };

/** 색 고르기. 기본은 본문 글자색을 따라가는 값이다 */
export const COLORS: Array<{ value: string; label: string; css: string }> = [
    { value: "", label: "기본", css: "currentColor" },
    { value: "#ef4444", label: "빨강", css: "#ef4444" },
    { value: "#3b82f6", label: "파랑", css: "#3b82f6" },
    { value: "#22c55e", label: "초록", css: "#22c55e" },
    { value: "#a1a1aa", label: "회색", css: "#a1a1aa" },
];

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 화살촉. marker 를 안 쓴다. defs 와 id 가 생기면 한 본문에 그림이 둘일 때 id 가 부딪친다 */
function arrowHead(x1: number, y1: number, x2: number, y2: number, size = 10): string {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const s = Math.PI / 7;
    const p1 = `${r1(x2 - size * Math.cos(a - s))},${r1(y2 - size * Math.sin(a - s))}`;
    const p2 = `${r1(x2 - size * Math.cos(a + s))},${r1(y2 - size * Math.sin(a + s))}`;
    return `<polyline points="${p1} ${r1(x2)},${r1(y2)} ${p2}"/>`;
}

function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 도형 하나를 SVG 조각으로. 색과 굵기가 기본값과 같으면 속성을 안 적어 용량을 줄인다 */
export function shapeToSvg(s: Shape): string {
    const attrs: string[] = [];
    if (s.color) attrs.push(`stroke="${s.color}"`);
    if (s.width !== 2) attrs.push(`stroke-width="${s.width}"`);
    const a = attrs.length ? " " + attrs.join(" ") : "";

    switch (s.kind) {
        case "line":
            return `<line x1="${r1(s.x1!)}" y1="${r1(s.y1!)}" x2="${r1(s.x2!)}" y2="${r1(s.y2!)}"${a}/>`;
        case "arrow":
            return (
                `<g${a}><line x1="${r1(s.x1!)}" y1="${r1(s.y1!)}" x2="${r1(s.x2!)}" y2="${r1(s.y2!)}"/>` +
                `${arrowHead(s.x1!, s.y1!, s.x2!, s.y2!)}</g>`
            );
        case "rect": {
            const x = Math.min(s.x1!, s.x2!);
            const y = Math.min(s.y1!, s.y2!);
            return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.abs(s.x2! - s.x1!))}" height="${r1(Math.abs(s.y2! - s.y1!))}"${a}/>`;
        }
        case "ellipse": {
            const cx = (s.x1! + s.x2!) / 2;
            const cy = (s.y1! + s.y2!) / 2;
            return `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(Math.abs(s.x2! - s.x1!) / 2)}" ry="${r1(Math.abs(s.y2! - s.y1!) / 2)}"${a}/>`;
        }
        case "pen":
            return `<polyline points="${(s.points ?? []).map(([x, y]) => `${r1(x)},${r1(y)}`).join(" ")}"${a}/>`;
        case "text":
            // 글자는 선이 아니라 면으로 그린다. stroke 를 끄지 않으면 테두리가 생겨 뭉갠다
            return `<text x="${r1(s.x1!)}" y="${r1(s.y1!)}" font-size="${s.width * 7}" fill="${s.color || "currentColor"}" stroke="none">${esc(s.text ?? "")}</text>`;
    }
}

export function shapesToSvg(shapes: Shape[], w = CANVAS.w, h = CANVAS.h): string {
    const body = shapes.map(shapeToSvg).join("");
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
        `fill="none" stroke="currentColor" stroke-width="2">${body}</svg>`
    );
}

/**
 * SVG 를 도형 목록으로 되돌린다.
 *
 * 우리가 만든 모양만 읽는다. 남이 만든 SVG 를 열면 읽히는 것만 읽고 나머지는 버리는데,
 * 그러면 고쳐 저장할 때 원본이 사라진다. 그래서 부르는 쪽에서 우리 그림인지 먼저 본다
 * (isOurSvg).
 */
export function svgToShapes(svg: string): Shape[] {
    if (typeof DOMParser === "undefined") return [];
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.querySelector("svg");
    if (!root) return [];

    const out: Shape[] = [];
    const num = (el: Element, name: string) => Number(el.getAttribute(name) ?? 0);
    /*
     * 색과 굵기.
     *
     * 도형에 안 적혀 있으면 부모를 본다. 화살표는 g 로 묶여 있어서 거기 적히고,
     * 그 외에는 루트 svg 의 값이 잡힌다. 루트의 currentColor 와 2 는 "안 적은 것"과
     * 같은 뜻이라 기본값으로 되돌린다. 안 그러면 넣을 때와 되읽을 때가 어긋난다.
     */
    const style = (el: Element): { color: string; width: number } => {
        const raw = el.getAttribute("stroke") ?? el.parentElement?.getAttribute("stroke") ?? "";
        const w = Number(el.getAttribute("stroke-width") ?? el.parentElement?.getAttribute("stroke-width") ?? 2);
        return { color: raw === "currentColor" ? "" : raw, width: w };
    };

    for (const el of Array.from(root.children)) {
        const tag = el.tagName.toLowerCase();

        if (tag === "g") {
            // 화살표. line 하나와 화살촉 polyline 하나로 되어 있다
            const line = el.querySelector("line");
            if (line) {
                out.push({
                    kind: "arrow",
                    ...style(el),
                    x1: num(line, "x1"),
                    y1: num(line, "y1"),
                    x2: num(line, "x2"),
                    y2: num(line, "y2"),
                });
            }
            continue;
        }

        const st = style(el);
        if (tag === "line") {
            out.push({ kind: "line", ...st, x1: num(el, "x1"), y1: num(el, "y1"), x2: num(el, "x2"), y2: num(el, "y2") });
        } else if (tag === "rect") {
            const x = num(el, "x");
            const y = num(el, "y");
            out.push({ kind: "rect", ...st, x1: x, y1: y, x2: x + num(el, "width"), y2: y + num(el, "height") });
        } else if (tag === "ellipse") {
            const cx = num(el, "cx");
            const cy = num(el, "cy");
            const rx = num(el, "rx");
            const ry = num(el, "ry");
            out.push({ kind: "ellipse", ...st, x1: cx - rx, y1: cy - ry, x2: cx + rx, y2: cy + ry });
        } else if (tag === "polyline") {
            const pts = (el.getAttribute("points") ?? "")
                .trim()
                .split(/\s+/)
                .map((p) => p.split(",").map(Number) as [number, number])
                .filter((p) => p.length === 2 && p.every((n) => !Number.isNaN(n)));
            if (pts.length) out.push({ kind: "pen", ...st, points: pts });
        } else if (tag === "text") {
            out.push({
                kind: "text",
                color: el.getAttribute("fill") === "currentColor" ? "" : (el.getAttribute("fill") ?? ""),
                width: Math.round(Number(el.getAttribute("font-size") ?? 14) / 7),
                x1: num(el, "x"),
                y1: num(el, "y"),
                text: el.textContent ?? "",
            });
        }
    }
    return out;
}

/** 그림판이 만든 SVG 인지. 아니면 되읽기로 원본을 망가뜨리지 않게 새로 그린다 */
export function isOurSvg(svg: string): boolean {
    return /^<svg\b[^>]*\bfill="none"[^>]*\bstroke="currentColor"/.test(svg.trim());
}
