<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { get } from "$lib/api";
    import { acceptRate } from "$lib/format";
    import { session } from "$lib/session.svelte";
    import { PROBLEM_KIND_LABEL } from "@ojik/core";
    import type { ProblemSummary } from "$lib/types";

    /**
     * 문제 목록.
     *
     * 검색어와 페이지를 주소에 둔다. 상태로만 들고 있으면 새로고침에 1페이지로 돌아가고
     * "난이도순 3페이지" 를 남에게 보낼 수가 없다.
     */
    const LIMIT = 50;

    const q = $derived(page.url.searchParams.get("q") ?? "");
    const offset = $derived(Math.max(0, Number(page.url.searchParams.get("offset") ?? 0) || 0));

    let searchBox = $state("");
    let data = $state<{
        problems: ProblemSummary[];
        solved: number[];
        tried: number[];
        total: number;
    } | null>(null);
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

    $effect(() => {
        void q;
        void offset;
        void load();
    });

    // 주소의 검색어가 바뀌면 입력칸도 맞춘다. 뒤로 가기로 왔을 때 칸이 어긋나지 않게
    $effect(() => {
        searchBox = q;
    });

    function move(next: { q?: string; offset?: number }) {
        const u = new URLSearchParams(page.url.searchParams);
        const nq = next.q ?? q;
        const no = next.offset ?? 0;
        if (nq) u.set("q", nq);
        else u.delete("q");
        if (no > 0) u.set("offset", String(no));
        else u.delete("offset");
        void goto(`?${u.toString()}`, { keepFocus: true, noScroll: true });
    }

    const solvedSet = $derived(new Set(data?.solved ?? []));
    const triedSet = $derived(new Set(data?.tried ?? []));

    const total = $derived(data?.total ?? 0);
    const pageCount = $derived(Math.max(1, Math.ceil(total / LIMIT)));
    const pageNo = $derived(Math.floor(offset / LIMIT) + 1);
    const from = $derived(total === 0 ? 0 : offset + 1);
    const to = $derived(Math.min(offset + LIMIT, total));

    /**
     * 내 상태. 맞힘과 시도함을 나눈다.
     *
     * 안 푼 문제와 틀린 문제가 같아 보이면 목록에서 "다시 볼 것" 을 못 찾는다.
     * 제목 링크 밖에 두는 건 표시에 밑줄이 같이 그어지지 않게 하려는 것이다.
     */
    function mark(id: number): { text: string; cls: string; title: string } | null {
        if (solvedSet.has(id)) {
            return { text: "●", cls: "text-green-600 dark:text-green-400", title: "맞혔습니다" };
        }
        if (triedSet.has(id)) {
            return { text: "●", cls: "text-amber-500 dark:text-amber-400", title: "시도했지만 못 맞혔습니다" };
        }
        return null;
    }
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-xl font-bold">문제</h1>
    <form
        onsubmit={(e) => {
            e.preventDefault();
            move({ q: searchBox.trim(), offset: 0 });
        }}
        class="flex gap-2"
    >
        <input
            bind:value={searchBox}
            placeholder="제목 검색"
            class="w-56 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {#if q}
            <button
                type="button"
                onclick={() => move({ q: "", offset: 0 })}
                class="rounded-md px-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
                지우기
            </button>
        {/if}
    </form>
</div>

{#if session.user}
    <p class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
        <span><span class="text-green-600 dark:text-green-400">●</span> 맞힘</span>
        <span><span class="text-amber-500 dark:text-amber-400">●</span> 시도함</span>
    </p>
{/if}

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if !data && loading}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else if data}
    <div class="mt-4 overflow-x-auto">
        <table class="ojik-table w-full text-sm">
            <thead class="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                <tr>
                    <th class="w-8"></th>
                    <th class="w-16 font-medium">번호</th>
                    <th class="font-medium">제목</th>
                    <th class="w-24 text-right font-medium">맞힌 수</th>
                    <th class="w-24 text-right font-medium">정답 비율</th>
                </tr>
            </thead>
            <tbody>
                {#each data.problems as p (p.id)}
                    {@const m = mark(p.id)}
                    <tr class="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900">
                        <td class="text-center">
                            {#if m}
                                <span class="text-xs {m.cls}" title={m.title}>{m.text}</span>
                            {/if}
                        </td>
                        <td class="tabular-nums text-zinc-500">{p.id}</td>
                        <td>
                            <a href="/problem/{p.id}" class="hover:underline">{p.title}</a>
                            {#if p.kind !== "code"}
                                <span class="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                    {PROBLEM_KIND_LABEL[p.kind]}
                                </span>
                            {/if}
                            {#if !p.isPublic}
                                <span class="ml-1.5 rounded bg-zinc-200 px-1.5 py-0.5 text-xs dark:bg-zinc-800">비공개</span>
                            {/if}
                        </td>
                        <td class="text-right tabular-nums">{p.acceptedCount}</td>
                        <td class="text-right tabular-nums text-zinc-500">
                            {acceptRate(p.acceptedCount, p.submissionCount)}
                        </td>
                    </tr>
                {:else}
                    <tr>
                        <td colspan="5" class="py-10 text-center text-zinc-400">
                            {q ? `"${q}" 에 맞는 문제가 없습니다` : "문제가 없습니다"}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>

    <!--
        페이지 이동은 문제가 한 페이지를 넘을 때만 보여 준다.
        전에는 전체 개수를 몰라서 마지막 페이지에서도 다음이 눌렸고 빈 목록이 나왔다.
    -->
    {#if total > 0}
        <div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span class="text-xs text-zinc-400">
                {total}개 중 {from}–{to}
            </span>

            {#if pageCount > 1}
                <div class="flex items-center gap-2">
                    <button
                        onclick={() => move({ offset: Math.max(0, offset - LIMIT) })}
                        disabled={offset === 0}
                        class="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
                    >
                        이전
                    </button>
                    <span class="text-xs tabular-nums text-zinc-500">{pageNo} / {pageCount}</span>
                    <button
                        onclick={() => move({ offset: offset + LIMIT })}
                        disabled={pageNo >= pageCount}
                        class="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
                    >
                        다음
                    </button>
                </div>
            {/if}
        </div>
    {/if}
{/if}
