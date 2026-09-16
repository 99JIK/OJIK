/**
 * 마크다운 렌더링.
 *
 * 무거운 것을 조건부로 받는 게 핵심이다. 대부분의 문제에는 수식도 도식도 없는데
 * 전부 미리 싣으면 라우트당 첫 로드가 40KB 에서 800KB 로 뛴다.
 *
 *   본문에 $ 가 있나?        -> 있을 때만 KaTeX (약 250KB + 폰트)
 *   ```mermaid 펜스가 있나?  -> 있을 때만 mermaid (약 500KB)
 *
 * 파서와 살균기만 항상 받는다(약 30KB). 그 정도는 감수할 만하다.
 */

/** 본문에 수식이 있을 법한지. 헛짚어도 KaTeX 를 한 번 더 받을 뿐이라 느슨하게 본다 */
function hasMath(src: string): boolean {
    return /\$\$[\s\S]+?\$\$/.test(src) || /(^|[^\\$])\$[^$\n]+\$/.test(src);
}

function hasMermaid(src: string): boolean {
    return /^```mermaid\s*$/m.test(src);
}

/**
 * 살균 설정.
 *
 * 마크다운 본문에 HTML 을 쓸 수 있고, 출제자가 외부에서 복사해 붙일 수 있다.
 * 허용 목록 방식으로 가고, 스크립트와 이벤트 속성은 전부 버린다.
 *
 * SVG 를 허용하는 이유는 나중에 그림판이 SVG 를 넣기 때문이다. 다만 <script> 와
 * 이벤트 핸들러는 SVG 안에서도 막힌다.
 */
const SANITIZE = {
    ALLOWED_TAGS: [
        "p", "br", "hr", "strong", "em", "del", "code", "pre", "blockquote",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li",
        "table", "thead", "tbody", "tr", "th", "td",
        "a", "img", "span", "div", "sup", "sub",
        // KaTeX 가 만드는 것들
        "math", "semantics", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac",
        "msqrt", "mtext", "annotation", "mstyle", "mspace", "munderover", "munder", "mover",
        // 도식과 그림
        //
        // foreignObject 는 뺐다. SVG 안에 임의의 HTML 을 넣는 통로라 굳이 열어 둘 이유가 없다.
        // mermaid 는 이 살균기를 안 거치고(renderDiagrams 가 직접 그린다) 그림판은 쓰지 않는다.
        "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
        "text", "tspan", "defs", "marker",
    ],
    ALLOWED_ATTR: [
        "href", "title", "alt", "src", "width", "height", "colspan", "rowspan",
        "class", "style", "aria-hidden", "role",
        // SVG
        "viewBox", "d", "fill", "stroke", "stroke-width", "stroke-dasharray",
        "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
        "points", "transform", "text-anchor", "font-size", "font-family",
        "id", "xmlns",
    ],

    /*
     * URI 검사를 건너뛸 속성.
     *
     * ALLOWED_URI_REGEXP 는 URI 속성만 보는 게 아니라 URI_SAFE 로 표시되지 않은 모든 값을
     * 검사한다. 그래서 fill="none" 이나 viewBox="0 0 640 360" 처럼 URI 가 아닌 값이 통째로
     * 떨어져 나간다. 목록에 svg 태그를 적어 뒀는데도 그림이 속성 없는 껍데기로만 남았다.
     *
     * 여기 적는 것은 URI 를 담을 수 없는 속성뿐이다. href 와 src 는 그대로 아래 정규식이 본다.
     * marker-end 와 marker-start 는 url(#id) 를 받는 자리라 목록에서 아예 뺐다.
     * 그림판은 화살촉을 polyline 으로 그리고, mermaid 는 이 살균기를 안 거친다.
     */
    ADD_URI_SAFE_ATTR: [
        "viewBox", "d", "fill", "stroke", "stroke-width", "stroke-dasharray",
        "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
        "points", "transform", "text-anchor", "font-size", "font-family",
        "width", "height", "colspan", "rowspan",
    ],

    // javascript: 와 data: 로 스크립트가 들어오는 경로를 막는다
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/|data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,)/i,
};

export interface RenderResult {
    html: string;
    /** mermaid 블록이 있어 렌더 후 후처리가 필요한지 */
    hasDiagram: boolean;
}

export async function renderMarkdown(src: string): Promise<RenderResult> {
    if (!src.trim()) return { html: "", hasDiagram: false };

    const [{ marked }, DOMPurify] = await Promise.all([
        import("marked"),
        import("dompurify").then((m) => m.default),
    ]);

    let text = src;
    const diagrams: string[] = [];

    // mermaid 블록을 자리표시자로 빼 둔다. 파서가 코드 블록으로 이스케이프하면
    // 나중에 도식으로 못 바꾼다
    if (hasMermaid(text)) {
        text = text.replace(/^```mermaid\s*\n([\s\S]*?)^```\s*$/gm, (_m, body: string) => {
            diagrams.push(body);
            return `<div class="ojik-mermaid" data-idx="${diagrams.length - 1}"></div>`;
        });
    }

    // 수식도 자리표시자로 뺀다. 마크다운이 _ 와 * 를 강조로 먹어 식을 망가뜨린다
    const maths: { tex: string; display: boolean }[] = [];
    if (hasMath(text)) {
        text = text
            .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
                maths.push({ tex, display: true });
                return `<span class="ojik-math" data-idx="${maths.length - 1}"></span>`;
            })
            .replace(/(^|[^\\$])\$([^$\n]+)\$/g, (_m, pre: string, tex: string) => {
                maths.push({ tex, display: false });
                return `${pre}<span class="ojik-math" data-idx="${maths.length - 1}"></span>`;
            });
    }

    let html = await marked.parse(text, { gfm: true, breaks: false });

    // 수식을 되돌린다. KaTeX 는 여기서만 받는다
    if (maths.length > 0) {
        const katex = (await import("katex")).default;
        html = html.replace(
            /<span class="ojik-math" data-idx="(\d+)"><\/span>/g,
            (_m, i: string) => {
                const m = maths[Number(i)]!;
                try {
                    return katex.renderToString(m.tex, {
                        displayMode: m.display,
                        throwOnError: false,
                        output: "html",
                    });
                } catch {
                    // 식이 깨졌으면 원문을 보여준다. 빈칸보다 낫다
                    return `<code>${m.display ? "$$" : "$"}${m.tex}${m.display ? "$$" : "$"}</code>`;
                }
            },
        );
    }

    // 살균은 항상 마지막에. KaTeX 산출물도 통과시켜야 하므로 순서가 중요하다
    const clean = DOMPurify.sanitize(html, SANITIZE);

    // 도식 본문은 살균 뒤에 data 속성으로 붙인다. mermaid 문법이 HTML 로 오해받지 않게
    const withDiagrams = clean.replace(
        /<div class="ojik-mermaid" data-idx="(\d+)"><\/div>/g,
        (_m, i: string) =>
            `<div class="ojik-mermaid" data-src="${escapeAttr(diagrams[Number(i)] ?? "")}"></div>`,
    );

    return { html: withDiagrams, hasDiagram: diagrams.length > 0 };
}

function escapeAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * 코드 블록에 색을 입힌다.
 *
 * 에디터를 띄우지 않고 파서만 돌린다. 문제 본문에 코드가 여럿일 수 있는데 블록마다
 * CodeMirror 를 만들면 무겁고, 읽기만 하는 자리라 편집기가 필요 없다.
 *
 * 언어가 안 적힌 블록(```만 친 것)은 건드리지 않는다. 어느 문법으로 읽을지 모르는데
 * 아무거나 골라 칠하면 엉뚱한 색이 나와 오히려 읽기 나쁘다.
 *
 * 살균을 이미 거친 DOM 에 대고 하는 일이라, 여기서 넣는 것은 span 과 class 뿐이다.
 */
