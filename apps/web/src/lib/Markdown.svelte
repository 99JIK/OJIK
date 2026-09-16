<script lang="ts">
    import { renderMarkdown, renderDiagrams } from "$lib/markdown";

    /**
     * 마크다운 본문을 그린다.
     * 무거운 것(KaTeX, mermaid)은 내용에 실제로 있을 때만 받는다. markdown.ts 참고.
     */
    let { source = "", compact = false }: { source?: string; compact?: boolean } = $props();

    let host = $state<HTMLElement | null>(null);
    let html = $state("");
    let hasDiagram = $state(false);

    $effect(() => {
        const src = source;
        void (async () => {
            const r = await renderMarkdown(src);
            html = r.html;
            hasDiagram = r.hasDiagram;
        })();
    });

    // 도식은 DOM 에 붙은 뒤에야 그릴 수 있다
    $effect(() => {
        void html;
        const el = host;
        if (!el || !hasDiagram) return;
        const dark = document.documentElement.classList.contains("dark");
        void renderDiagrams(el, dark);
    });
</script>

<div bind:this={host} class="ojik-md" class:ojik-md-compact={compact}>
    {@html html}
</div>
