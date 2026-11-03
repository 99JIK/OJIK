<script lang="ts">
    import { get, post } from "$lib/api";
    import { acceptRate } from "$lib/format";
    import type { ProblemSummary } from "$lib/types";
    import { PROBLEM_KIND_LABEL, BULK_PROBLEM_SAMPLE, BULK_MAX_PROBLEMS } from "@ojik/core";
    import { session } from "$lib/session.svelte";

    /**
     * 문제 목록과 묶음 올리기/내려받기.
     *
     * 화면에서 하나씩 등록하는 건 다섯 개만 넘어가도 못 할 짓이다. 출제자는 보통 자기
     * 에디터에서 문제를 쓰고 테스트케이스를 스크립트로 만든다.
     *
     * 내려받기는 올리는 형식과 같다. 받은 파일을 고쳐서 바로 되올릴 수 있어야 백업과
     * 복제에 쓸 수 있다.
     */

    let rows = $state<ProblemSummary[]>([]);
    let error = $state<string | null>(null);
    let notice = $state<string | null>(null);
    let loaded = $state(false);
    let q = $state("");

    /** 내려받을 문제. 목록을 다시 불러도 고른 것이 남게 Set 으로 둔다 */
    let picked = $state<Set<number>>(new Set());

    let showImport = $state(false);
    let importText = $state("");
    let importTarget = $state<number | null>(null);
    let importing = $state(false);
    let importResult = $state<{
        created: Array<{ id: number; title: string; testcases: number }>;
        errors: string[];
    } | null>(null);

    let myCollections = $state<Array<{ id: number; title: string }>>([]);

    async function load() {
        try {
            const r = await get<{ problems: ProblemSummary[] }>("/problems", { q, limit: 100 });
            rows = r.problems;
            error = null;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loaded = true;
        }
    }

    $effect(() => {
        void q;
        void load();
    });

    /* 강사는 공개 아카이브에 못 낸다. 고를 수 있는 강의가 없으면 올리기 자체가 막힌다 */
    $effect(() => {
        void (async () => {
            const r = await get<{ collections: Array<{ id: number; title: string }> }>("/collections", {
                mine: true,
            }).catch(() => ({ collections: [] }));
            myCollections = r.collections;
            if (importTarget === null && !session.isStaff) importTarget = r.collections[0]?.id ?? null;
        })();
    });

    function toggle(id: number) {
        const next = new Set(picked);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        picked = next;
    }

    /** 지금 화면에 보이는 것만 대상이다. 검색으로 걸러 놓고 전체선택을 누르는 게 보통이다 */
    const allShown = $derived(rows.length > 0 && rows.every((p) => picked.has(p.id)));
    function toggleAll() {
        const next = new Set(picked);
        if (allShown) for (const p of rows) next.delete(p.id);
        else for (const p of rows) next.add(p.id);
        picked = next;
    }

    function save(name: string, text: string) {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function download() {
        const ids = [...picked];
        if (ids.length === 0) return;
        try {
            const r = await get<{
                json: string;
                count: number;
                skipped: Array<{ id: number; why: string }>;
            }>("/problems/export", { ids: ids.join(",") });

            save(`문제-${new Date().toISOString().slice(0, 10)}.json`, r.json);

            /*
             * 빠진 것을 반드시 말한다.
             *
             * 백업인 줄 알고 받았는데 조용히 몇 개가 빠져 있으면, 그걸 아는 때는 복구할
             * 때다. 그때는 이미 늦다
             */
            notice =
                r.skipped.length === 0
                    ? `${r.count}개를 내려받았습니다.`
                    : `${r.count}개를 내려받았습니다. 빠진 것: ${r.skipped
                          .map((s) => `${s.id}번(${s.why})`)
                          .join(", ")}`;
            error = null;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
    }

    /** 문제 전체 재채점. 테스트케이스를 고친 뒤에 쓴다 */
    async function rejudge(p: ProblemSummary) {
        if (!confirm(`${p.id}번 "${p.title}" 의 모든 제출을 다시 채점합니다. 계속할까요?`)) return;
        try {
            const r = await post<{ requeued: number }>(`/problems/${p.id}/rejudge`);
            notice = `${p.id}번 ${r.requeued}건을 큐에 넣었습니다.`;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
    }

    async function pickFile(ev: Event) {
        const f = (ev.target as HTMLInputElement).files?.[0];
        if (!f) return;
        importText = await f.text();
        importResult = null;
    }

    async function runImport() {
        if (!importText.trim()) return;
        importing = true;
        try {
            importResult = await post<{
                created: Array<{ id: number; title: string; testcases: number }>;
                errors: string[];
            }>("/problems/import", { json: importText, ownerCollectionId: importTarget });
            error = null;
            if (importResult.created.length > 0) {
                // 올린 것이 목록에 안 보이면 올라갔는지 알 수 없다
                await load();
                importText = "";
            }
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            importing = false;
        }
    }
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap items-center gap-2">
        <a href="/admin/problems/new" class="ojik-btn ojik-btn-primary">새 문제</a>
        <button class="ojik-btn" onclick={() => (showImport = !showImport)}>
            {showImport ? "올리기 닫기" : "묶음 올리기"}
        </button>
        <button class="ojik-btn" disabled={picked.size === 0} onclick={download}>
            내려받기{picked.size > 0 ? ` (${picked.size})` : ""}
        </button>
        <span class="text-sm text-zinc-400">
            {rows.length}개{picked.size > 0 ? ` · ${picked.size}개 고름` : ""}
        </span>
        {#if picked.size > 0}
            <button class="text-xs text-zinc-500 hover:underline" onclick={() => (picked = new Set())}>
                선택 해제
            </button>
        {/if}
    </div>
    <input bind:value={q} placeholder="제목 검색" class="ojik-input w-56" />
</div>

{#if showImport}
    <section class="ojik-card mt-4 p-5">
        <h2 class="ojik-title">묶음 올리기</h2>
        <p class="mt-1 text-sm text-zinc-500">
            JSON 배열 하나에 문제와 테스트케이스를 담아 올립니다. 한 번에 {BULK_MAX_PROBLEMS}개까지.
            한 문제가 잘못돼도 나머지는 올라가고, 어디가 왜 잘못됐는지 아래에 나옵니다.
        </p>

        <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <label class="block text-sm">
                <span class="mb-1 flex items-center justify-between">
                    <span>내용</span>
                    <input
                        type="file"
                        accept=".json,application/json"
                        onchange={pickFile}
                        class="text-xs text-zinc-500 file:mr-2 file:rounded file:border file:border-zinc-300 file:bg-transparent file:px-2 file:py-1 file:text-xs dark:file:border-zinc-700"
                    />
                </span>
                <textarea
                    bind:value={importText}
                    rows="14"
                    spellcheck="false"
                    placeholder={BULK_PROBLEM_SAMPLE}
                    class="ojik-input w-full resize-y font-mono text-xs"
                ></textarea>
            </label>

            <div class="space-y-4 text-sm">
                <label class="block">
                    <span class="mb-1 block">소속</span>
                    <select bind:value={importTarget} class="ojik-input w-full">
                        {#if session.isStaff}
                            <option value={null}>공개 아카이브</option>
                        {/if}
                        {#each myCollections as c (c.id)}
                            <option value={c.id}>{c.title}</option>
                        {/each}
                    </select>
                    <span class="mt-1 block text-xs text-zinc-400">
                        올리는 문제 전부에 같은 소속이 붙습니다.
                    </span>
                </label>

                <button
                    class="ojik-btn ojik-btn-primary w-full"
                    disabled={importing || !importText.trim()}
                    onclick={runImport}
                >
                    {importing ? "올리는 중..." : "올리기"}
                </button>

                <p class="text-xs text-zinc-400">
                    내려받기로 받은 파일을 그대로 다시 올릴 수 있습니다. 한 문제를 받아 제목과
                    테스트케이스만 고치면 변형 문제가 됩니다.
                </p>
            </div>
        </div>

        {#if importResult}
            <div class="mt-4 space-y-3 text-sm">
                {#if importResult.created.length > 0}
                    <div
                        class="rounded-md bg-green-50 px-4 py-3 text-green-800 dark:bg-green-950 dark:text-green-200"
                    >
                        <p class="font-medium">{importResult.created.length}개를 올렸습니다.</p>
                        <ul class="mt-1 space-y-0.5 text-xs">
                            {#each importResult.created as c (c.id)}
                                <li>
                                    <a href="/admin/problems/{c.id}" class="hover:underline">
                                        {c.id}번 {c.title}
                                    </a>
                                    <span class="text-green-700/70 dark:text-green-300/70">
                                        테스트케이스 {c.testcases}개
                                    </span>
                                </li>
                            {/each}
                        </ul>
                    </div>
                {/if}
                {#if importResult.errors.length > 0}
                    <div class="rounded-md bg-red-50 px-4 py-3 text-red-700 dark:bg-red-950 dark:text-red-300">
                        <p class="font-medium">{importResult.errors.length}개를 못 올렸습니다.</p>
                        <ul class="mt-1 space-y-0.5 text-xs">
                            {#each importResult.errors as e (e)}
                                <li>{e}</li>
                            {/each}
                        </ul>
                    </div>
                {/if}
                {#if importResult.created.length === 0 && importResult.errors.length === 0}
                    <p class="text-zinc-500">올릴 문제가 없습니다.</p>
                {/if}
            </div>
        {/if}
    </section>
{/if}

{#if notice}
    <p
        class="mt-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200"
    >
        {notice}
    </p>
{/if}
{#if error}
    <p class="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{/if}

{#if !loaded}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else}
    <table class="ojik-table mt-4 w-full text-sm">
        <thead class="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
                <th class="w-8">
                    <input
                        type="checkbox"
                        checked={allShown}
                        onchange={toggleAll}
                        aria-label="보이는 문제 전체 선택"
                    />
                </th>
                <th class="w-16 font-medium">번호</th>
                <th class="font-medium">제목</th>
                <th class="w-24 font-medium">출제자</th>
                <th class="w-20 font-medium">공개</th>
                <th class="w-24 text-right font-medium">맞힌 수</th>
                <th class="w-24 text-right font-medium">정답 비율</th>
                <th class="w-20"></th>
            </tr>
        </thead>
        <tbody>
            {#each rows as p (p.id)}
                <tr class="border-b border-zinc-100 dark:border-zinc-900">
                    <td>
                        <input
                            type="checkbox"
                            checked={picked.has(p.id)}
                            onchange={() => toggle(p.id)}
                            aria-label="{p.id}번 선택"
                        />
                    </td>
                    <td class="tabular-nums text-zinc-500">{p.id}</td>
                    <td>
                        <a href="/admin/problems/{p.id}" class="hover:underline">{p.title}</a>
                        {#if p.kind !== "code"}
                            <span class="ojik-badge ml-1">{PROBLEM_KIND_LABEL[p.kind]}</span>
                        {/if}
                    </td>
                    <td class="nowrap text-zinc-500">
                        {#if p.authorHandle}
                            <a href="/user/{p.authorHandle}" class="hover:underline">{p.authorHandle}</a>
                        {:else}
                            <span class="text-zinc-400">-</span>
                        {/if}
                    </td>
                    <td class="nowrap">
                        {#if p.isPublic}
                            <span class="text-green-600 dark:text-green-400">공개</span>
                        {:else}
                            <span class="text-zinc-400">비공개</span>
                        {/if}
                    </td>
                    <td class="text-right tabular-nums">{p.acceptedCount}</td>
                    <td class="text-right tabular-nums text-zinc-500">
                        {acceptRate(p.acceptedCount, p.submissionCount)}
                    </td>
                    <td class="nowrap text-right">
                        <a href="/problem/{p.id}" class="text-xs text-zinc-500 hover:underline">보기</a>
                        <button
                            onclick={() => rejudge(p)}
                            class="ml-3 text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                            재채점
                        </button>
                    </td>
                </tr>
            {:else}
                <tr><td colspan="8" class="py-8 text-center text-zinc-400">문제가 없습니다</td></tr>
            {/each}
        </tbody>
    </table>
{/if}
