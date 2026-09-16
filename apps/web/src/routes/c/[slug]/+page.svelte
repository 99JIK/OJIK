<script lang="ts">
    import { page } from "$app/state";
    import { get, post } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { formatDate } from "$lib/format";
    import { PRESET_LABEL, SCORING_LABEL, type CollectionPreset } from "@ojik/core";

    /**
     * 교재, 문제집, 대회, 코딩테스트의 상세를 한 화면으로 그린다.
     * 축 값에 따라 보이는 것이 달라질 뿐 구조는 같다.
     */

    interface Item {
        id: number;
        idx: number;
        kind: "problem" | "text";
        points: number;
        body: string | null;
        heading: string | null;
        problemId: number | null;
        problemTitle: string | null;
        timeLimitMs: number | null;
        memoryLimitMb: number | null;
    }

    interface Collection {
        id: number;
        slug: string;
        title: string;
        description: string;
        preset: CollectionPreset;
        timing: "none" | "fixed" | "per_user";
        reveal: "immediate" | "frozen" | "after_end";
        scoring: "none" | "progress" | "icpc" | "ioi";
        startsAt: string | null;
        endsAt: string | null;
        durationMinutes: number | null;
    }

    interface Detail {
        collection: Collection;
        items: Item[];
        problemCount: number;
        itemsVisible: boolean;
        canManage: boolean;
        member: { startedAt: string | null; endsAt: string | null } | null;
        running: boolean;
        ended: boolean;
        solved: number[];
    }

    const slug = $derived(page.params.slug ?? "");
    let data = $state<Detail | null>(null);
    let error = $state<string | null>(null);
    let busy = $state(false);

    async function load() {
        try {
            data = await get(`/collections/${slug}`);
            error = null;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
    }

    $effect(() => {
        void slug;
        void load();
    });

    const solvedSet = $derived(new Set(data?.solved ?? []));

    /** 코딩테스트 남은 시간. 1초마다 다시 계산한다 */
    let now = $state(Date.now());
    $effect(() => {
        if (!data?.member?.endsAt || data.ended) return;
        const t = setInterval(() => (now = Date.now()), 1000);
        return () => clearInterval(t);
    });

    const remaining = $derived.by(() => {
        const end = data?.member?.endsAt ?? data?.collection.endsAt;
        if (!end) return null;
        const ms = new Date(end).getTime() - now;
        if (ms <= 0) return null;
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        return `${m}:${String(s).padStart(2, "0")}`;
    });

    async function start() {
        if (!data) return;
        busy = true;
        try {
            await post(`/collections/${data.collection.id}/start`);
            await load();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    async function join() {
        if (!data) return;
        busy = true;
        try {
            await post(`/collections/${data.collection.id}/join`);
            await load();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }
</script>

{#if error}
    <p class="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if !data}
    <p class="text-sm text-zinc-500">불러오는 중...</p>
{:else}
    {@const c = data.collection}
    <div class="flex items-baseline justify-between gap-4">
        <div>
            <span class="text-xs text-zinc-400">{PRESET_LABEL[c.preset]}</span>
            <h1 class="text-2xl font-bold">{c.title}</h1>
        </div>
        <div class="text-right text-sm">
            {#if remaining}
                <div class="font-mono text-lg tabular-nums text-blue-600 dark:text-blue-400">
                    {remaining}
                </div>
                <div class="text-xs text-zinc-400">남은 시간</div>
            {:else if c.timing === "fixed" && c.startsAt && c.endsAt}
                <div class="text-zinc-500">{formatDate(c.startsAt)} ~ {formatDate(c.endsAt)}</div>
            {/if}
        </div>
    </div>

    {#if c.description}
        <p class="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {c.description}
        </p>
    {/if}

    {#if c.scoring !== "none"}
        <a
            href="/c/{c.slug}/scoreboard"
            class="mt-3 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
            순위표 ({SCORING_LABEL[c.scoring]})
        </a>
    {/if}

    {#if c.reveal === "after_end" && !data.ended}
        <p class="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            채점 결과는 종료 후에 공개됩니다. 제출은 정상으로 처리됩니다.
        </p>
    {/if}

    {#if !data.itemsVisible}
        <div class="mt-8 rounded-md border border-zinc-200 px-6 py-10 text-center dark:border-zinc-800">
            {#if c.timing === "per_user"}
                <p class="text-sm text-zinc-500">
                    문제 {data.problemCount}개. 시작을 누르면 {c.durationMinutes}분이 흐릅니다.
                </p>
                <p class="mt-1 text-xs text-zinc-400">한 번 시작하면 되돌릴 수 없습니다.</p>
                {#if session.user && data.member}
                    <button
                        onclick={start}
                        disabled={busy}
                        class="mt-4 rounded-md bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {busy ? "..." : "시작"}
                    </button>
                {:else if session.user}
                    <p class="mt-4 text-sm text-zinc-400">참가 대상이 아닙니다.</p>
                {:else}
                    <a href="/login" class="mt-4 inline-block text-sm text-blue-600 hover:underline">로그인</a>
                {/if}
            {:else}
                <p class="text-sm text-zinc-500">
                    아직 시작 전입니다. 문제 {data.problemCount}개.
                </p>
                {#if session.user && !data.member}
                    <button
                        onclick={join}
                        disabled={busy}
                        class="mt-4 rounded-md bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {busy ? "..." : "참가 신청"}
                    </button>
                {/if}
            {/if}
        </div>
    {:else}
        <div class="mt-8 space-y-4">
            {#each data.items as item (item.id)}
                {#if item.kind === "text"}
                    <section class="rounded-md bg-zinc-50 px-5 py-4 dark:bg-zinc-900">
                        {#if item.heading}
                            <h2 class="mb-2 font-semibold">{item.heading}</h2>
                        {/if}
                        <div class="whitespace-pre-wrap text-sm leading-relaxed">{item.body}</div>
                    </section>
                {:else}
                    <a
                        href="/problem/{item.problemId}"
                        class="flex items-center gap-3 rounded-md border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    >
                        <span class="w-6 shrink-0 text-center text-sm text-zinc-400">
                            {#if solvedSet.has(item.problemId!)}
                                <span class="text-green-600 dark:text-green-400">O</span>
                            {:else if c.preset === "contest"}
                                {String.fromCharCode(65 + item.idx)}
                            {/if}
                        </span>
                        <span class="flex-1 font-medium">{item.problemTitle}</span>
                        <span class="text-xs text-zinc-400">
                            {item.timeLimitMs} ms · {item.memoryLimitMb} MB
                        </span>
                    </a>
                {/if}
            {/each}
        </div>
    {/if}
{/if}
