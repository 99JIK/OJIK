<script lang="ts">
    import { goto } from "$app/navigation";
    import { get, post, patch, put } from "$lib/api";
    import { CHECKER_LABEL, CHECKER_TYPES, PROBLEM_LIMITS, type CheckerType } from "@ojik/core";
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
                            <div class="mb-2 flex items-center gap-4 text-sm">
                                <span class="font-medium">{i + 1}번</span>
                                <label class="flex items-center gap-1.5">
                                    <input type="checkbox" bind:checked={tc.isSample} />
                                    예제로 공개
                                </label>
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
                            <div class="grid gap-3 sm:grid-cols-2">
                                <textarea
                                    bind:value={tc.input}
                                    rows="4"
                                    placeholder="입력"
                                    class="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                                ></textarea>
                                <textarea
                                    bind:value={tc.output}
                                    rows="4"
                                    placeholder="출력"
                                    class="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                                ></textarea>
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
