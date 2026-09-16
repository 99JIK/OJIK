<script lang="ts">
    import { page } from "$app/state";
    import { get, put, patch, del } from "$lib/api";
    import { PRESET_LABEL, type CollectionPreset } from "@ojik/core";
    import MarkdownInput from "$lib/MarkdownInput.svelte";
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

    interface Member {
        userId: number;
        handle: string;
        displayName: string | null;
        role: "member" | "manager";
        joinedAt: string;
        startedAt: string | null;
        solvedHere: number;
    }
    let members = $state<Member[]>([]);
    let problemCount = $state(0);
    let membersLoaded = $state(false);

    let problems = $state<ProblemSummary[]>([]);
    let pickerQuery = $state("");
    /** 이 강의 전용 문제의 id. 목록에서 구분 표시에 쓴다 */
    let ownProblemIds = $state<Set<number>>(new Set());
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

    /**
     * 고를 수 있는 문제.
     *
     * 공개 아카이브만 뒤지면 이 강의 전용으로 만든 문제가 안 나온다. 그게 과제라서
     * 제일 먼저 담고 싶은 것이다. 강의 문제를 위에 두고 아카이브를 아래에 붙인다.
     */
    $effect(() => {
        const q = pickerQuery;
        const cid = id;
        void (async () => {
            try {
                const [own, archive] = await Promise.all([
                    get<{ problems: ProblemSummary[] }>("/problems", { collectionId: cid, limit: 50 }).catch(
                        () => ({ problems: [] }),
                    ),
                    get<{ problems: ProblemSummary[] }>("/problems", { q, limit: 20 }),
                ]);
                const mine = q
                    ? own.problems.filter((p) => p.title.toLowerCase().includes(q.toLowerCase()))
                    : own.problems;
                ownProblemIds = new Set(mine.map((p) => p.id));
                problems = [...mine, ...archive.problems];
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

    async function loadMembers() {
        try {
            const r = await get<{ members: Member[]; problemCount: number }>(`/collections/${id}/members`);
            members = r.members;
            problemCount = r.problemCount;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            membersLoaded = true;
        }
    }

    $effect(() => {
        void id;
        void loadMembers();
    });

    async function setMemberRole(m: Member, role: "member" | "manager") {
        busy = true;
        error = null;
        try {
            await patch(`/collections/${id}/members/${m.userId}`, { role });
            await loadMembers();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    async function removeMember(m: Member) {
        if (!confirm(`${m.handle} 을(를) 명단에서 뺄까요? 제출 기록은 남습니다.`)) return;
        busy = true;
        error = null;
        try {
            await del(`/collections/${id}/members/${m.userId}`);
            await loadMembers();
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
            await loadMembers();
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
                            <MarkdownInput bind:value={item.body} rows={6} allowUpload placeholder="설명" />
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
                <div class="rounded-md border border-dashed border-zinc-300 px-6 py-8 text-center dark:border-zinc-700">
                    <p class="text-sm text-zinc-500">아직 비어 있습니다.</p>
                    <p class="mt-1 text-xs leading-relaxed text-zinc-400">
                        아래 <strong>문제 추가</strong>에서 문제를 담고, 설명이 필요하면
                        <strong>설명 추가</strong>로 글을 끼웁니다. 순서가 곧 학생이 보는 순서입니다.
                        <br />
                        다 넣은 뒤 <strong>항목 저장</strong>을 눌러야 반영됩니다.
                    </p>
                </div>
            {/each}
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
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
            <!--
                항목은 전체 교체라 누르기 전까지 서버에 아무것도 안 간다.
                문제를 담고 저장을 안 누른 채 나가는 일이 생기기 쉬워서 적어 둔다.
            -->
            <span class="text-xs text-zinc-400">저장을 눌러야 반영됩니다.</span>
        </div>
    </section>

    <section class="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div class="mb-2 flex items-baseline justify-between gap-3">
            <h3 class="font-medium">문제 추가</h3>
            <a
                href="/admin/problems/new?collectionId={id}"
                class="text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
                이 강의에 새 문제 만들기
            </a>
        </div>
        <input
            bind:value={pickerQuery}
            placeholder="제목 검색"
            class="w-64 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <ul class="mt-3 max-h-64 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
            {#each problems as p (p.id)}
                <li class="flex items-center gap-3 px-3 py-2 text-sm">
                    <span class="w-10 text-zinc-400">{p.id}</span>
                    <span class="flex-1">
                        {p.title}
                        {#if ownProblemIds.has(p.id)}
                            <span class="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                이 강의
                            </span>
                        {/if}
                    </span>
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
        <div class="mb-2 flex items-baseline justify-between">
            <h3 class="font-medium">수강생</h3>
            <span class="text-xs text-zinc-400">
                {members.length}명{problemCount > 0 ? ` · 문제 ${problemCount}개` : ""}
            </span>
        </div>

        {#if !membersLoaded}
            <p class="text-sm text-zinc-400">불러오는 중...</p>
        {:else if members.length === 0}
            <p class="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-400 dark:border-zinc-800">
                아직 아무도 없습니다. 아래에 아이디를 붙여넣어 등록하세요.
            </p>
        {:else}
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                        <tr>
                            <th class="py-2 pr-3 font-medium">아이디</th>
                            <th class="py-2 pr-3 font-medium">이름</th>
                            {#if problemCount > 0}
                                <th class="py-2 pr-3 font-medium">진도</th>
                            {/if}
                            <th class="py-2 pr-3 font-medium">역할</th>
                            <th class="py-2 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-100 dark:divide-zinc-900">
                        {#each members as m (m.userId)}
                            <tr>
                                <td class="py-2 pr-3">
                                    <a href="/user/{m.handle}" class="hover:underline">{m.handle}</a>
                                </td>
                                <td class="py-2 pr-3 text-zinc-500">{m.displayName ?? ""}</td>
                                {#if problemCount > 0}
                                    <td class="py-2 pr-3">
                                        <div class="flex items-center gap-2">
                                            <div class="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                                                <div
                                                    class="h-full rounded-full bg-blue-600"
                                                    style="width: {Math.round((m.solvedHere / problemCount) * 100)}%"
                                                ></div>
                                            </div>
                                            <span class="tabular-nums text-xs text-zinc-500">
                                                {m.solvedHere}/{problemCount}
                                            </span>
                                        </div>
                                    </td>
                                {/if}
                                <td class="py-2 pr-3">
                                    <button
                                        onclick={() => setMemberRole(m, m.role === "manager" ? "member" : "manager")}
                                        disabled={busy}
                                        class="rounded px-2 py-0.5 text-xs {m.role === 'manager'
                                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}"
                                        title="눌러서 바꿉니다"
                                    >
                                        {m.role === "manager" ? "조교" : "수강생"}
                                    </button>
                                </td>
                                <td class="py-2 text-right">
                                    <button
                                        onclick={() => removeMember(m)}
                                        disabled={busy}
                                        class="text-xs text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
                                    >
                                        빼기
                                    </button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
            <p class="mt-2 text-xs text-zinc-400">
                진도는 이 컬렉션에 담긴 문제 중 맞힌 수입니다. 조교는 이 컬렉션을 고칠 수 있습니다.
            </p>
        {/if}

        <h4 class="mt-6 mb-2 text-sm font-medium">명단 등록</h4>
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
