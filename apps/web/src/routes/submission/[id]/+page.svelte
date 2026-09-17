<script lang="ts">
    import { page } from "$app/state";
    import { get } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { meta } from "$lib/meta.svelte";
    import { verdictClass, verdictText, formatMemory, formatTime, formatDate } from "$lib/format";
    import {
        VERDICT_LABEL,
        PROBLEM_KIND_LABEL,
        getLanguage,
        type Verdict,
        type SubmissionStatus,
        type ProblemKind,
    } from "@ojik/core";
    import CodeView from "$lib/CodeView.svelte";

    interface Detail {
        id: number;
        problemId: number;
        userId: number;
        /** 단답형에는 언어가 없다 */
        language: string | null;
        sourceCode: string | null;
        status: SubmissionStatus;
        verdict: Verdict | null;
        score: number;
        maxTimeMs: number | null;
        maxMemoryKb: number | null;
        judgedCount: number;
        totalCount: number;
        compileOutput: string | null;
        judgeError: string | null;
        failedIdx: number | null;
        failedStdout: string | null;
        failedStderr: string | null;
        createdAt: string;
    }

    interface Result {
        idx: number;
        verdict: Verdict;
        timeMs: number;
        memoryKb: number;
        points: number;
    }

    const id = $derived(Number(page.params.id));
    interface AnswerRow {
        idx: number;
        prompt: string;
        given: string;
    }

    let data = $state<{
        submission: Detail;
        results: Result[];
        verdictHidden: boolean;
        problemKind: ProblemKind;
        /** 단답형일 때만. 그 외에는 null */
        answers: AnswerRow[] | null;
    } | null>(null);
    let error = $state<string | null>(null);

    async function load() {
        try {
            data = await get(`/submissions/${id}`);
            error = null;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
    }

    $effect(() => {
        void id;
        void load();
    });

    $effect(() => {
        void meta.ensureLanguages();
    });

    const pending = $derived(
        data ? data.submission.status === "queued" || data.submission.status === "judging" : false,
    );

    $effect(() => {
        if (!pending) return;
        const t = setInterval(load, 1000);
        return () => clearInterval(t);
    });
</script>

{#if error}
    <p class="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
{:else if !data}
    <p class="text-sm text-zinc-500">불러오는 중...</p>
{:else}
    {@const s = data.submission}
    <div class="flex items-baseline justify-between">
        <h1 class="text-xl font-bold">제출 {s.id}</h1>
        <a href="/problem/{s.problemId}" class="text-sm text-blue-600 hover:underline dark:text-blue-400">
            문제 {s.problemId}
        </a>
    </div>

    <div
        class="mt-4 flex flex-wrap items-center gap-6 rounded-md border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800"
    >
        <span class={verdictClass(s.verdict, s.status)}>
            {verdictText(s.verdict, s.status, s.judgedCount, s.totalCount)}
        </span>
        <span class="text-zinc-500">{formatTime(s.maxTimeMs)}</span>
        <span class="text-zinc-500">{formatMemory(s.maxMemoryKb)}</span>
        {#if s.language}
            <span class="text-zinc-500">{meta.label(s.language)}</span>
        {:else}
            <span class="text-zinc-500">{PROBLEM_KIND_LABEL[data.problemKind]}</span>
        {/if}
        <span class="text-zinc-500">{formatDate(s.createdAt)}</span>

        <!--
            부분점수.

            맞았는지만 보여 주면 70점을 받았는지 0점을 받았는지 알 수가 없다. 채점기는
            전부터 케이스별 배점으로 점수를 냈는데 화면에 나오는 곳이 없었다.
            전부 맞힌 제출에는 안 띄운다. 만점인 게 당연해서 자리만 차지한다
        -->
        {#if !data.verdictHidden && s.verdict !== "accepted" && s.score > 0}
            <span class="font-medium text-amber-600 dark:text-amber-400">{s.score}점</span>
        {/if}
    </div>

    {#if data.verdictHidden}
        <p class="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            채점은 끝났습니다. 결과는 종료 후에 공개됩니다.
        </p>
    {/if}

    <!-- 몇 번째에서 틀렸는지는 늘 보여 준다. 출력은 공개 예제일 때만 채점기가 남긴다 -->
    {#if s.failedIdx !== null}
        <section class="mt-6">
            <h2 class="mb-2 text-sm font-semibold">{s.failedIdx + 1}번 케이스에서 틀렸습니다</h2>
            {#if s.failedStdout !== null || s.failedStderr !== null}
                <div class="grid gap-3 sm:grid-cols-2">
                    {#if s.failedStdout !== null}
                        <div>
                            <h3 class="mb-1 text-xs text-zinc-500">내 출력</h3>
                            <pre class="max-h-60 overflow-auto rounded-md bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-900">{s.failedStdout}</pre>
                        </div>
                    {/if}
                    {#if s.failedStderr}
                        <div>
                            <h3 class="mb-1 text-xs text-zinc-500">표준 오류</h3>
                            <pre class="max-h-60 overflow-auto rounded-md bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-900">{s.failedStderr}</pre>
                        </div>
                    {/if}
                </div>
                <p class="mt-2 text-xs text-zinc-400">정답 출력은 보여주지 않습니다.</p>
            {:else}
                <p class="text-xs text-zinc-400">
                    공개 예제가 아니라서 출력은 보여주지 않습니다. 예제로 먼저 확인해 보세요.
                </p>
            {/if}
        </section>
    {/if}

    {#if s.compileOutput}
        <section class="mt-6">
            <h2 class="mb-2 text-sm font-semibold">컴파일 메시지</h2>
            <pre
                class="overflow-x-auto rounded-md bg-orange-50 p-3 font-mono text-xs text-orange-900 dark:bg-orange-950 dark:text-orange-200">{s.compileOutput}</pre>
        </section>
    {/if}

    {#if s.judgeError && session.isStaff}
        <section class="mt-6">
            <h2 class="mb-2 text-sm font-semibold">채점 오류 (운영자만 보임)</h2>
            <pre class="overflow-x-auto rounded-md bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-900">{s.judgeError}</pre>
        </section>
    {/if}

    {#if data.results.length > 0}
        <!-- {@const} 는 블록의 바로 아래 자식이어야 한다. section 안에는 못 둔다 -->
        {@const earned = data.results.reduce((a, r) => a + (r.verdict === "accepted" ? r.points : 0), 0)}
        {@const offered = data.results.reduce((a, r) => a + r.points, 0)}
        <section class="mt-6">
            <div class="mb-2 flex items-baseline justify-between gap-3">
                <h2 class="text-sm font-semibold">테스트케이스</h2>
                <!-- 배점이 붙은 문제에서만. 전부 0 이면 통과 개수 비율로 환산되므로 뜻이 없다 -->
                {#if offered > 0}
                    <span class="text-xs text-zinc-400">배점 {earned} / {offered}</span>
                {/if}
            </div>

            <div class="flex flex-wrap gap-1">
                {#each data.results as r (r.idx)}
                    {@const ok = r.verdict === "accepted"}
                    <span
                        title="{r.idx + 1}번: {VERDICT_LABEL[r.verdict]} / {r.timeMs}ms / {formatMemory(
                            r.memoryKb,
                        )}{r.points > 0 ? ` / ${r.points}점` : ''}"
                        class="rounded px-2 py-1 text-xs tabular-nums {ok
                            ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}">{r.idx + 1}</span
                    >
                {/each}
            </div>
            <p class="mt-2 text-xs text-zinc-400">
                번호에 마우스를 올리면 케이스별 결과가 보입니다. 첫 오답에서 중단하는 문제는 뒤쪽 케이스가
                없을 수 있습니다.
            </p>
        </section>
    {/if}

    <section class="mt-6">
        {#if data.answers}
            <h2 class="mb-2 text-sm font-semibold">낸 답</h2>
            <ul class="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
                {#each data.answers as a (a.idx)}
                    {@const r = data.results.find((x) => x.idx === a.idx)}
                    <li class="px-4 py-3">
                        <div class="flex items-baseline gap-2">
                            <span class="text-xs text-zinc-400">{a.idx + 1}</span>
                            <span class="flex-1 text-sm">{a.prompt}</span>
                            {#if r}
                                <span class="text-xs {verdictClass(r.verdict, 'done')}">
                                    {r.verdict === "accepted" ? `+${r.points}` : "0"}
                                </span>
                            {/if}
                        </div>
                        <p class="mt-1 whitespace-pre-wrap font-mono text-sm {a.given.trim() ? '' : 'text-zinc-400'}">
                            {a.given.trim() || "(비움)"}
                        </p>
                    </li>
                {/each}
            </ul>
            <p class="mt-2 text-xs text-zinc-400">기대 답은 보여주지 않습니다.</p>
        {:else}
            <h2 class="mb-2 text-sm font-semibold">소스 코드</h2>
            {#if s.sourceCode !== null}
                <CodeView code={s.sourceCode} mode={getLanguage(s.language ?? "")?.editorMode ?? "cpp"} />
            {:else}
                <p class="rounded-md bg-zinc-100 px-4 py-3 text-sm text-zinc-500 dark:bg-zinc-900">
                    이 제출의 소스는 공개되어 있지 않습니다.
                </p>
            {/if}
        {/if}
    </section>
{/if}
