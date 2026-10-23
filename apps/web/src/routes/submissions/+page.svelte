<script lang="ts">
    import { page } from "$app/state";
    import { get, post } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { meta, queue } from "$lib/meta.svelte";
    import { verdictClass, verdictText, formatMemory, formatTime, formatDate } from "$lib/format";
    import { VERDICTS, VERDICT_LABEL, type Verdict } from "@ojik/core";
    import type { SubmissionRow } from "$lib/types";

    const problemId = $derived(page.url.searchParams.get("problemId") ?? "");
    const handle = $derived(page.url.searchParams.get("handle") ?? "");

    /**
     * 판정으로 거르기.
     *
     * 운영에서 제일 자주 쓰는 건 "채점 오류만 모아서 전부 다시" 다. 워커나 러너를 고친 뒤에
     * 반드시 하는 일인데, 번호를 하나씩 찾아 누르는 것 말고는 방법이 없었다.
     */
    let verdict = $state<Verdict | "">("");

    let rows = $state<SubmissionRow[]>([]);
    let error = $state<string | null>(null);
    let loaded = $state(false);

    async function load() {
        try {
            const r = await get<{ submissions: SubmissionRow[] }>("/submissions", {
                problemId,
                handle,
                verdict,
                limit: 50,
            });
            rows = r.submissions;
            error = null;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loaded = true;
        }
    }

    /**
     * 채점이 끝나지 않은 행이 있을 때만 다시 물어본다.
     * 전부 끝났으면 폴링을 멈춘다. 가만히 보고 있는 화면이 서버를 계속 두드릴 이유가 없다.
     */
    const pending = $derived(rows.some((r) => r.status === "queued" || r.status === "judging"));

    $effect(() => {
        void problemId;
        void handle;
        void verdict;
        void load();
    });

    // 언어 이름을 c 가 아니라 C17 로 보여주기 위해 한 번 받아 둔다
    $effect(() => {
        void meta.ensureLanguages();
        void queue.refresh();
    });

    $effect(() => {
        if (!pending) return;
        const t = setInterval(load, 1000);
        return () => clearInterval(t);
    });

    async function rejudge(id: number) {
        await post(`/submissions/${id}/rejudge`);
        void load();
    }

    /* 고른 제출. 다시 불러와도 선택이 남게 Set 으로 둔다 */
    let picked = $state<Set<number>>(new Set());
    let busy = $state(false);

    function toggle(id: number) {
        const next = new Set(picked);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        picked = next;
    }

    const allShown = $derived(rows.length > 0 && rows.every((r) => picked.has(r.id)));
    function toggleAll() {
        const next = new Set(picked);
        if (allShown) for (const r of rows) next.delete(r.id);
        else for (const r of rows) next.add(r.id);
        picked = next;
    }

    /**
     * 고른 것을 한 번에 다시 채점한다.
     *
     * 판정으로 걸러 놓고 전체선택을 누르는 흐름을 전제로 한다. 채점기를 고친 뒤
     * 오류난 제출 수십 건을 되살리는 게 이 버튼을 만든 이유다.
     */
    async function rejudgePicked() {
        const ids = [...picked];
        if (ids.length === 0) return;
        if (!confirm(`${ids.length}건을 다시 채점합니다. 계속할까요?`)) return;
        busy = true;
        try {
            const r = await post<{ requeued: number }>("/submissions/rejudge", { ids });
            picked = new Set();
            error = null;
            await load();
            if (r.requeued !== ids.length) {
                // 그 사이 지워진 제출이 있으면 수가 안 맞는다. 조용히 넘기지 않는다
                error = `${ids.length}건 중 ${r.requeued}건만 큐에 들어갔습니다. 나머지는 사라진 제출입니다.`;
            }
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }
</script>

<div class="flex items-center justify-between">
    <h1 class="text-xl font-bold">
        채점 현황
        {#if problemId}<span class="ml-2 text-sm font-normal text-zinc-500">문제 {problemId}</span>{/if}
    </h1>
    <div class="flex items-center gap-3 text-sm">
        {#if queue.loaded && (queue.queued > 0 || queue.judging > 0)}
            <span class="text-zinc-500">
                대기 {queue.queued}건{queue.judging > 0 ? ` · 채점 중 ${queue.judging}건` : ""}
            </span>
        {/if}
        {#if queue.stalled}
            <span class="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                채점기 응답 없음
            </span>
        {/if}
        {#if pending}
            <span class="text-blue-600 dark:text-blue-400">갱신 중</span>
        {/if}
    </div>
</div>

<div class="mt-4 flex flex-wrap items-center gap-3 text-sm">
    <select bind:value={verdict} class="ojik-input w-44">
        <option value="">판정 전체</option>
        {#each VERDICTS as v (v)}
            <option value={v}>{VERDICT_LABEL[v]}</option>
        {/each}
    </select>

    {#if session.isStaff}
        <button class="ojik-btn" disabled={busy || picked.size === 0} onclick={rejudgePicked}>
            {busy ? "보내는 중..." : `고른 것 재채점${picked.size > 0 ? ` (${picked.size})` : ""}`}
        </button>
        {#if picked.size > 0}
            <button class="text-xs text-zinc-500 hover:underline" onclick={() => (picked = new Set())}>
                선택 해제
            </button>
        {/if}
    {/if}
</div>

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
{:else if !loaded}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else}
    <div class="mt-4 overflow-x-auto">
        <table class="ojik-table w-full min-w-[720px] text-sm">
            <thead class="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                <tr>
                    {#if session.isStaff}
                        <th class="w-8">
                            <input
                                type="checkbox"
                                checked={allShown}
                                onchange={toggleAll}
                                aria-label="보이는 제출 전체 선택"
                            />
                        </th>
                    {/if}
                    <th class="nowrap w-20 font-medium">번호</th>
                    <th class="nowrap w-28 font-medium">아이디</th>
                    <th class="font-medium">문제</th>
                    <th class="nowrap w-36 font-medium">결과</th>
                    <th class="nowrap w-20 text-right font-medium">시간</th>
                    <th class="nowrap w-24 text-right font-medium">메모리</th>
                    <th class="nowrap w-32 font-medium">언어</th>
                    <th class="nowrap w-36 font-medium">제출 시각</th>
                    {#if session.isStaff}<th class="w-20"></th>{/if}
                </tr>
            </thead>
            <tbody>
                {#each rows as r (r.id)}
                    <tr class="border-b border-zinc-100 dark:border-zinc-900">
                        {#if session.isStaff}
                            <td>
                                <input
                                    type="checkbox"
                                    checked={picked.has(r.id)}
                                    onchange={() => toggle(r.id)}
                                    aria-label="{r.id}번 선택"
                                />
                            </td>
                        {/if}
                        <td class="nowrap tabular-nums text-zinc-500">
                            <a href="/submission/{r.id}" class="hover:underline">{r.id}</a>
                        </td>
                        <td class="nowrap">
                            <a href="/submissions?handle={r.handle}" class="hover:underline">{r.handle}</a>
                        </td>
                        <!-- 제목만 길 수 있다. 넘치면 말줄임하고 나머지 칸은 안 밀리게 -->
                        <td class="clip">
                            <a href="/problem/{r.problemId}" class="hover:underline" title={r.problemTitle}>
                                {r.problemTitle}
                            </a>
                        </td>
                        <td class="nowrap {verdictClass(r.verdict, r.status)}">
                            {verdictText(r.verdict, r.status, r.judgedCount, r.totalCount)}
                        </td>
                        <td class="nowrap text-right tabular-nums text-zinc-500">{formatTime(r.maxTimeMs)}</td>
                        <td class="nowrap text-right tabular-nums text-zinc-500">{formatMemory(r.maxMemoryKb)}</td>
                        <td class="nowrap text-zinc-500">{r.language ? meta.label(r.language) : "-"}</td>
                        <td class="nowrap text-zinc-500">{formatDate(r.createdAt)}</td>
                        {#if session.isStaff}
                            <td>
                                <button onclick={() => rejudge(r.id)} class="text-xs text-blue-600 hover:underline dark:text-blue-400">
                                    재채점
                                </button>
                            </td>
                        {/if}
                    </tr>
                {:else}
                    <tr>
                        <!-- 운영자는 체크박스와 재채점 열이 더 붙는다 -->
                        <td colspan={session.isStaff ? 10 : 8} class="py-8 text-center text-zinc-400">
                            제출이 없습니다
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
{/if}
