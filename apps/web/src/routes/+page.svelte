<script lang="ts">
    import { get } from "$lib/api.js";
    import { acceptRate } from "$lib/format.js";
    import type { ProblemSummary } from "$lib/types.js";

    let q = $state("");
    let offset = $state(0);
    const LIMIT = 50;

    let data = $state<{ problems: ProblemSummary[]; solved: number[] } | null>(null);
    let error = $state<string | null>(null);
    let loading = $state(false);

    async function load() {
        loading = true;
        error = null;
        try {
            data = await get("/problems", { q, offset, limit: LIMIT });
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loading = false;
        }
    }

    // q 나 offset 이 바뀌면 다시 불러온다. 첫 렌더에도 한 번 돈다
    $effect(() => {
        void q;
        void offset;
        void load();
    });

    function search(e: Event) {
        e.preventDefault();
        offset = 0;
    }

    const solvedSet = $derived(new Set(data?.solved ?? []));
</script>

<div class="flex items-center justify-between gap-4">
    <h1 class="text-xl font-bold">문제</h1>
    <form onsubmit={search} class="flex gap-2">
        <input
            bind:value={q}
            placeholder="제목 검색"
            class="w-56 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
    </form>
</div>

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if !data && loading}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else if data}
    <table class="ojik-table mt-4 w-full text-sm">
        <thead class="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
                <th class="w-16 font-medium">번호</th>
                <th class="font-medium">제목</th>
                <th class="w-24 text-right font-medium">맞힌 수</th>
                <th class="w-24 text-right font-medium">정답 비율</th>
            </tr>
        </thead>
        <tbody>
            {#each data.problems as p (p.id)}
                <tr class="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900">
                    <td class="tabular-nums text-zinc-500">{p.id}</td>
                    <td>
                        <a href="/problem/{p.id}" class="hover:underline">
                            {#if solvedSet.has(p.id)}<span class="mr-1 text-green-600 dark:text-green-400">O</span
                                >{/if}{p.title}
                        </a>
                        {#if !p.isPublic}
                            <span class="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs dark:bg-zinc-800">비공개</span>
                        {/if}
                    </td>
                    <td class="text-right tabular-nums">{p.acceptedCount}</td>
                    <td class="text-right tabular-nums text-zinc-500">
                        {acceptRate(p.acceptedCount, p.submissionCount)}
                    </td>
                </tr>
            {:else}
                <tr><td colspan="4" class="py-8 text-center text-zinc-400">문제가 없습니다</td></tr>
            {/each}
        </tbody>
    </table>

    <div class="mt-4 flex justify-center gap-2 text-sm">
        <button
            onclick={() => (offset = Math.max(0, offset - LIMIT))}
            disabled={offset === 0}
            class="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700">이전</button
        >
        <button
            onclick={() => (offset += LIMIT)}
            disabled={data.problems.length < LIMIT}
            class="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700">다음</button
        >
    </div>
{/if}
