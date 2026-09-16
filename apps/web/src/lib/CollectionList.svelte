<script lang="ts">
    import { get } from "$lib/api";
    import { formatDate } from "$lib/format";
    import { PRESET_LABEL, TIMING_LABEL, type CollectionPreset } from "@ojik/core";

    /**
     * 교재, 문제집, 대회, 코딩테스트 목록을 한 컴포넌트로 그린다.
     * 서버에서 넷이 같은 테이블이라 화면도 하나면 된다. preset 만 다르게 넘긴다.
     */
    let { preset }: { preset: CollectionPreset } = $props();

    interface Row {
        id: number;
        slug: string;
        title: string;
        description: string;
        preset: CollectionPreset;
        timing: "none" | "fixed" | "per_user";
        visibility: "public" | "unlisted" | "private";
        startsAt: string | null;
        endsAt: string | null;
        durationMinutes: number | null;
    }

    let rows = $state<Row[]>([]);
    let error = $state<string | null>(null);
    let loaded = $state(false);

    $effect(() => {
        const p = preset;
        loaded = false;
        void (async () => {
            try {
                const r = await get<{ collections: Row[] }>("/collections", { preset: p });
                rows = r.collections;
                error = null;
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
            } finally {
                loaded = true;
            }
        })();
    });

    /** 시간 창이 있는 것만 진행 상태를 표시한다. 상시 컬렉션엔 의미가 없다 */
    function phase(r: Row): string | null {
        if (r.timing === "none") return null;
        if (r.timing === "per_user") return "각자 시작";
        const now = Date.now();
        if (r.startsAt && now < new Date(r.startsAt).getTime()) return "예정";
        if (r.endsAt && now > new Date(r.endsAt).getTime()) return "종료";
        return "진행 중";
    }

    function period(r: Row): string | null {
        if (r.timing === "fixed" && r.startsAt && r.endsAt) {
            return `${formatDate(r.startsAt)} ~ ${formatDate(r.endsAt)}`;
        }
        if (r.timing === "per_user" && r.durationMinutes) return `제한 ${r.durationMinutes}분`;
        if (r.endsAt) return `마감 ${formatDate(r.endsAt)}`;
        return null;
    }
</script>

<div class="flex items-baseline justify-between">
    <h1 class="text-xl font-bold">{PRESET_LABEL[preset]}</h1>
    <span class="text-sm text-zinc-400">{TIMING_LABEL[rows[0]?.timing ?? "none"]}</span>
</div>

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if !loaded}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else}
    <ul class="mt-4 divide-y divide-zinc-100 dark:divide-zinc-900">
        {#each rows as r (r.id)}
            {@const p = phase(r)}
            {@const t = period(r)}
            <li class="flex items-start gap-3 py-3">
                {#if p}
                    <span
                        class="mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs {p === '진행 중'
                            ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                            : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}">{p}</span
                    >
                {/if}
                <div class="min-w-0 flex-1">
                    <a href="/c/{r.slug}" class="font-medium hover:underline">{r.title}</a>
                    {#if r.visibility === "private"}
                        <span class="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                            비공개
                        </span>
                    {/if}
                    {#if r.description}
                        <p class="mt-1 text-sm text-zinc-500">{r.description}</p>
                    {/if}
                    {#if t}
                        <p class="mt-1 text-xs text-zinc-400">{t}</p>
                    {/if}
                </div>
            </li>
        {:else}
            <li class="py-8 text-center text-zinc-400">아직 없습니다</li>
        {/each}
    </ul>
{/if}
