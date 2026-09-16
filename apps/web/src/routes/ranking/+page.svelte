<script lang="ts">
    import { get } from "$lib/api";

    interface Row {
        id: number;
        handle: string;
        display_name: string | null;
        solved_count: number;
        submission_count: number;
        rank: number;
    }

    let rows = $state<Row[]>([]);
    let error = $state<string | null>(null);

    $effect(() => {
        void (async () => {
            try {
                const r = await get<{ ranking: Row[] }>("/ranking", { limit: 100 });
                rows = r.ranking;
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
            }
        })();
    });
</script>

<h1 class="text-xl font-bold">랭킹</h1>

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
{:else}
    <table class="ojik-table mt-4 w-full text-sm">
        <thead class="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
                <th class="w-16 font-medium">순위</th>
                <th class="font-medium">아이디</th>
                <th class="w-28 text-right font-medium">맞힌 문제</th>
                <th class="w-28 text-right font-medium">제출</th>
            </tr>
        </thead>
        <tbody>
            {#each rows as r (r.id)}
                <tr class="border-b border-zinc-100 dark:border-zinc-900">
                    <td class="tabular-nums text-zinc-500">{r.rank}</td>
                    <td>
                        <a href="/user/{r.handle}" class="hover:underline">{r.handle}</a>
                        {#if r.display_name}<span class="ml-2 text-zinc-400">{r.display_name}</span>{/if}
                    </td>
                    <td class="text-right tabular-nums">{r.solved_count}</td>
                    <td class="text-right tabular-nums text-zinc-500">{r.submission_count}</td>
                </tr>
            {:else}
                <tr><td colspan="4" class="py-8 text-center text-zinc-400">아직 아무도 문제를 풀지 않았습니다</td></tr>
            {/each}
        </tbody>
    </table>
{/if}
