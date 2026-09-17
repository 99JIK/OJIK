<script lang="ts">
    import { goto } from "$app/navigation";
    import { post } from "$lib/api";
    import { ANSWER_MAX_BYTES } from "@ojik/core";
    import Markdown from "$lib/Markdown.svelte";

    /**
     * 단답형 답안.
     *
     * 문항 지문은 마크다운이다. 개념 확인 문제라 수식이 자주 들어간다.
     * 기대 답은 서버가 안 내려준다. 여기 있는 건 지문과 배점뿐이다.
     *
     * 안 적은 문항이 있으면 낼 때 한 번 물어본다. 다 적었다고 생각하고 냈는데 0점이
     * 나오는 게 제일 억울하다.
     */
    let {
        problemId,
        items,
    }: {
        problemId: number;
        items: Array<{ idx: number; points: number; prompt: string }>;
    } = $props();

    let answers = $state<Record<number, string>>({});
    let submitting = $state(false);
    let error = $state<string | null>(null);

    const draftKey = $derived(`answers:${problemId}`);

    // 쓰던 답을 남긴다. 실수로 새로고침해도 처음부터 다시 적지 않게
    $effect(() => {
        const k = draftKey;
        try {
            const saved = localStorage.getItem(k);
            if (saved) answers = JSON.parse(saved) as Record<number, string>;
        } catch {
            // 못 읽어도 빈 칸으로 시작하면 된다
        }
    });

    $effect(() => {
        const k = draftKey;
        const a = JSON.stringify(answers);
        const t = setTimeout(() => {
            try {
                localStorage.setItem(k, a);
            } catch {
                // 저장이 막혀도 작성은 계속돼야 한다
            }
        }, 800);
        return () => clearTimeout(t);
    });

    const filled = $derived(items.filter((i) => (answers[i.idx] ?? "").trim() !== "").length);
    const totalPoints = $derived(items.reduce((a, i) => a + i.points, 0));

    async function submit() {
        if (filled === 0) {
            error = "답을 하나도 안 적었습니다";
            return;
        }
        if (filled < items.length) {
            const blanks = items.length - filled;
            if (!confirm(`${blanks}개 문항이 비어 있습니다. 비운 문항은 오답으로 채점됩니다. 그대로 낼까요?`)) {
                return;
            }
        }

        submitting = true;
        error = null;
        try {
            await post("/submissions", { problemId, answers });
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

{#if items.length === 0}
    <p class="rounded-md bg-zinc-100 px-4 py-3 text-sm text-zinc-500 dark:bg-zinc-900">
        아직 문항이 없습니다. 출제자가 채워야 풀 수 있습니다.
    </p>
{:else}
    <ol class="space-y-4">
        {#each items as item, i (item.idx)}
            <li class="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
                <div class="mb-2 flex items-baseline gap-2">
                    <span class="text-sm font-medium text-zinc-400">{i + 1}</span>
                    <div class="min-w-0 flex-1 text-sm">
                        <Markdown source={item.prompt} compact />
                    </div>
                    <span class="shrink-0 text-xs text-zinc-400">{item.points}점</span>
                </div>
                <textarea
                    value={answers[item.idx] ?? ""}
                    oninput={(e) => (answers = { ...answers, [item.idx]: e.currentTarget.value })}
                    rows={Math.max(1, (answers[item.idx] ?? "").split("\n").length)}
                    maxlength={ANSWER_MAX_BYTES}
                    placeholder="답"
                    class="w-full resize-y rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                ></textarea>
            </li>
        {/each}
    </ol>

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
        <span class="text-xs {filled === items.length ? 'text-zinc-400' : 'text-amber-600 dark:text-amber-400'}">
            {items.length}문항 중 {filled}개 작성 · 총 {totalPoints}점
        </span>
    </div>
{/if}
