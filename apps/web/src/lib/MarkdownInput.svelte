<script lang="ts">
    import Markdown from "$lib/Markdown.svelte";

    /**
     * 마크다운 입력칸. 쓰기와 미리보기를 탭으로 오간다.
     *
     * 두 칸을 나란히 두는 방식은 안 쓴다. 좁은 화면에서 양쪽 다 못 읽을 폭이 되고,
     * 미리보기는 다 쓰고 한 번 보는 게 보통이다.
     *
     * 미리보기는 탭을 누른 뒤에만 그린다. 안 누르면 마크다운 파서도 안 받는다
     */
    let {
        value = $bindable(""),
        placeholder = "",
        rows = 12,
        maxLength,
        disabled = false,
    }: {
        value?: string;
        placeholder?: string;
        rows?: number;
        maxLength?: number;
        disabled?: boolean;
    } = $props();

    let tab = $state<"write" | "preview">("write");
    const over = $derived(maxLength !== undefined && value.length > maxLength);
</script>

<div class="rounded-md border border-zinc-300 dark:border-zinc-700">
    <div class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1 dark:border-zinc-800">
        <button
            type="button"
            onclick={() => (tab = "write")}
            class="rounded px-2 py-1 text-xs {tab === 'write'
                ? 'bg-zinc-200 font-medium dark:bg-zinc-700'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}"
        >
            쓰기
        </button>
        <button
            type="button"
            onclick={() => (tab = "preview")}
            class="rounded px-2 py-1 text-xs {tab === 'preview'
                ? 'bg-zinc-200 font-medium dark:bg-zinc-700'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}"
        >
            미리보기
        </button>

        <span class="ml-auto text-xs {over ? 'text-red-600 dark:text-red-400' : 'text-zinc-400'}">
            {#if maxLength !== undefined}
                {value.length} / {maxLength}
            {/if}
        </span>
    </div>

    {#if tab === "write"}
        <textarea
            bind:value
            {rows}
            {placeholder}
            {disabled}
            class="w-full resize-y rounded-b-md bg-transparent p-3 font-mono text-sm outline-none disabled:opacity-50"
        ></textarea>
    {:else}
        <div class="min-h-40 p-3">
            {#if value.trim()}
                <Markdown source={value} />
            {:else}
                <p class="text-sm text-zinc-400">쓴 내용이 없습니다.</p>
            {/if}
        </div>
    {/if}
</div>

<p class="mt-1 text-xs text-zinc-400">
    마크다운을 씁니다. 수식은 <code>$...$</code>, 도식은 <code>```mermaid</code> 블록.
</p>
