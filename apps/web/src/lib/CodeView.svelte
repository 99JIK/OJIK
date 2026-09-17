<script lang="ts">
    import { onMount } from "svelte";
    import { EditorView, lineNumbers } from "@codemirror/view";
    import { EditorState } from "@codemirror/state";
    import { oneDark } from "@codemirror/theme-one-dark";
    import type { EditorMode } from "@ojik/core";

    /**
     * 읽기 전용 코드. 제출한 소스를 볼 때 쓴다.
     *
     * 하이라이팅만 하려고 라이브러리를 새로 넣지 않는다. 문제 화면의 에디터가 이미
     * CodeMirror 를 쓰고 문법 확장도 지연 로드라, 여기서 같은 것을 읽기 전용으로 붙이면
     * 새로 받는 게 사실상 없다. 쓸 때와 읽을 때 코드가 같은 모양으로 보이는 이득도 있다.
     *
     * 접기, 검색, 자동완성은 안 붙인다. 남의 코드를 읽는 자리라 필요 없고, 붙이면
     * 그만큼 더 받는다.
     */
    let {
        code = "",
        mode = "cpp",
        maxHeight = "32rem",
    }: {
        code?: string;
        mode?: EditorMode;
        /** 긴 소스가 화면을 다 먹지 않게. 넘치면 안에서 스크롤한다 */
        maxHeight?: string;
    } = $props();

    let host = $state<HTMLDivElement | null>(null);
    let view: EditorView | null = null;

    // 문제 화면의 Editor.svelte 와 같은 규칙이다. 모르는 모드는 cpp 로 떨어진다
    async function langExtension(m: EditorMode) {
        switch (m) {
            case "python":
                return (await import("@codemirror/lang-python")).python();
            case "java":
                return (await import("@codemirror/lang-java")).java();
            case "javascript":
                return (await import("@codemirror/lang-javascript")).javascript();
            default:
                return (await import("@codemirror/lang-cpp")).cpp();
        }
    }

    async function build() {
        if (!host) return;
        view?.destroy();
        view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: code,
                extensions: [
                    lineNumbers(),
                    await langExtension(mode),
                    oneDark,
                    // 커서와 편집을 막는다. 선택과 복사는 된다
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    EditorView.lineWrapping,
                ],
            }),
        });
    }

    onMount(() => {
        void build();
        return () => view?.destroy();
    });

    // 언어나 내용이 바뀌면 다시 만든다. 재채점 화면에서 같은 자리에 다른 소스가 온다
    $effect(() => {
        void code;
        void mode;
        if (view) void build();
    });
</script>

<div
    bind:this={host}
    class="overflow-hidden rounded-md border border-zinc-300 text-xs dark:border-zinc-700"
    style="--ojik-code-max: {maxHeight}"
></div>

<style>
    div :global(.cm-editor) {
        max-height: var(--ojik-code-max);
    }
    div :global(.cm-scroller) {
        font-family: var(--font-mono);
    }
</style>
