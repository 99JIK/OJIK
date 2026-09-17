<script lang="ts">
    import { goto } from "$app/navigation";
    import { post } from "$lib/api";
    import { BLANK_MAX_BYTES, getLanguage } from "@ojik/core";

    /**
     * 빈칸 채우기.
     *
     * 서버가 비운 줄을 지운 골격을 준다. 원본은 안 온다. 여기서는 비운 줄 자리에
     * 입력칸을 놓고 나머지 줄은 읽기만 하게 그린다.
     *
     * 에디터를 쓰지 않는다. 한 줄씩 채우는 일이라 편집기의 이점이 없고, 학생이 다른 줄을
     * 건드릴 수 있으면 "골격은 그대로" 라는 전제가 깨진다. 줄 번호를 왼쪽에 붙여서
     * 출제자가 말하는 번호와 학생이 보는 번호가 같게 둔다.
     */
    let {
        problemId,
        lines,
        blankLines,
        language,
    }: {
        problemId: number;
        /** 비운 줄이 빈 문자열로 온 골격 */
        lines: string[];
        blankLines: number[];
        language: string | null;
    } = $props();

    let filled = $state<Record<number, string>>({});
    let submitting = $state(false);
    let error = $state<string | null>(null);

    const blankSet = $derived(new Set(blankLines));
    const draftKey = $derived(`blanks:${problemId}`);
    const done = $derived(blankLines.filter((n) => (filled[n] ?? "").trim() !== "").length);

    $effect(() => {
        const k = draftKey;
        try {
            const saved = localStorage.getItem(k);
            if (saved) filled = JSON.parse(saved) as Record<number, string>;
        } catch {
            // 못 읽어도 빈 칸으로 시작하면 된다
        }
    });

    $effect(() => {
        const k = draftKey;
        const f = JSON.stringify(filled);
        const t = setTimeout(() => {
            try {
                localStorage.setItem(k, f);
            } catch {
                // 저장이 막혀도 작성은 계속돼야 한다
            }
        }, 800);
        return () => clearTimeout(t);
    });

    async function submit() {
        if (done === 0) {
            error = "빈칸을 하나도 안 채웠습니다";
            return;
        }
        if (done < blankLines.length) {
            const left = blankLines.length - done;
            if (!confirm(`${left}칸이 비어 있습니다. 그대로 낼까요?`)) return;
        }

        submitting = true;
        error = null;
        try {
            await post("/submissions", { problemId, blanks: filled });
            try {
                localStorage.removeItem(draftKey);
            } catch {
                // 못 지워도 다음 제출 때 덮어쓴다
            }
            void goto(`/submissions?problemId=${problemId}`);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            submitting = false;
        }
    }
</script>

<p class="mb-2 text-xs text-zinc-400">
    비운 칸만 채웁니다. 나머지 줄은 그대로 채점됩니다.
    {#if language}
        채점 언어는 {getLanguage(language)?.label ?? language} 입니다.
    {/if}
</p>

<div class="overflow-x-auto rounded-md border border-zinc-300 dark:border-zinc-700">
    <table class="w-full border-collapse font-mono text-sm">
        <tbody>
            {#each lines as line, i (i)}
                {@const n = i + 1}
                <tr class={blankSet.has(n) ? "bg-blue-50 dark:bg-blue-950/30" : ""}>
                    <td
                        class="w-10 select-none border-r border-zinc-200 px-2 py-0.5 text-right align-top text-xs text-zinc-400 dark:border-zinc-800"
                    >
                        {n}
                    </td>
                    <td class="px-2 py-0.5 align-top">
                        {#if blankSet.has(n)}
                            <input
                                value={filled[n] ?? ""}
                                oninput={(e) => (filled = { ...filled, [n]: e.currentTarget.value })}
                                maxlength={BLANK_MAX_BYTES}
                                placeholder="이 줄을 채우세요"
                                spellcheck="false"
                                class="w-full rounded border border-blue-300 bg-white px-2 py-0.5 font-mono text-sm outline-none focus:border-blue-500 dark:border-blue-800 dark:bg-zinc-900"
                            />
                        {:else}
                            <!-- 빈 줄도 높이를 지켜야 줄 번호가 안 어긋난다 -->
                            <pre class="whitespace-pre text-zinc-700 dark:text-zinc-300">{line || " "}</pre>
                        {/if}
                    </td>
                </tr>
            {/each}
        </tbody>
    </table>
</div>

{#if error}
    <p class="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{/if}

<div class="mt-4 flex flex-wrap items-center gap-3">
    <button
        onclick={submit}
        disabled={submitting}
        class="rounded-md bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
        {submitting ? "내는 중..." : "제출"}
    </button>
    <span class="text-xs {done === blankLines.length ? 'text-zinc-400' : 'text-amber-600 dark:text-amber-400'}">
        빈칸 {blankLines.length}개 중 {done}개 채움
    </span>
</div>
