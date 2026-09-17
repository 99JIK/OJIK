<script lang="ts">
    import {
        CANVAS,
        COLORS,
        shapesToSvg,
        svgToShapes,
        isOurSvg,
        type Shape,
        type Tool,
    } from "$lib/svgshapes";

    /**
     * 문제 설명에 넣을 간단한 그림판.
     *
     * 그림 파일을 올리는 것과 다른 물건이다. 여기서 만든 건 SVG 문자열로 본문에 그대로
     * 들어간다. 파일이 안 생기고, 도형 몇 개짜리 그림은 수백 바이트다.
     *
     * 도구는 문제 설명에 실제로 쓰는 것만 둔다. 화살표가 있는 선, 네모, 타원, 글자,
     * 자유선. 그래프나 트리는 정점을 타원으로 두고 화살표로 잇는다.
     *
     * 색 기본값이 currentColor 라 다크 모드에서도 보인다. 검정으로 박으면 어두운 화면에서
     * 그림이 사라진다.
     */
    let {
        initial = "",
        onsave,
        oncancel,
    }: {
        initial?: string;
        onsave: (svg: string) => void;
        oncancel: () => void;
    } = $props();

    let shapes = $state<Shape[]>([]);
    let tool = $state<Tool>("line");
    let color = $state("");
    let width = $state(2);
    let snap = $state(true);
    let selected = $state<number | null>(null);

    /** 그리는 중인 도형. 손을 떼면 shapes 로 넘어간다 */
    let draft = $state<Shape | null>(null);
    let host = $state<SVGSVGElement | null>(null);
    let textInput = $state("");

    /**
     * 고치기로 열렸으면 도형을 되살린다.
     *
     * 우리가 만든 SVG 가 아니면 되읽지 않는다. 읽히는 것만 읽고 저장하면 원본에서
     * 모르는 부분이 조용히 사라진다.
     */
    $effect(() => {
        const src = initial;
        if (src && isOurSvg(src)) shapes = svgToShapes(src);
    });

    const GRID = 10;
    const fit = (n: number) => (snap ? Math.round(n / GRID) * GRID : Math.round(n));

    /** 화면 좌표를 그림 좌표로. 확대나 여백이 있어도 맞게 */
    function at(e: PointerEvent): [number, number] {
        const el = host;
        if (!el) return [0, 0];
        const r = el.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * CANVAS.w;
        const y = ((e.clientY - r.top) / r.height) * CANVAS.h;
        return [fit(Math.max(0, Math.min(CANVAS.w, x))), fit(Math.max(0, Math.min(CANVAS.h, y)))];
    }

    function down(e: PointerEvent) {
        const [x, y] = at(e);

        if (tool === "select") {
            // 뒤에 그린 것이 위에 있으니 뒤에서부터 찾는다
            selected = null;
            for (let i = shapes.length - 1; i >= 0; i--) {
                if (near(shapes[i]!, x, y)) {
                    selected = i;
                    break;
                }
            }
            return;
        }

        if (tool === "text") {
            const t = textInput.trim();
            if (!t) return;
            shapes = [...shapes, { kind: "text", color, width, x1: x, y1: y, text: t }];
            return;
        }

        host?.setPointerCapture(e.pointerId);
        draft =
            tool === "pen"
                ? { kind: "pen", color, width, points: [[x, y]] }
                : { kind: tool, color, width, x1: x, y1: y, x2: x, y2: y };
    }

    function move(e: PointerEvent) {
        if (!draft) return;
        const [x, y] = at(e);
        if (draft.kind === "pen") {
            draft = { ...draft, points: [...(draft.points ?? []), [x, y]] };
        } else {
            draft = { ...draft, x2: x, y2: y };
        }
    }

    function up() {
        if (!draft) return;
        // 점 하나짜리는 실수로 누른 것이다
        const trivial =
            draft.kind === "pen"
                ? (draft.points?.length ?? 0) < 2
                : draft.x1 === draft.x2 && draft.y1 === draft.y2;
        if (!trivial) shapes = [...shapes, draft];
        draft = null;
    }

    /** 대충 맞으면 잡는다. 정확한 히트 판정은 이 그림판에 과하다 */
    function near(s: Shape, x: number, y: number): boolean {
        const pad = 8;
        if (s.kind === "pen") {
            return (s.points ?? []).some(([px, py]) => Math.abs(px - x) < pad && Math.abs(py - y) < pad);
        }
        if (s.kind === "text") {
            return Math.abs(s.x1! - x) < 60 && Math.abs(s.y1! - y) < 16;
        }
        const lo = { x: Math.min(s.x1!, s.x2!) - pad, y: Math.min(s.y1!, s.y2!) - pad };
        const hi = { x: Math.max(s.x1!, s.x2!) + pad, y: Math.max(s.y1!, s.y2!) + pad };
        return x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y;
    }

    function removeSelected() {
        if (selected === null) return;
        shapes = shapes.filter((_, i) => i !== selected);
        selected = null;
    }

    function undo() {
        shapes = shapes.slice(0, -1);
        selected = null;
    }

    const preview = $derived(shapesToSvg(draft ? [...shapes, draft] : shapes));
    const bytes = $derived(new TextEncoder().encode(shapesToSvg(shapes)).length);

    const TOOLS: Array<[Tool, string]> = [
        ["line", "선"],
        ["arrow", "화살표"],
        ["rect", "네모"],
        ["ellipse", "타원"],
        ["pen", "자유선"],
        ["text", "글자"],
        ["select", "고르기"],
    ];