const HL_LANGS: Record<string, () => Promise<{ language: { parser: unknown } }>> = {
    c: async () => (await import("@codemirror/lang-cpp")).cpp(),
    cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
    "c++": async () => (await import("@codemirror/lang-cpp")).cpp(),
    java: async () => (await import("@codemirror/lang-java")).java(),
    python: async () => (await import("@codemirror/lang-python")).python(),
    py: async () => (await import("@codemirror/lang-python")).python(),
    javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
    js: async () => (await import("@codemirror/lang-javascript")).javascript(),
};

export async function highlightCodeBlocks(root: HTMLElement): Promise<void> {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code[class*=language-]"));
    if (blocks.length === 0) return;

    const wanted = new Set(
        blocks
            .map((b) => /language-([\w+#-]+)/.exec(b.className)?.[1]?.toLowerCase() ?? "")
            .filter((n) => n in HL_LANGS),
    );
    if (wanted.size === 0) return;

    const { highlightCode, classHighlighter } = await import("@lezer/highlight");
    const parsers = new Map<string, { parse: (s: string) => unknown }>();
    for (const name of wanted) {
        try {
            const support = await HL_LANGS[name]!();
            parsers.set(name, support.language.parser as { parse: (s: string) => unknown });
        } catch {
            // 문법을 못 받으면 그 언어만 건너뛴다. 본문은 그대로 보인다
        }
    }

    for (const block of blocks) {
        const name = /language-([\w+#-]+)/.exec(block.className)?.[1]?.toLowerCase() ?? "";
        const parser = parsers.get(name);
        if (!parser || block.dataset.hl === "1") continue;

        const code = block.textContent ?? "";
        const out = document.createDocumentFragment();
        try {
            highlightCode(
                code,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lezer 타입이 파서 종류마다 갈린다
                (parser as any).parse(code),
                classHighlighter,
                (text, classes) => {
                    const node = document.createTextNode(text);
                    if (!classes) {
                        out.appendChild(node);
                        return;
                    }
                    const span = document.createElement("span");
                    span.className = classes;
                    span.appendChild(node);
                    out.appendChild(span);
                },
                () => out.appendChild(document.createTextNode("\n")),
            );
            block.replaceChildren(out);
            block.dataset.hl = "1";
        } catch {
            // 파싱이 깨져도 원문은 그대로 둔다
        }
    }
}

/**
 * 렌더된 HTML 안의 mermaid 자리를 실제 도식으로 바꾼다.
 * 이 함수를 부를 때만 mermaid 를 받는다.
 */
export async function renderDiagrams(root: HTMLElement, dark: boolean): Promise<void> {
    const nodes = root.querySelectorAll<HTMLElement>(".ojik-mermaid[data-src]");
    if (nodes.length === 0) return;

    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
        startOnLoad: false,
        theme: dark ? "dark" : "default",
        // 도식 본문은 출제자가 쓴 것이라 신뢰하지만, 최소 권한으로 둔다
        securityLevel: "strict",
    });

    let i = 0;
    for (const node of nodes) {
        const src = node.dataset.src ?? "";
        node.removeAttribute("data-src");
        try {
            const { svg } = await mermaid.render(`ojik-d${Date.now()}-${i++}`, src);
            node.innerHTML = svg;
        } catch (e) {
            // 문법이 틀리면 원문을 보여준다. 출제자가 고칠 수 있어야 한다
            node.innerHTML = `<pre class="text-xs text-red-600">${escapeAttr(src)}</pre>`;
            void e;
        }
    }
}
