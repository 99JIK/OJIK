<script lang="ts">
    import { page } from "$app/state";
    import { get } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { SCORING_LABEL, PRESET_LABEL, type Scoring, type CollectionPreset } from "@ojik/core";

    /**
     * 순위표. scoring 축에 따라 열이 달라진다.
     *   progress: 푼 수만
     *   icpc:     푼 수 + 페널티
     *   ioi:      점수 합
     * 규칙은 서버가 정하고 화면은 받은 대로 그린다.
     */

    interface Row {
        user_id: number;
        handle: string;
        display_name: string | null;
        solved: number;
        penalty: number;
        score: number;
    }

    interface Data {
        collection: {
            id: number;
            slug: string;
            title: string;
            preset: CollectionPreset;
            scoring: Scoring;
            endsAt: string | null;
        };
        scoring: Scoring;
        frozen: boolean;
        freezeAt: string | null;
        rows: Row[];
    }

    const slug = $derived(page.params.slug ?? "");
    let data = $state<Data | null>(null);
    let error = $state<string | null>(null);

    async function load() {
        try {
            data = await get(`/collections/${slug}/scoreboard`);
            error = null;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
    }

    $effect(() => {
        void slug;
        void load();
    });

    /** 진행 중이면 주기적으로 갱신한다. 끝난 대회는 더 볼 게 없다 */
    const live = $derived(
        data ? !data.collection.endsAt || new Date(data.collection.endsAt).getTime() > Date.now() : false,
    );
    $effect(() => {
        if (!live) return;
        const t = setInterval(load, 15_000);
        return () => clearInterval(t);
    });

    /**
     * 동점은 같은 순위로 묶는다. ICPC 는 푼 수와 페널티가 모두 같아야 동점이다.
     * 서버가 이미 정렬해서 주므로 여기서는 앞 행과 비교만 한다.
     */
    const ranked = $derived.by(() => {
        const d = data;
        if (!d) return [];
        const key = (r: Row) => (d.scoring === "ioi" ? `${r.score}` : `${r.solved}/${r.penalty}`);
        let rank = 0;
        let prev: string | null = null;
        return d.rows.map((r, i) => {
            const k = key(r);
            if (k !== prev) {
                rank = i + 1;
                prev = k;
            }
            return { ...r, rank };
        });
    });
</script>

{#if error}
    <p class="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if !data}
    <p class="text-sm text-zinc-500">불러오는 중...</p>
{:else}
    <div class="flex items-baseline justify-between gap-4">
        <div>
            <a href="/c/{data.collection.slug}" class="text-xs text-zinc-400 hover:underline">
                {PRESET_LABEL[data.collection.preset]} · {data.collection.title}
            </a>
            <h1 class="text-xl font-bold">순위표</h1>
        </div>
        <span class="text-sm text-zinc-400">{SCORING_LABEL[data.scoring]}</span>
    </div>

    {#if data.frozen}
        <p class="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            순위표가 동결됐습니다. 지금 보이는 것은 동결 시각까지의 결과입니다.
        </p>
    {/if}

    {#if data.scoring === "none"}
        <p class="mt-6 text-sm text-zinc-500">이 컬렉션은 순위를 매기지 않습니다.</p>
    {:else}
        <div class="mt-4 overflow-x-auto">
            <table class="ojik-table w-full min-w-[520px] text-sm">
                <thead class="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                    <tr>
                        <th class="w-16 font-medium">순위</th>
                        <th class="font-medium">아이디</th>
                        {#if data.scoring === "ioi"}
                            <th class="w-24 text-right font-medium">점수</th>
                        {:else}
                            <th class="w-24 text-right font-medium">푼 문제</th>
                        {/if}
                        {#if data.scoring === "icpc"}
                            <th class="w-24 text-right font-medium">페널티</th>
                        {/if}
                    </tr>
                </thead>
                <tbody>
                    {#each ranked as r (r.user_id)}
                        {@const me = session.user?.id === r.user_id}
                        <tr
                            class="border-b border-zinc-100 dark:border-zinc-900"
                            class:bg-blue-50={me}
                            class:dark:bg-blue-950={me}
                        >
                            <td class="tabular-nums text-zinc-500">{r.rank}</td>
                            <td>
                                <a href="/user/{r.handle}" class="hover:underline" class:font-semibold={me}>
                                    {r.handle}
                                </a>
                                {#if r.display_name}
                                    <span class="ml-2 text-zinc-400">{r.display_name}</span>
                                {/if}
                            </td>
                            {#if data.scoring === "ioi"}
                                <td class="text-right tabular-nums">{r.score}</td>
                            {:else}
                                <td class="text-right tabular-nums">{r.solved}</td>
                            {/if}
                            {#if data.scoring === "icpc"}
                                <td class="text-right tabular-nums text-zinc-500">{r.penalty}</td>
                            {/if}
                        </tr>
                    {:else}
                        <tr><td colspan="4" class="py-8 text-center text-zinc-400">참가자가 없습니다</td></tr>
                    {/each}
                </tbody>
            </table>
        </div>

        {#if data.scoring === "icpc"}
            <p class="mt-3 text-xs text-zinc-400">
                페널티는 문제별로 시작부터 첫 정답까지의 분에, 그 전 오답 수만큼 가산한 값의 합입니다.
                못 푼 문제의 오답은 세지 않습니다.
            </p>
        {/if}
    {/if}
{/if}
