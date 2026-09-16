<script lang="ts">
    import { page } from "$app/state";
    import { get, post, ApiError } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { formatDate } from "$lib/format";
    import { SOLUTION_LIMITS } from "@ojik/core";
    import MarkdownInput from "$lib/MarkdownInput.svelte";

    /**
     * 한 문제의 풀이 목록.
     *
     * 안 맞힌 사람은 403 을 받는다. 그때 목록 대신 "맞히면 보입니다"만 보여 준다.
     * 여기서 문제 내용을 흘리지 않으려고 제목조차 안 받아 온다.
     */

    interface SolutionRow {
        id: number;
        title: string;
        commentCount: number;
        createdAt: string;
        updatedAt: string;
        userId: number;
        handle: string;
    }

    interface Quota {
        used: number;
        limit: number;
        canUseLink: boolean;
        linkMinSolved: number;
    }

    const problemId = $derived(Number(page.params.id ?? 0));

    let rows = $state<SolutionRow[] | null>(null);
    let quota = $state<Quota | null>(null);
    let locked = $state(false);
    let error = $state<string | null>(null);

    let writing = $state(false);
    let title = $state("");
    let body = $state("");
    let busy = $state(false);
    let writeError = $state<string | null>(null);

    async function load() {
        try {
            const r = await get<{ solutions: SolutionRow[] }>("/solutions", { problemId });
            rows = r.solutions;
            locked = false;
            error = null;
            quota = await get<Quota>("/solutions/quota").catch(() => null);
        } catch (e) {
            if (e instanceof ApiError && e.status === 403) {
                locked = true;
                rows = null;
                error = null;
            } else {
                error = e instanceof Error ? e.message : String(e);
            }
        }
    }

    $effect(() => {
        void problemId;
        if (session.user) void load();
    });

    async function submit() {
        busy = true;
        writeError = null;
        try {
            await post("/solutions", { problemId, title: title.trim(), body: body.trim() });
            title = "";
            body = "";
            writing = false;
            await load();
        } catch (e) {
            writeError = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    const canSubmit = $derived(
        title.trim().length > 0 &&
            body.trim().length > 0 &&
            title.length <= SOLUTION_LIMITS.titleMax &&
            body.length <= SOLUTION_LIMITS.bodyMax,
    );
    const quotaLeft = $derived(quota ? quota.limit - quota.used : null);
</script>

<div class="flex items-baseline justify-between gap-4">
    <h1 class="text-2xl font-bold">풀이</h1>
    <a href="/problem/{problemId}" class="text-sm text-blue-600 hover:underline dark:text-blue-400">
        문제로
    </a>
</div>

{#if !session.user}
    <p class="mt-8 text-sm text-zinc-500">
        <a href="/login" class="text-blue-600 hover:underline dark:text-blue-400">로그인</a>이 필요합니다.
    </p>
{:else if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if locked}
    <div class="mt-8 rounded-md border border-zinc-200 px-6 py-10 text-center dark:border-zinc-800">
        <p class="text-sm text-zinc-500">이 문제를 맞히면 풀이를 읽고 쓸 수 있습니다.</p>
        <a
            href="/problem/{problemId}"
            class="mt-4 inline-block rounded-md bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
        >
            풀러 가기
        </a>
    </div>
{:else if rows}
    {#if !writing}
        <div class="mt-4 flex items-center gap-3">
            <button
                onclick={() => (writing = true)}
                disabled={quotaLeft !== null && quotaLeft <= 0}
                class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
                풀이 쓰기
            </button>
            {#if quota}
                <span class="text-xs text-zinc-400">
                    오늘 {quota.used} / {quota.limit}
                    {#if !quota.canUseLink}
                        · 링크는 {quota.linkMinSolved}문제부터
                    {/if}
                </span>
            {/if}
        </div>
    {:else}
        <section class="mt-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <input
                bind:value={title}
                maxlength={SOLUTION_LIMITS.titleMax}
                placeholder="제목"
                class="mb-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <MarkdownInput bind:value={body} maxLength={SOLUTION_LIMITS.bodyMax} placeholder="어떻게 풀었는지" />

            {#if writeError}
                <p class="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                    {writeError}
                </p>
            {/if}

            <div class="mt-3 flex gap-2">
                <button
                    onclick={submit}
                    disabled={busy || !canSubmit}
                    class="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                    {busy ? "올리는 중..." : "올리기"}
                </button>
                <button
                    onclick={() => {
                        writing = false;
                        writeError = null;
                    }}
                    class="rounded-md px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                    취소
                </button>
            </div>
        </section>
    {/if}

    {#if rows.length === 0}
        <p class="mt-8 text-sm text-zinc-500">아직 풀이가 없습니다. 처음으로 써 보세요.</p>
    {:else}
        <ul class="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800">
            {#each rows as s (s.id)}
                <li>
                    <a href="/solution/{s.id}" class="flex items-baseline gap-3 py-3 hover:underline">
                        <span class="flex-1 font-medium">{s.title}</span>
                        {#if s.commentCount > 0}
                            <span class="text-xs text-zinc-400">댓글 {s.commentCount}</span>
                        {/if}
                        <span class="text-xs text-zinc-400">{s.handle}</span>
                        <span class="text-xs text-zinc-400">{formatDate(s.createdAt)}</span>
                    </a>
                </li>
            {/each}
        </ul>
    {/if}
{:else}
    <p class="mt-8 text-sm text-zinc-500">불러오는 중...</p>
{/if}
