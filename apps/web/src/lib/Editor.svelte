<script lang="ts">
    import { onMount } from "svelte";
    import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
    import { EditorState } from "@codemirror/state";
    import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
    import { oneDark } from "@codemirror/theme-one-dark";
    import type { LanguageOption } from "./types";

    let { value = $bindable(""), mode }: { value: string; mode: LanguageOption["editorMode"] } = $props();

    let host: HTMLDivElement;
    let view: EditorView | null = null;

    // 언어 확장은 필요할 때만 받아 온다. 네 언어 문법을 처음부터 다 싣지 않는다.
    // 에디터와 문법이 번들에서 제일 무거운 부분이라 여기서 나누는 게 의미가 있다
    async function langExtension(m: LanguageOption["editorMode"]) {
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

    async function build(m: LanguageOption["editorMode"], initial: string) {
        view?.destroy();
        view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: initial,
                extensions: [
                    lineNumbers(),
                    highlightActiveLine(),
                    history(),
                    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                    await langExtension(m),
                    oneDark,
                    EditorView.updateListener.of((u) => {
                        if (u.docChanged) value = u.state.doc.toString();
                    }),
                ],
            }),
        });
    }

    onMount(() => {
        void build(mode, value);
        return () => view?.destroy();
    });

    // 언어를 바꾸면 에디터를 다시 만든다. 이때 작성 중인 코드는 유지한다
    $effect(() => {
        const m = mode;
        if (view) void build(m, view.state.doc.toString());
    });
</script>

<div bind:this={host} class="overflow-hidden rounded-md border border-zinc-300 text-sm dark:border-zinc-700"></div>

<style>
    div :global(.cm-editor) {
        min-height: 20rem;
        max-height: 40rem;
    }
    div :global(.cm-scroller) {
        font-family: var(--font-mono);
    }
</style>
