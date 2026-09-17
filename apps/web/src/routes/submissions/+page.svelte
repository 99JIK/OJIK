<script lang="ts">
    import { page } from "$app/state";
    import { get, post } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { meta, queue } from "$lib/meta.svelte";
    import { verdictClass, verdictText, formatMemory, formatTime, formatDate } from "$lib/format";
    import type { SubmissionRow } from "$lib/types";

    const problemId = $derived(page.url.searchParams.get("problemId") ?? "");
    const handle = $derived(page.url.searchParams.get("handle") ?? "");

    let rows = $state<SubmissionRow[]>([]);
    let error = $state<string | null>(null);
    let loaded = $state(false);

    async function load() {
        try {
            const r = await get<{ submissions: SubmissionRow[] }>("/submissions", {
                problemId,
                handle,
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

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
{:else if !loaded}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else}
    <div class="mt-4 overflow-x-auto">
        <table class="ojik-table w-full min-w-[720px] text-sm">
            <thead class="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                <tr>
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
                    <tr><td colspan="9" class="py-8 text-center text-zinc-400">제출이 없습니다</td></tr>
                {/each}
            </tbody>
        </table>
    </div>
{/if}
