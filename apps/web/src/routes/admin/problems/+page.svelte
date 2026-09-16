<script lang="ts">
    import { get, post } from "$lib/api";
    import { acceptRate } from "$lib/format";
    import type { ProblemSummary } from "$lib/types";

    let rows = $state<ProblemSummary[]>([]);
    let error = $state<string | null>(null);
    let notice = $state<string | null>(null);
    let loaded = $state(false);
    let q = $state("");

    async function load() {
        try {
            const r = await get<{ problems: ProblemSummary[] }>("/problems", { q, limit: 100 });
            rows = r.problems;
            error = null;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loaded = true;
        }
    }

    $effect(() => {
        void q;
        void load();
    });

    /** 문제 전체 재채점. 테스트케이스를 고친 뒤에 쓴다 */
    async function rejudge(p: ProblemSummary) {
        if (!confirm(`${p.id}번 "${p.title}" 의 모든 제출을 다시 채점합니다. 계속할까요?`)) return;
        try {
            const r = await post<{ requeued: number }>(`/problems/${p.id}/rejudge`);
            notice = `${p.id}번 ${r.requeued}건을 큐에 넣었습니다.`;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
    }
</script>

<div class="flex items-center justify-between gap-4">
    <div class="flex items-center gap-3">
        <a
            href="/admin/problems/new"
            class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
            새 문제
        </a>
        <span class="text-sm text-zinc-400">{rows.length}개</span>
    </div>
    <input
        bind:value={q}
        placeholder="제목 검색"
        class="w-56 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    />
</div>

{#if notice}
    <p class="mt-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
        {notice}
    </p>
{/if}
{#if error}
    <p class="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{/if}

{#if !loaded}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else}
    <table class="ojik-table mt-4 w-full text-sm">
        <thead class="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
                <th class="w-16 font-medium">번호</th>
                <th class="font-medium">제목</th>
                <th class="w-20 font-medium">공개</th>
                <th class="w-24 text-right font-medium">맞힌 수</th>
                <th class="w-24 text-right font-medium">정답 비율</th>
                <th class="w-36"></th>
            </tr>
        </thead>
        <tbody>
            {#each rows as p (p.id)}
                <tr class="border-b border-zinc-100 dark:border-zinc-900">
                    <td class="tabular-nums text-zinc-500">{p.id}</td>
                    <td>
                        <a href="/admin/problems/{p.id}" class="hover:underline">{p.title}</a>
                    </td>
                    <td>
                        {#if p.isPublic}
                            <span class="text-green-600 dark:text-green-400">공개</span>
                        {:else}
                            <span class="text-zinc-400">비공개</span>
                        {/if}
                    </td>
                    <td class="text-right tabular-nums">{p.acceptedCount}</td>
                    <td class="text-right tabular-nums text-zinc-500">
                        {acceptRate(p.acceptedCount, p.submissionCount)}
                    </td>
                    <td class="text-right">
                        <a href="/problem/{p.id}" class="text-xs text-zinc-500 hover:underline">보기</a>
                        <button
                            onclick={() => rejudge(p)}
                            class="ml-3 text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                            재채점
                        </button>
                    </td>
                </tr>
            {:else}
                <tr><td colspan="6" class="py-8 text-center text-zinc-400">문제가 없습니다</td></tr>
            {/each}
        </tbody>
    </table>
{/if}
