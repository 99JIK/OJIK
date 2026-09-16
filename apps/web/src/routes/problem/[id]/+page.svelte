<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { get, post } from "$lib/api.js";
    import { session } from "$lib/session.svelte.js";

    /**
     * 에디터는 제출 영역이 실제로 그려질 때만 받아 온다.
     * CodeMirror 코어가 이 페이지 번들의 대부분이라, 문제만 읽고 가는 방문자에게
     * 내려보낼 이유가 없다. 측정값은 docs/development.md 의 번들 크기 절에 있다.
     *
     * $state 로 두면 ensureEditor 가 읽고 쓰면서 갱신 루프가 된다. 일부러 반응형이 아닌
     * 평범한 변수로 두고, ??= 로 한 번만 받는다
     */
    let editorPromise: Promise<typeof import("$lib/Editor.svelte")> | null = null;
    function ensureEditor() {
        editorPromise ??= import("$lib/Editor.svelte");
        return editorPromise;
    }
    import type { ProblemDetail, Sample, LanguageOption } from "$lib/types.js";

    const id = $derived(Number(page.params.id));

    let detail = $state<{
        problem: ProblemDetail;
        samples: Sample[];
        testcaseCount: number;
        canSubmit: boolean;
    } | null>(null);
    let languages = $state<LanguageOption[]>([]);
    let error = $state<string | null>(null);

    let language = $state("");
    let code = $state("");
    let submitting = $state(false);
    let submitError = $state<string | null>(null);

    $effect(() => {
        const pid = id;
        detail = null;
        error = null;
        void (async () => {
            try {
                detail = await get(`/problems/${pid}`);
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
            }
        })();
    });

    $effect(() => {
        void (async () => {
            // 선택지를 화면에 배열로 박지 않고 서버에서 받는다.
            // 언어 추가가 백엔드 한 곳에서 끝나는 이유
            const r = await get<{ languages: LanguageOption[] }>("/languages");
            languages = r.languages;
            // 마지막에 쓴 언어를 기억한다. 매번 고르게 하면 번거롭다
            const saved = localStorage.getItem("lastLanguage");
            language = saved && r.languages.some((l) => l.id === saved) ? saved : (r.languages[0]?.id ?? "");
        })();
    });

    const mode = $derived(languages.find((l) => l.id === language)?.editorMode ?? "cpp");

    async function submit() {
        if (!code.trim()) {
            submitError = "코드를 입력해 주세요";
            return;
        }
        submitting = true;
        submitError = null;
        try {
            localStorage.setItem("lastLanguage", language);
            await post("/submissions", { problemId: id, language, sourceCode: code });
            void goto(`/submissions?problemId=${id}`);
        } catch (e) {
            submitError = e instanceof Error ? e.message : String(e);
        } finally {
            submitting = false;
        }
    }
</script>

{#if error}
    <p class="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
{:else if !detail}
    <p class="text-sm text-zinc-500">불러오는 중...</p>
{:else}
    {@const p = detail.problem}
    <div class="flex items-baseline justify-between gap-4">
        <h1 class="text-2xl font-bold">{p.id}. {p.title}</h1>
        <a href="/submissions?problemId={p.id}" class="text-sm text-blue-600 hover:underline dark:text-blue-400">
            채점 현황
        </a>
    </div>

    <dl class="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-zinc-200 bg-zinc-200 text-sm sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-800">
        {#each [["시간 제한", `${p.timeLimitMs} ms`], ["메모리 제한", `${p.memoryLimitMb} MB`], ["테스트케이스", `${detail.testcaseCount}개`], ["맞힌 사람", `${p.acceptedCount}명`]] as [k, v] (k)}
            <div class="bg-white px-3 py-2 dark:bg-zinc-950">
                <dt class="text-xs text-zinc-500">{k}</dt>
                <dd class="tabular-nums">{v}</dd>
            </div>
        {/each}
    </dl>

    <section class="mt-8 space-y-6">
        <div>
            <h2 class="mb-2 text-lg font-semibold">문제</h2>
            <div class="whitespace-pre-wrap text-sm leading-relaxed">{p.statement}</div>
        </div>
        {#if p.inputDesc}
            <div>
                <h2 class="mb-2 text-lg font-semibold">입력</h2>
                <div class="whitespace-pre-wrap text-sm leading-relaxed">{p.inputDesc}</div>
            </div>
        {/if}
        {#if p.outputDesc}
            <div>
                <h2 class="mb-2 text-lg font-semibold">출력</h2>
                <div class="whitespace-pre-wrap text-sm leading-relaxed">{p.outputDesc}</div>
            </div>
        {/if}

        {#each detail.samples as s, i (s.idx)}
            <div class="grid gap-3 sm:grid-cols-2">
                <div>
                    <h3 class="mb-1 text-sm font-semibold">예제 입력 {i + 1}</h3>
                    <pre class="overflow-x-auto rounded-md bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-900">{s.input}</pre>
                </div>
                <div>
                    <h3 class="mb-1 text-sm font-semibold">예제 출력 {i + 1}</h3>
                    <pre class="overflow-x-auto rounded-md bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-900">{s.output}</pre>
                </div>
            </div>
        {/each}

        {#if p.hint}
            <div>
                <h2 class="mb-2 text-lg font-semibold">힌트</h2>
                <div class="whitespace-pre-wrap text-sm leading-relaxed">{p.hint}</div>
            </div>
        {/if}
    </section>

    <section class="mt-10">
        <h2 class="mb-3 text-lg font-semibold">제출</h2>

        {#if !session.user}
            <p class="rounded-md bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
                <a href="/login" class="text-blue-600 hover:underline dark:text-blue-400">로그인</a>하면 제출할 수 있습니다.
            </p>
        {:else if !detail.canSubmit}
            <p class="rounded-md bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">지금은 제출할 수 없는 문제입니다.</p>
        {:else}
            <div class="mb-2 flex items-center gap-3">
                <select
                    bind:value={language}
                    class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                    {#each languages as l (l.id)}
                        <option value={l.id}>{l.label}</option>
                    {/each}
                </select>
                <span class="text-xs text-zinc-500">{detail.problem.checkerType === "trim" ? "줄 끝 공백은 무시됩니다" : ""}</span>
            </div>

            {#if language}
                {#await ensureEditor()}
                    <div
                        class="h-80 animate-pulse rounded-md border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
                    ></div>
                {:then m}
                    {@const Editor = m.default}
                    <Editor bind:value={code} {mode} />
                {:catch}
                    <textarea
                        bind:value={code}
                        class="h-80 w-full rounded-md border border-zinc-300 p-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        placeholder="에디터를 불러오지 못했습니다. 여기에 코드를 붙여넣어도 제출됩니다."
                    ></textarea>
                {/await}
            {/if}

            {#if submitError}
                <p class="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                    {submitError}
                </p>
            {/if}

            <button
                onclick={submit}
                disabled={submitting}
                class="mt-3 rounded-md bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
                {submitting ? "제출 중..." : "제출"}
            </button>
        {/if}
    </section>
{/if}
