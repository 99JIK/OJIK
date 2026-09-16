<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { get, post } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { meta } from "$lib/meta.svelte";
    import Markdown from "$lib/Markdown.svelte";

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
    import type { ProblemDetail, Sample, LanguageOption } from "$lib/types";

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
            await meta.ensureLanguages();
            languages = meta.languages;
            // 마지막에 쓴 언어를 기억한다. 매번 고르게 하면 번거롭다
            const saved = localStorage.getItem("lastLanguage");
            language = saved && languages.some((l) => l.id === saved) ? saved : (languages[0]?.id ?? "");
        })();
    });

    /**
     * 작성 중인 코드를 브라우저에 남긴다.
     *
     * 탭을 닫거나 새로고침해서 코드를 잃는 일이 흔하다. 문제와 언어별로 따로 보관해서
     * 언어를 바꿔 가며 풀어도 섞이지 않는다. 제출에 성공하면 지운다.
     */
    const draftKey = $derived(`draft:${id}:${language}`);
    let restored = $state(false);

    $effect(() => {
        const k = draftKey;
        if (!language) return;
        restored = false;
        try {
            const saved = localStorage.getItem(k);
            if (saved) {
                code = saved;
                restored = true;
            } else {
                code = "";
            }
        } catch {
            // 사생활 보호 모드 등에서 localStorage 가 막힐 수 있다. 그냥 안 쓴다
        }
    });

    $effect(() => {
        const k = draftKey;
        const c = code;
        if (!language) return;
        // 타이핑마다 쓰면 낭비다. 멈춘 뒤에 한 번 쓴다
        const t = setTimeout(() => {
            try {
                if (c.trim()) localStorage.setItem(k, c);
                else localStorage.removeItem(k);
            } catch {
                // 저장이 막혀도 작성은 계속돼야 한다
            }
        }, 800);
        return () => clearTimeout(t);
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
            // 제출에 성공했으니 임시 보관본은 지운다
            try {
                localStorage.removeItem(draftKey);
            } catch {
                // 못 지워도 다음 제출 때 덮어쓴다
            }
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
            <Markdown source={p.statement} />
        </div>
        {#if p.inputDesc}
            <div>
                <h2 class="mb-2 text-lg font-semibold">입력</h2>
                <Markdown source={p.inputDesc} />
            </div>
        {/if}
        {#if p.outputDesc}
            <div>
                <h2 class="mb-2 text-lg font-semibold">출력</h2>
                <Markdown source={p.outputDesc} />
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
                <Markdown source={p.hint} />
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
                <span class="text-xs text-zinc-500">
                    {detail.problem.checkerType === "trim" ? "줄 끝 공백은 무시됩니다" : ""}
                </span>
                {#if restored && code.trim()}
                    <span class="ml-auto flex items-center gap-2 text-xs text-zinc-400">
                        작성 중이던 코드를 불러왔습니다
                        <button
                            onclick={() => {
                                code = "";
                                restored = false;
                            }}
                            class="underline hover:text-zinc-600">지우기</button
                        >
                    </span>
                {/if}
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
