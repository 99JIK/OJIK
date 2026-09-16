<script lang="ts">
    import { page } from "$app/state";
    import { get, put } from "$lib/api";
    import { PRESET_LABEL, type CollectionPreset } from "@ojik/core";
    import type { ProblemSummary } from "$lib/types";

    /**
     * 컬렉션의 항목과 멤버를 편집한다.
     * 항목은 문제와 설명 문단을 섞을 수 있다. 그게 교재를 가능하게 하는 유일한 차이다.
     */

    interface Item {
        kind: "problem" | "text";
        problemId?: number;
        points: number;
        body?: string;
        heading?: string;
        /** 표시용. 서버로 안 보낸다 */
        problemTitle?: string;
    }

    const id = $derived(Number(page.params.id));

    let title = $state("");
    let slug = $state("");
    let preset = $state<CollectionPreset>("problemset");
    let items = $state<Item[]>([]);
    let handles = $state("");
    let replaceMembers = $state(false);

    let problems = $state<ProblemSummary[]>([]);
    let pickerQuery = $state("");
    let error = $state<string | null>(null);
    let notice = $state<string | null>(null);
    let busy = $state(false);
    let loaded = $state(false);

    $effect(() => {
        const cid = id;
        void (async () => {
            try {
                // 상세는 slug 로만 조회된다. 목록에서 이 id 의 slug 를 찾는다
                const list = await get<{ collections: { id: number; slug: string }[] }>("/collections");
                const found = list.collections.find((c) => c.id === cid);
                if (!found) throw new Error("컬렉션을 찾을 수 없습니다");

                const d = await get<{
                    collection: { title: string; slug: string; preset: CollectionPreset };
                    items: {
                        kind: "problem" | "text";
                        problemId: number | null;
                        problemTitle: string | null;
                        points: number;
                        body: string | null;
                        heading: string | null;
                    }[];
                }>(`/collections/${found.slug}`);

                title = d.collection.title;
                slug = d.collection.slug;
                preset = d.collection.preset;
                items = d.items.map((i) => ({
                    kind: i.kind,
                    problemId: i.problemId ?? undefined,
                    problemTitle: i.problemTitle ?? undefined,
                    points: i.points,
                    body: i.body ?? undefined,
                    heading: i.heading ?? undefined,
                }));
                error = null;
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
            } finally {
                loaded = true;
            }
        })();
    });

    $effect(() => {
        const q = pickerQuery;
        void (async () => {
            try {
                const r = await get<{ problems: ProblemSummary[] }>("/problems", { q, limit: 20 });
                problems = r.problems;
            } catch {
                // 목록을 못 받아도 편집은 계속된다
            }
        })();
    });

    function addProblem(p: ProblemSummary) {
        items = [...items, { kind: "problem", problemId: p.id, problemTitle: p.title, points: 100 }];
    }
    function addText() {
        items = [...items, { kind: "text", points: 0, body: "", heading: "" }];
    }
    function remove(i: number) {
        items = items.filter((_, j) => j !== i);
    }
    function move(i: number, d: -1 | 1) {
        const j = i + d;
        if (j < 0 || j >= items.length) return;
        const next = [...items];
        [next[i], next[j]] = [next[j]!, next[i]!];
        items = next;
    }

    async function saveItems() {
        busy = true;
        error = null;
        notice = null;
        try {
            await put(`/collections/${id}/items`, {
                items: items.map((i) => ({
                    kind: i.kind,
                    problemId: i.problemId,
                    points: i.points,
                    body: i.body,
                    heading: i.heading,
                })),
            });
            notice = `항목 ${items.length}개를 저장했습니다.`;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    async function saveMembers() {
        const list = handles
            .split(/[\s,]+/)
            .map((h) => h.trim())
            .filter(Boolean);
        if (list.length === 0) return;

        busy = true;
        error = null;
        notice = null;
        try {
            const r = await put<{ added: number; missing: string[] }>(`/collections/${id}/members`, {
                handles: list,
                replace: replaceMembers,
            });
            notice = `${r.added}명 등록했습니다.`;
            // 없는 핸들을 조용히 넘기지 않는다. 명단 오타를 여기서 못 잡으면
            // 학생이 안 보인다고 할 때까지 모른다
            if (r.missing.length) {
                notice += ` 없는 아이디 ${r.missing.length}개: ${r.missing.join(", ")}`;
            }
            handles = "";
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
    <div class="mb-4 flex items-baseline justify-between">
        <div>
            <span class="text-xs text-zinc-400">{PRESET_LABEL[preset]}</span>
            <h2 class="text-lg font-semibold">{title}</h2>
        </div>
        <div class="flex gap-3 text-sm">
            <a href="/c/{slug}" class="text-zinc-500 hover:underline">보기</a>
            <a href="/admin/collections" class="text-zinc-500 hover:underline">목록으로</a>
        </div>
    </div>

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

    <section>
        <h3 class="mb-2 font-medium">항목</h3>
        <div class="space-y-2">
            {#each items as item, i (i)}
                <div class="flex items-start gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                    <div class="flex flex-col gap-1 pt-1">
                        <button onclick={() => move(i, -1)} class="text-xs text-zinc-400 hover:text-zinc-700">
                            위
                        </button>
                        <button onclick={() => move(i, 1)} class="text-xs text-zinc-400 hover:text-zinc-700">
                            아래
                        </button>
                    </div>
                    <span class="w-6 pt-1 text-center text-sm text-zinc-400">{i + 1}</span>

                    <div class="min-w-0 flex-1">
                        {#if item.kind === "problem"}
                            <div class="flex items-center gap-3 text-sm">
                                <span class="font-medium">{item.problemTitle ?? `문제 ${item.problemId}`}</span>
                                <label class="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
                                    배점
                                    <input
                                        type="number"
                                        bind:value={item.points}
                                        min="0"
                                        class="w-20 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                                    />
                                </label>
                            </div>
                        {:else}
                            <input
                                bind:value={item.heading}
                                placeholder="소제목 (선택)"
                                class="mb-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            />
                            <textarea
                                bind:value={item.body}
                                rows="4"
                                placeholder="설명 (마크다운)"
                                class="w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                            ></textarea>
                        {/if}
                    </div>

                    <button
                        onclick={() => remove(i)}
                        class="pt-1 text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                        삭제
                    </button>
                </div>
            {:else}
                <p class="rounded-md border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
                    항목이 없습니다
                </p>
            {/each}
        </div>

        <div class="mt-3 flex gap-2">
            <button onclick={addText} class="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
                설명 추가
            </button>
            <button
                onclick={saveItems}
                disabled={busy}
                class="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
                {busy ? "..." : "항목 저장"}
            </button>
        </div>
    </section>

    <section class="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h3 class="mb-2 font-medium">문제 추가</h3>
        <input
            bind:value={pickerQuery}
            placeholder="제목 검색"
            class="w-64 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <ul class="mt-3 max-h-64 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
            {#each problems as p (p.id)}
                <li class="flex items-center gap-3 px-3 py-2 text-sm">
                    <span class="w-10 text-zinc-400">{p.id}</span>
                    <span class="flex-1">{p.title}</span>
                    <button
                        onclick={() => addProblem(p)}
                        class="text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                        추가
                    </button>
                </li>
            {:else}
                <li class="px-3 py-6 text-center text-sm text-zinc-400">결과 없음</li>
            {/each}
        </ul>
    </section>

    <section class="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h3 class="mb-2 font-medium">멤버</h3>
        <textarea
            bind:value={handles}
            rows="4"
            placeholder="아이디를 줄바꿈이나 쉼표로 구분해 붙여넣으세요"
            class="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
        ></textarea>
        <div class="mt-2 flex items-center gap-4">
            <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" bind:checked={replaceMembers} />
                기존 명단을 지우고 교체
            </label>
            <button
                onclick={saveMembers}
                disabled={busy || !handles.trim()}
                class="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
                {busy ? "..." : "등록"}
            </button>
        </div>
        <p class="mt-2 text-xs text-zinc-400">없는 아이디는 등록 후에 알려 줍니다.</p>
    </section>
{/if}
