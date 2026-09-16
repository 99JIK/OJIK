<script lang="ts">
    import { page } from "$app/state";
    import { get } from "$lib/api";
    import { verdictClass, verdictText, formatDate } from "$lib/format";
    import type { SubmissionRow } from "$lib/types";

    const handle = $derived(page.params.handle ?? "");
    let rows = $state<SubmissionRow[]>([]);
    let error = $state<string | null>(null);

    $effect(() => {
        const h = handle;
        void (async () => {
            try {
                const r = await get<{ submissions: SubmissionRow[] }>("/submissions", {
                    handle: h,
                    limit: 50,
                });
                rows = r.submissions;
                error = null;
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
            }
        })();
    });

    // 맞힌 문제는 중복 없이 센다. 같은 문제를 여러 번 맞혀도 하나다
    const solved = $derived([
        ...new Set(rows.filter((r) => r.verdict === "accepted").map((r) => r.problemId)),
    ]);
</script>

<h1 class="text-xl font-bold">{handle}</h1>

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else}
    <section class="mt-6">
        <h2 class="mb-2 text-sm font-semibold">맞힌 문제</h2>
        {#if solved.length === 0}
            <p class="text-sm text-zinc-400">없습니다</p>
        {:else}
            <div class="flex flex-wrap gap-1">
                {#each solved as pid (pid)}
                    <a
                        href="/problem/{pid}"
                        class="rounded bg-green-100 px-2 py-1 text-xs tabular-nums text-green-800 hover:underline dark:bg-green-950 dark:text-green-300"
                        >{pid}</a
                    >
                {/each}
            </div>
        {/if}
        <p class="mt-2 text-xs text-zinc-400">최근 50건의 제출에서만 집계한 값입니다.</p>
    </section>

    <section class="mt-8">
        <h2 class="mb-2 text-sm font-semibold">최근 제출</h2>
        <table class="ojik-table w-full text-sm">
            <tbody>
                {#each rows as r (r.id)}
                    <tr class="border-b border-zinc-100 dark:border-zinc-900">
                        <td class="w-20 tabular-nums text-zinc-500">
                            <a href="/submission/{r.id}" class="hover:underline">{r.id}</a>
                        </td>
                        <td>
                            <a href="/problem/{r.problemId}" class="hover:underline">{r.problemTitle}</a>
                        </td>
                        <td class="w-36 {verdictClass(r.verdict, r.status)}">
                            {verdictText(r.verdict, r.status, r.judgedCount, r.totalCount)}
                        </td>
                        <td class="w-32 text-zinc-500">{formatDate(r.createdAt)}</td>
                    </tr>
                {:else}
                    <tr><td colspan="4" class="py-8 text-center text-zinc-400">제출이 없습니다</td></tr>
                {/each}
            </tbody>
        </table>
    </section>
{/if}
