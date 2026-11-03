<script lang="ts">
    import { page } from "$app/state";
    import { get, post } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { formatDate } from "$lib/format";
    import {
        PRESET_LABEL,
        SCORING_LABEL,
        PROBLEM_KIND_LABEL,
        type CollectionPreset,
        type ProblemKind,
    } from "@ojik/core";
    import Markdown from "$lib/Markdown.svelte";

    /**
     * 교재, 문제집, 대회, 코딩테스트의 상세를 한 화면으로 그린다.
     * 축 값에 따라 보이는 것이 달라질 뿐 구조는 같다.
     */

    interface Item {
        id: number;
        idx: number;
        kind: "problem" | "text";
        points: number;
        /** 항목별 마감. 없으면 마감 없음 */
        dueAt: string | null;
        body: string | null;
        heading: string | null;
        problemId: number | null;
        problemTitle: string | null;
        problemKind: ProblemKind | null;
        timeLimitMs: number | null;
        memoryLimitMb: number | null;
    }

    /** 문제별 내 상태 */
    interface Mine {
        problemId: number;
        solved: boolean;
        best: number;
        tries: number;
        firstSolvedAt: string | null;
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
        mine: Mine[];
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
    const mineBy = $derived(new Map((data?.mine ?? []).map((m) => [m.problemId, m])));

    const problemItems = $derived((data?.items ?? []).filter((i) => i.kind === "problem"));
    const solvedHere = $derived(problemItems.filter((i) => solvedSet.has(i.problemId!)).length);

    /**
     * 마감 상태.
     *
     * 넘겨도 제출은 막지 않는다. 수업에서는 늦어도 받고 감점하는 쪽이 보통이라서다.
     * 대신 지났는지, 곧인지를 눈에 띄게 둔다.
     */
    function dueState(item: Item): { text: string; cls: string } | null {
        if (!item.dueAt) return null;
        const due = new Date(item.dueAt).getTime();
        const left = due - now;
        const m = mineBy.get(item.problemId ?? -1);

        // 이미 제때 풀었으면 마감은 더 볼 일이 없다
        if (m?.firstSolvedAt && new Date(m.firstSolvedAt).getTime() <= due) {
            return { text: "제출 완료", cls: "text-green-600 dark:text-green-400" };
        }
        if (m?.solved) {
            return { text: "지각 제출", cls: "text-amber-600 dark:text-amber-400" };
        }
        if (left < 0) {
            return { text: `마감 지남 (${formatDate(item.dueAt)})`, cls: "text-red-600 dark:text-red-400" };
        }
        if (left < 24 * 60 * 60 * 1000) {
            const h = Math.floor(left / 3600000);
            const mm = Math.floor((left % 3600000) / 60000);
            return { text: `${h}시간 ${mm}분 남음`, cls: "text-amber-600 dark:text-amber-400" };
        }
        return { text: `마감 ${formatDate(item.dueAt)}`, cls: "text-zinc-400" };
    }

    /** 코딩테스트 남은 시간. 1초마다 다시 계산한다 */
    let now = $state(Date.now());
    $effect(() => {
        // 개인 타이머가 없어도 마감 표시가 흘러가야 하므로 늘 돈다.
        // 타이머가 있으면 1초, 없으면 30초. 마감은 초 단위로 볼 일이 없다
        const fast = !!data?.member?.endsAt && !data.ended;
        const t = setInterval(() => (now = Date.now()), fast ? 1000 : 30_000);
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
        <div class="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            <Markdown source={c.description} compact />
        </div>
    {/if}

    <!--
        내 진도.
        학생이 제일 먼저 궁금해하는 것이고, 전에는 강사만 명단에서 볼 수 있었다.
    -->
    {#if session.user && data.itemsVisible && problemItems.length > 0}
        {@const pct = Math.round((solvedHere / problemItems.length) * 100)}
        <div class="mt-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <div class="flex items-baseline justify-between gap-3">
                <span class="text-sm font-medium">내 진도</span>
                <span class="text-sm tabular-nums">
                    {solvedHere} / {problemItems.length}
                    <span class="ml-1 text-xs text-zinc-400">{pct}%</span>
                </span>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                    class="h-full rounded-full {solvedHere === problemItems.length
                        ? 'bg-green-500'
                        : 'bg-blue-500'}"
                    style="width: {pct}%"
                ></div>
            </div>
        </div>
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
                        <Markdown source={item.body ?? ""} />
                    </section>
                {:else}
                    {@const m = mineBy.get(item.problemId ?? -1)}
                    {@const d = dueState(item)}
                    <a
                        href="/problem/{item.problemId}"
                        class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    >
                        <span class="w-6 shrink-0 text-center text-sm">
                            {#if m?.solved}
                                <span class="text-green-600 dark:text-green-400" title="맞혔습니다">●</span>
                            {:else if m}
                                <span class="text-amber-500 dark:text-amber-400" title="{m.tries}번 냈지만 못 맞혔습니다">●</span>
                            {:else if c.preset === "contest"}
                                <span class="text-zinc-400">{String.fromCharCode(65 + item.idx)}</span>
                            {/if}
                        </span>

                        <span class="min-w-0 flex-1">
                            <span class="font-medium">{item.problemTitle}</span>
                            {#if item.problemKind && item.problemKind !== "code"}
                                <span class="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                    {PROBLEM_KIND_LABEL[item.problemKind]}
                                </span>
                            {/if}
                            {#if d}
                                <span class="ml-1.5 text-xs {d.cls}">{d.text}</span>
                            {/if}
                        </span>

                        <!-- 부분점수 문제는 맞힘 여부만으로 부족하다. 70점인지 0점인지가 안 보인다 -->
                        {#if m && m.best > 0 && !m.solved}
                            <span class="shrink-0 text-xs tabular-nums text-amber-600 dark:text-amber-400">
                                {m.best}점
                            </span>
                        {/if}

                        <span class="shrink-0 text-xs text-zinc-400">
                            {item.timeLimitMs} ms · {item.memoryLimitMb} MB
                        </span>
                    </a>
                {/if}
            {/each}
        </div>
    {/if}
{/if}
