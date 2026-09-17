<script lang="ts">
    import { goto } from "$app/navigation";
    import { get, post, patch, put } from "$lib/api";
    import {
        CHECKER_LABEL,
        CHECKER_TYPES,
        PROBLEM_LIMITS,
        PROBLEM_KINDS,
        PROBLEM_KIND_LABEL,
        PROBLEM_KIND_DESCRIPTION,
        LANGUAGES,
        type CheckerType,
        type ProblemKind,
    } from "@ojik/core";
    import { page } from "$app/state";
    import MarkdownInput from "$lib/MarkdownInput.svelte";
    import { session } from "$lib/session.svelte";

    /**
     * 문제 등록과 수정을 한 화면으로 쓴다.
     * 지금까지 curl 로만 되던 것이라, 여기가 생기기 전에는 문제를 쌓을 수가 없었다.
     */
    let { problemId = null }: { problemId?: number | null } = $props();

    interface Testcase {
        input: string;
        output: string;
        isSample: boolean;
        points: number;
    }

    let title = $state("");
    let statement = $state("");
    let inputDesc = $state("");
    let outputDesc = $state("");
    let hint = $state("");
    let timeLimitMs = $state<number>(PROBLEM_LIMITS.timeMs.default);
    let memoryLimitMb = $state<number>(PROBLEM_LIMITS.memoryMb.default);
    let checkerType = $state<CheckerType>("trim");
    let floatEpsilon = $state(1e-6);
    let stopOnFirstFail = $state(true);
    let isPublic = $state(false);

    /**
     * 소속 강의. null 이면 공개 아카이브 문제다.
     *
     * 강사는 공개 아카이브에 못 내므로 반드시 하나를 골라야 한다. 출제자는 둘 다 된다.
     * 만든 뒤에 소속을 바꾸는 건 출제자 이상만이라, 강사에게는 읽기 전용으로 보여 준다.
     */
    let ownerCollectionId = $state<number | null>(null);
    let myCollections = $state<Array<{ id: number; title: string }>>([]);

    /**
     * 문제 유형.
     *
     * 유형에 따라 테스트케이스의 뜻이 달라진다. 코드와 빈칸은 input 이 프로그램 입력이고,
     * 단답형은 input 이 문항 지문이다. 아래 편집 칸의 이름도 같이 바뀐다.
     */
    let kind = $state<ProblemKind>("code");
    let blankTemplate = $state("");
    let blankLinesText = $state("");
    let blankLanguage = $state<string>("c");

    let testcases = $state<Testcase[]>([]);
    /** 서버에 저장된 테스트케이스 수. 편집을 시작했는지 판단에 쓴다 */
    let savedCount = $state(0);
    let tcLoaded = $state(false);

    let error = $state<string | null>(null);
    let notice = $state<string | null>(null);
    let busy = $state(false);
    /**
     * 새 문제면 불러올 게 없으니 바로 그린다.
     *
     * problemId 는 만들어질 때 한 번만 본다. 문제를 바꿔 가며 편집하는 경우는
     * 라우트가 {#key id} 로 컴포넌트를 새로 만들기 때문에 이걸로 충분하다.
     */
    // svelte-ignore state_referenced_locally
    let loaded = $state(problemId === null);

    /**
     * 소속으로 고를 수 있는 강의.
     *
     * 강사는 공개 아카이브에 못 내므로, 새 문제면 첫 강의를 기본값으로 채워 둔다.
     * 비워 두면 저장을 눌렀을 때 403 을 보게 되는데, 고를 수 있는 값이 화면에 있는데도
     * 서버가 막는 건 나쁜 안내다.
     */
    $effect(() => {
        void (async () => {
            const r = await get<{ collections: Array<{ id: number; title: string }> }>(
                "/collections",
                { mine: true },
            ).catch(() => ({ collections: [] }));
            myCollections = r.collections;

            const fromQuery = Number(page.url.searchParams.get("collectionId")) || null;
            if (problemId === null && ownerCollectionId === null) {
                if (fromQuery && r.collections.some((c) => c.id === fromQuery)) {
                    ownerCollectionId = fromQuery;
                } else if (!session.isStaff) {
                    ownerCollectionId = r.collections[0]?.id ?? null;
                }
            }
        })();
    });

    $effect(() => {
        const id = problemId;
        if (id === null) return;
        void (async () => {
            try {
                const r = await get<{
                    problem: Record<string, unknown>;
                    testcaseCount: number;
                }>(`/problems/${id}`);
                const p = r.problem as Record<string, never>;
                title = (p.title as string) ?? "";
                statement = (p.statement as string) ?? "";
                inputDesc = (p.inputDesc as string) ?? "";
                outputDesc = (p.outputDesc as string) ?? "";
                hint = (p.hint as string) ?? "";
                timeLimitMs = (p.timeLimitMs as number) ?? PROBLEM_LIMITS.timeMs.default;
                memoryLimitMb = (p.memoryLimitMb as number) ?? PROBLEM_LIMITS.memoryMb.default;
                checkerType = (p.checkerType as CheckerType) ?? "trim";
                floatEpsilon = (p.floatEpsilon as number) ?? 1e-6;
                stopOnFirstFail = (p.stopOnFirstFail as boolean) ?? true;
                isPublic = (p.isPublic as boolean) ?? false;
                ownerCollectionId = (p.ownerCollectionId as number | null) ?? null;
                kind = (p.kind as ProblemKind) ?? "code";

                /*
                 * 골격 원본은 상세에 안 실린다. 정답이 그대로 들어 있어서 뺐다.
                 * 고치려면 있어야 하므로 편집용 라우트에서 따로 받는다.
                 */
                if (kind === "blank") {
                    const src = await get<{
                        blankTemplate: string | null;
                        blankLines: number[] | null;
                        blankLanguage: string | null;
                    }>(`/problems/${id}/source`).catch(() => null);
                    blankTemplate = src?.blankTemplate ?? "";
                    blankLinesText = (src?.blankLines ?? []).join(", ");
                    blankLanguage = src?.blankLanguage ?? "c";
                }
                savedCount = r.testcaseCount;
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
            } finally {
                loaded = true;
            }
        })();
    });

    /**
     * 테스트케이스는 따로 불러온다. 목록이 클 수 있고, 문제 정보만 고치러 온 경우엔
     * 받을 필요가 없다.
     */
    async function loadTestcases() {
        if (problemId === null || tcLoaded) return;
        try {
            const r = await get<{
                testcases: { idx: number; isSample: boolean; points: number }[];
            }>(`/problems/${problemId}/testcases`);
            // 목록 API 는 본문을 안 준다. 본문은 문제 상세의 예제로만 오므로
            // 편집하려면 새로 입력해야 한다. 그 사실을 화면에서 분명히 알린다
            testcases = r.testcases.map((t) => ({
                input: "",
                output: "",
                isSample: t.isSample,
                points: t.points,
            }));
            tcLoaded = true;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
    }

    function addTestcase() {
        testcases = [...testcases, { input: "", output: "", isSample: testcases.length < 2, points: 0 }];
        tcLoaded = true;
    }

    function removeTestcase(i: number) {
        testcases = testcases.filter((_, j) => j !== i);
    }

    function body() {
        return {
            title,
            statement,
            inputDesc,
            outputDesc,
            hint: hint || null,
            timeLimitMs,
            memoryLimitMb,
            checkerType,
            floatEpsilon,
            stopOnFirstFail,
            isPublic,
            ownerCollectionId,
            kind,
            ...(kind === "blank"
                ? {
                      blankTemplate,
                      // "3, 5, 7" 처럼 적는다. 숫자가 아닌 것은 버린다
                      blankLines: blankLinesText
                          .split(/[^0-9]+/)
                          .map(Number)
                          .filter((n) => Number.isInteger(n) && n > 0),
                      blankLanguage,
                  }
                : {}),
        };
    }

    async function save() {
        busy = true;
        error = null;
        notice = null;
        try {
            if (problemId === null) {
                const r = await post<{ problem: { id: number } }>("/problems", body());
                void goto(`/admin/problems/${r.problem.id}`);
                return;
            }
            await patch(`/problems/${problemId}`, body());
            notice = "저장했습니다.";
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    /**
     * 테스트케이스는 전체 교체다. 부분 수정 API 를 두지 않았다.
     * 순번과 파일이 어긋난 중간 상태가 생기면 어떤 제출이 무엇으로 채점됐는지 알 수 없다.
     */
    async function saveTestcases() {
        if (problemId === null) return;
        const empty = testcases.findIndex((t) => !t.input.trim() && !t.output.trim());
        if (empty >= 0) {
            error = `${empty + 1}번 케이스가 비어 있습니다.`;
            return;
        }
        if (
            !confirm(
                `테스트케이스 ${testcases.length}개로 전부 교체합니다.\n` +
                    `기존 ${savedCount}개는 사라지고, 이전 제출의 판정은 옛 기준으로 남습니다.\n` +
                    `계속할까요?`,
            )
        )
            return;

        busy = true;
        error = null;
        try {
            const r = await put<{ count: number; testcaseVersion: number }>(
                `/problems/${problemId}/testcases`,
                { testcases },
            );
            savedCount = r.count;
            notice = `테스트케이스 ${r.count}개를 저장했습니다 (버전 ${r.testcaseVersion}). 기존 제출을 다시 채점하려면 목록에서 재채점을 누르세요.`;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }
</script>

{#if !loaded}
    <p class="text-sm text-zinc-500">불러오는 중...</p>
{:else}
    {#if notice}
        <p class="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
            {notice}
        </p>
    {/if}
    {#if error}
        <p class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
        </p>
    {/if}

    <div class="space-y-4">
        <label class="block text-sm">
            <span class="mb-1 block font-medium">제목</span>
            <input
                bind:value={title}
                class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
        </label>

        <!--
            본문 네 칸.

            each 로 묶어 놓고 안에서 key 로 갈라 쓰면 bind: 를 못 건다. 네 칸을 그냥 펼친다.
            반복이 조금 늘지만, 값을 어디에 넣는지가 눈에 보이는 쪽이 낫다.
        -->
        <label class="block text-sm">
            <span class="mb-1 block font-medium">문제</span>
            <MarkdownInput bind:value={statement} rows={12} allowUpload placeholder="문제 설명" />
        </label>

        <label class="block text-sm">
            <span class="mb-1 block font-medium">입력</span>
            <MarkdownInput bind:value={inputDesc} rows={4} allowUpload />
        </label>

        <label class="block text-sm">
            <span class="mb-1 block font-medium">출력</span>
            <MarkdownInput bind:value={outputDesc} rows={4} allowUpload />
        </label>

        <label class="block text-sm">
            <span class="mb-1 block font-medium">힌트</span>
            <MarkdownInput bind:value={hint} rows={4} allowUpload />
        </label>

        <div class="grid gap-4 sm:grid-cols-2">
            <label class="block text-sm">
                <span class="mb-1 block font-medium">시간 제한 (ms)</span>
                <input
                    type="number"
                    bind:value={timeLimitMs}
                    min={PROBLEM_LIMITS.timeMs.min}
                    max={PROBLEM_LIMITS.timeMs.max}
                    class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span class="mt-1 block text-xs text-zinc-400">
                    인터프리터 언어는 자동으로 더 받습니다 (Python 3배, Java 2배)
                </span>
            </label>
            <label class="block text-sm">
                <span class="mb-1 block font-medium">메모리 제한 (MB)</span>
                <input
                    type="number"
                    bind:value={memoryLimitMb}
                    min={PROBLEM_LIMITS.memoryMb.min}
                    max={PROBLEM_LIMITS.memoryMb.max}
                    class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
            </label>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
            <label class="block text-sm">
                <span class="mb-1 block font-medium">출력 비교</span>
                <select
                    bind:value={checkerType}
                    class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                >
                    {#each CHECKER_TYPES as t (t)}
                        <option value={t}>{CHECKER_LABEL[t]}</option>
                    {/each}
                </select>
            </label>
            {#if checkerType === "float"}
                <label class="block text-sm">
                    <span class="mb-1 block font-medium">허용 오차</span>
                    <input
                        type="number"
                        step="any"
                        bind:value={floatEpsilon}
                        class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                </label>
            {/if}
        </div>

        <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={stopOnFirstFail} class="mt-0.5" />
            <span>
                첫 오답에서 나머지 케이스를 중단
                <span class="block text-xs text-zinc-400">
                    자원 절약을 위한 것입니다. 부분점수를 주려면 꺼야 점수가 제대로 나옵니다.
                </span>
            </span>
        </label>

        <div class="text-sm">
            <span class="mb-2 block font-medium">유형</span>
            <div class="grid gap-2 sm:grid-cols-3">
                {#each PROBLEM_KINDS as k (k)}
                    <button
                        type="button"
                        onclick={() => (kind = k)}
                        class="rounded-md border px-3 py-2 text-left transition {kind === k
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                            : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'}"
                    >
                        <span class="block font-medium">{PROBLEM_KIND_LABEL[k]}</span>
                        <span class="mt-0.5 block text-xs leading-relaxed text-zinc-500">
                            {PROBLEM_KIND_DESCRIPTION[k]}
                        </span>
                    </button>
                {/each}
            </div>
        </div>

        {#if kind === "blank"}
            <div class="space-y-3 rounded-md border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                <label class="block text-sm">
                    <span class="mb-1 block font-medium">골격 코드</span>
                    <textarea
                        bind:value={blankTemplate}
                        rows="12"
                        spellcheck="false"
                        placeholder="정답까지 다 쓴 코드를 넣으세요. 아래에서 고른 줄만 학생에게 비어 보입니다."
                        class="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    ></textarea>
                    <span class="mt-1 block text-xs text-zinc-500">
                        원본은 학생에게 안 내려갑니다. 비운 줄을 지운 골격만 갑니다.
                    </span>
                </label>

                <div class="grid gap-3 sm:grid-cols-2">
                    <label class="block text-sm">
                        <span class="mb-1 block font-medium">비울 줄</span>
                        <input
                            bind:value={blankLinesText}
                            placeholder="3, 5, 7"
                            class="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <span class="mt-1 block text-xs text-zinc-500">1부터 센 줄 번호입니다.</span>
                    </label>
                    <label class="block text-sm">
                        <span class="mb-1 block font-medium">채점 언어</span>
                        <select
                            bind:value={blankLanguage}
                            class="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        >
                            {#each LANGUAGES as l (l.id)}
                                <option value={l.id}>{l.label}</option>
                            {/each}
                        </select>
                        <span class="mt-1 block text-xs text-zinc-500">학생은 언어를 못 고릅니다.</span>
                    </label>
                </div>

                {#if blankTemplate}
                    {@const picked = blankLinesText
                        .split(/[^0-9]+/)
                        .map(Number)
                        .filter((n) => Number.isInteger(n) && n > 0)}
                    <div>
                        <span class="mb-1 block text-sm font-medium">학생이 보는 모습</span>
                        <div class="max-h-64 overflow-auto rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950">
                            <table class="w-full border-collapse font-mono text-xs">
                                <tbody>
                                    {#each blankTemplate.split("\n") as line, i (i)}
                                        {@const n = i + 1}
                                        <tr class={picked.includes(n) ? "bg-blue-100 dark:bg-blue-950/50" : ""}>
                                            <td class="w-10 border-r border-zinc-200 px-2 text-right text-zinc-400 dark:border-zinc-800">
                                                {n}
                                            </td>
                                            <td class="px-2">
                                                {#if picked.includes(n)}
                                                    <span class="text-blue-600 dark:text-blue-400">(빈칸)</span>
                                                {:else}
                                                    <pre class="whitespace-pre">{line || " "}</pre>
                                                {/if}
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    </div>
                {/if}
            </div>
        {/if}

        <label class="block text-sm">
            <span class="mb-1 block">소속</span>
            {#if problemId !== null && !session.isStaff}
                <p class="rounded-md bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-900">
                    {myCollections.find((c) => c.id === ownerCollectionId)?.title ?? "공개 아카이브"}
                    <span class="block text-xs text-zinc-400">소속은 출제자만 바꿀 수 있습니다.</span>
                </p>
            {:else}
                <select
                    bind:value={ownerCollectionId}
                    class="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                    {#if session.isStaff}
                        <option value={null}>공개 아카이브</option>
                    {/if}
                    {#each myCollections as c (c.id)}
                        <option value={c.id}>{c.title}</option>
                    {/each}
                </select>
                <span class="mt-1 block text-xs text-zinc-400">
                    {#if session.isStaff}
                        공개 아카이브로 두면 문제 목록에 오릅니다. 강의를 고르면 그 강의 안에서만 보입니다.
                    {:else}
                        강의를 고르면 그 강의 안에서만 보입니다. 공개 아카이브에는 출제자만 낼 수 있습니다.
                    {/if}
                </span>
                {#if !session.isStaff && myCollections.length === 0}
                    <span class="mt-1 block text-xs text-red-600 dark:text-red-400">
                        운영하는 강의가 없습니다. 강의를 먼저 만드세요.
                    </span>
                {/if}
            {/if}
        </label>

        <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={isPublic} class="mt-0.5" />
            <span>
                공개
                <span class="block text-xs text-zinc-400">
                    끄면 목록에 안 보이고 운영자와 대회 참가자만 열 수 있습니다.
                </span>
            </span>
        </label>

        <button
            onclick={save}
            disabled={busy || !title.trim()}
            class="rounded-md bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
            {busy ? "..." : problemId === null ? "만들기" : "저장"}
        </button>
    </div>

    {#if problemId !== null}
        <section class="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <div class="flex items-center justify-between">
                <h2 class="font-semibold">테스트케이스</h2>
                <span class="text-sm text-zinc-400">저장된 {savedCount}개</span>
            </div>

            {#if !tcLoaded}
                <div class="mt-4 rounded-md border border-zinc-200 px-5 py-6 text-center dark:border-zinc-800">
                    <p class="text-sm text-zinc-500">
                        테스트케이스는 <strong>전체 교체</strong>만 됩니다. 일부만 고칠 수 없습니다.
                    </p>
                    <p class="mt-1 text-xs text-zinc-400">
                        저장된 본문은 내려받을 수 없으므로, 편집하려면 전부 다시 입력해야 합니다.
                    </p>
                    <div class="mt-4 flex justify-center gap-2">
                        <button
                            onclick={loadTestcases}
                            class="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
                        >
                            기존 구성 불러오기
                        </button>
                        <button
                            onclick={addTestcase}
                            class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                            새로 만들기
                        </button>
                    </div>
                </div>
            {:else}
                <div class="mt-4 space-y-4">
                    {#each testcases as tc, i (i)}
                        <div class="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
                            <div class="mb-2 flex flex-wrap items-center gap-4 text-sm">
                                <span class="font-medium">{i + 1}번</span>
                                <!--
                                    단답형은 예제 개념이 없다. 문항을 예제로 공개하면 기대 답이
                                    같이 나가는데, 그건 답을 보여 주는 것이다. API 도 단답형
                                    문제에서는 예제 목록을 아예 안 내보낸다
                                -->
                                {#if kind !== "answer"}
                                    <label class="flex items-center gap-1.5">
                                        <input type="checkbox" bind:checked={tc.isSample} />
                                        예제로 공개
                                    </label>
                                {/if}
                                <label class="flex items-center gap-1.5">
                                    배점
                                    <input
                                        type="number"
                                        bind:value={tc.points}
                                        min="0"
                                        class="w-20 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                                    />
                                </label>
                                <button
                                    onclick={() => removeTestcase(i)}
                                    class="ml-auto text-xs text-red-600 hover:underline dark:text-red-400"
                                >
                                    삭제
                                </button>
                            </div>
                            <!--
                                유형에 따라 두 칸의 뜻이 다르다.
                                코드와 빈칸은 프로그램 입력과 기대 출력이고,
                                단답형은 문항 지문과 기대 답이다. 표를 따로 두지 않는 대신
                                이름을 바꿔 준다
                            -->
                            <div class="grid gap-3 sm:grid-cols-2">
                                <label class="block">
                                    <span class="mb-1 block text-xs text-zinc-500">
                                        {kind === "answer" ? "문항 지문 (마크다운)" : "입력"}
                                    </span>
                                    <textarea
                                        bind:value={tc.input}
                                        rows="4"
                                        class="w-full rounded-md border border-zinc-300 px-3 py-2 {kind === 'answer'
                                            ? 'text-sm'
                                            : 'font-mono text-xs'} dark:border-zinc-700 dark:bg-zinc-900"
                                    ></textarea>
                                </label>
                                <label class="block">
                                    <span class="mb-1 block text-xs text-zinc-500">
                                        {kind === "answer" ? "기대 답" : "출력"}
                                    </span>
                                    <textarea
                                        bind:value={tc.output}
                                        rows="4"
                                        class="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                                    ></textarea>
                                </label>
                            </div>
                        </div>
                    {/each}
                </div>

                <div class="mt-4 flex items-center gap-2">
                    <button
                        onclick={addTestcase}
                        class="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
                    >
                        케이스 추가
                    </button>
                    <button
                        onclick={saveTestcases}
                        disabled={busy || testcases.length === 0}
                        class="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {busy ? "..." : `${testcases.length}개로 전체 교체`}
                    </button>
                </div>
                <p class="mt-2 text-xs text-zinc-400">
                    배점을 전부 0으로 두면 통과한 케이스 비율로 점수가 매겨집니다.
                </p>
            {/if}
        </section>
    {/if}
{/if}