</script>

<svelte:window
    onkeydown={(e) => {
        if (e.key === "Escape") oncancel();
        if (e.key === "Delete" || e.key === "Backspace") {
            if (selected !== null && document.activeElement?.tagName !== "INPUT") {
                e.preventDefault();
                removeSelected();
            }
        }
    }}
/>

<div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    <div class="max-h-full w-full max-w-4xl overflow-y-auto rounded-md bg-white p-4 dark:bg-zinc-900">
        <div class="mb-3 flex items-baseline justify-between">
            <h2 class="font-semibold">{initial ? "그림 고치기" : "그림 그리기"}</h2>
            <span class="text-xs text-zinc-400">도형 {shapes.length}개 · {bytes}바이트</span>
        </div>

        <div class="mb-2 flex flex-wrap items-center gap-1">
            {#each TOOLS as [t, label] (t)}
                <button
                    type="button"
                    onclick={() => (tool = t)}
                    class="rounded px-2 py-1 text-xs {tool === t
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'}"
                >
                    {label}
                </button>
            {/each}

            <span class="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700"></span>

            {#each COLORS as c (c.value)}
                <button
                    type="button"
                    onclick={() => (color = c.value)}
                    title={c.label}
                    aria-label={c.label}
                    class="h-5 w-5 rounded-full border-2 {color === c.value
                        ? 'border-blue-500'
                        : 'border-transparent'}"
                    style="background: {c.value || 'currentColor'}"
                ></button>
            {/each}

            <span class="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700"></span>

            <label class="flex items-center gap-1 text-xs text-zinc-500">
                굵기
                <input type="range" min="1" max="6" bind:value={width} class="w-20" />
            </label>
            <label class="flex items-center gap-1 text-xs text-zinc-500">
                <input type="checkbox" bind:checked={snap} />
                격자
            </label>
        </div>

        {#if tool === "text"}
            <input
                bind:value={textInput}
                placeholder="넣을 글자를 치고 그림을 누르세요"
                class="mb-2 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
        {/if}

        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <svg
            bind:this={host}
            viewBox="0 0 {CANVAS.w} {CANVAS.h}"
            class="w-full touch-none rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950"
            style="aspect-ratio: {CANVAS.w} / {CANVAS.h}"
            role="img"
            aria-label="그림판"
            onpointerdown={down}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
        >
            {#if snap}
                <!-- 격자는 안내용이라 결과 SVG 에 안 들어간다 -->
                <g stroke="currentColor" stroke-width="0.5" opacity="0.12">
                    {#each Array.from({ length: Math.floor(CANVAS.w / 20) }, (_, i) => (i + 1) * 20) as x (x)}
                        <line x1={x} y1="0" x2={x} y2={CANVAS.h} />
                    {/each}
                    {#each Array.from({ length: Math.floor(CANVAS.h / 20) }, (_, i) => (i + 1) * 20) as y (y)}
                        <line x1="0" y1={y} x2={CANVAS.w} y2={y} />
                    {/each}
                </g>
            {/if}

            <g class="text-zinc-900 dark:text-zinc-100">
                {@html preview.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}
            </g>

            {#if selected !== null && shapes[selected]}
                {@const s = shapes[selected]}
                {#if s.kind !== "pen" && s.kind !== "text"}
                    <rect
                        x={Math.min(s.x1!, s.x2!) - 4}
                        y={Math.min(s.y1!, s.y2!) - 4}
                        width={Math.abs(s.x2! - s.x1!) + 8}
                        height={Math.abs(s.y2! - s.y1!) + 8}
                        fill="none"
                        stroke="#3b82f6"
                        stroke-width="1"
                        stroke-dasharray="4 3"
                    />
                {/if}
            {/if}
        </svg>

        <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
                type="button"
                onclick={undo}
                disabled={shapes.length === 0}
                class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
            >
                되돌리기
            </button>
            <button
                type="button"
                onclick={removeSelected}
                disabled={selected === null}
                class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
            >
                고른 것 지우기
            </button>
            <button
                type="button"
                onclick={() => {
                    shapes = [];
                    selected = null;
                }}
                disabled={shapes.length === 0}
                class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
            >
                전부 지우기
            </button>

            <span class="ml-auto flex gap-2">
                <button
                    type="button"
                    onclick={oncancel}
                    class="rounded-md px-4 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                    취소
                </button>
                <button
                    type="button"
                    onclick={() => onsave(shapesToSvg(shapes))}
                    disabled={shapes.length === 0}
                    class="rounded-md bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                    본문에 넣기
                </button>
            </span>
        </div>

        <p class="mt-2 text-xs text-zinc-400">
            선 색 기본값은 본문 글자색을 따라가므로 다크 모드에서도 보입니다. Esc 로 닫고,
            고르기로 집은 뒤 Delete 로 지웁니다.
        </p>
    </div>
</div>
