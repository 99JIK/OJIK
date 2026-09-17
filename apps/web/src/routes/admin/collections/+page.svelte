<script lang="ts">
    import { goto } from "$app/navigation";
    import { get, post } from "$lib/api";
    import { formatDate } from "$lib/format";
    import {
        COLLECTION_PRESETS,
        PRESET_LABEL,
        PRESET_DESCRIPTION,
        PRESET_DEFAULTS,
        TIMING_LABEL,
        REVEAL_LABEL,
        SCORING_LABEL,
        JOIN_POLICY_LABEL,
        VISIBILITY_LABEL,
        slugify,
        type CollectionPreset,
        type Visibility,
    } from "@ojik/core";
    import MarkdownInput from "$lib/MarkdownInput.svelte";

    /**
     * 내가 운영하는 교재, 문제집, 대회, 코딩테스트.
     *
     * 만들 때 종류를 드롭다운이 아니라 카드로 고르게 한다. 넷의 차이는 축 값 조합인데
     * 이름만 보고는 뭐가 다른지 알 수 없다. 고르기 전에 무엇에 쓰는 물건인지와 뭐가
     * 정해지는지가 같이 보여야 한다.
     */

    interface Row {
        id: number;
        slug: string;
        title: string;
        preset: CollectionPreset;
        timing: "none" | "fixed" | "per_user";
        visibility: Visibility;
        startsAt: string | null;
        endsAt: string | null;
        durationMinutes: number | null;
        problemCount: number;
        memberCount: number;
    }

    let rows = $state<Row[]>([]);
    let error = $state<string | null>(null);
    let loaded = $state(false);

    // 새로 만들기
    let creating = $state(false);
    let preset = $state<CollectionPreset>("course");
    let slug = $state("");
    let slugTouched = $state(false);
    let title = $state("");
    let description = $state("");
    let startsAt = $state("");
    let endsAt = $state("");
    let durationMinutes = $state(60);
    let busy = $state(false);

    async function load() {
        try {
            // 내가 운영하는 것만 본다. 관리자라도 남의 강의까지 다 뜨면 목록이 못 쓰게 된다
            const r = await get<{ collections: Row[] }>("/collections", { mine: true });
            rows = r.collections;
            error = null;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loaded = true;
        }
    }

    $effect(() => {
        void load();
    });

    const axes = $derived(PRESET_DEFAULTS[preset]);
    const needsFixed = $derived(axes.timing === "fixed");
    const needsDuration = $derived(axes.timing === "per_user");

    /**
     * 주소는 제목에서 만든다.
     *
     * 손으로 치게 두면 "week-1" 같은 예시만 보고 뭘 써야 할지 모른다. 한글 제목이면
     * 남는 글자가 없어서 종류와 날짜로 대신한다. 직접 고친 뒤에는 따라오지 않는다.
     */
    $effect(() => {
        const t = title;
        const p = preset;
        if (slugTouched) return;
        const base = slugify(t);
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        slug = base || `${p}-${today}`;
    });

    async function create() {
        busy = true;
        error = null;
        try {
            const body: Record<string, unknown> = {
                preset,
                slug: slug.trim(),
                title: title.trim(),
                description,
            };
            if (needsFixed) {
                body.startsAt = new Date(startsAt).toISOString();
                body.endsAt = new Date(endsAt).toISOString();
            }
            if (needsDuration) body.durationMinutes = durationMinutes;

            const r = await post<{ collection: { id: number } }>("/collections", body);
            // 만들고 목록으로 돌아가면 "이제 뭐하지"가 된다. 바로 내용을 채우는 화면으로 보낸다
            await goto(`/admin/collections/${r.collection.id}`);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            busy = false;
        }
    }

    /** 지금 상태. 목록에서 진행 중인 것을 먼저 찾게 된다 */
    function statusOf(r: Row): { text: string; cls: string } {
        const now = Date.now();
        if (r.timing === "fixed" && r.startsAt && r.endsAt) {
            const s = new Date(r.startsAt).getTime();
            const e = new Date(r.endsAt).getTime();
            if (now < s)
                return { text: "예정", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" };
            if (now > e)
                return { text: "종료", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" };
            return { text: "진행 중", cls: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" };
        }
        if (r.timing === "per_user") {
            return { text: "각자 시작", cls: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" };
        }
        return { text: "상시", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" };
    }
</script>

<div class="flex items-center justify-between">
    <h1 class="text-xl font-bold">교재, 문제집, 대회</h1>
    <button
        onclick={() => (creating = !creating)}
        class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
    >
        {creating ? "닫기" : "새로 만들기"}
    </button>
</div>

{#if error}
    <p class="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{/if}

{#if creating}
    <div class="mt-4 space-y-4 rounded-md border border-zinc-200 p-5 dark:border-zinc-800">
        <div>
            <span class="mb-2 block text-sm font-medium">무엇을 만드나요</span>
            <div class="grid gap-2 sm:grid-cols-2">
                {#each COLLECTION_PRESETS as p (p)}
                    <button
                        type="button"
                        onclick={() => (preset = p)}
                        class="rounded-md border px-4 py-3 text-left transition {preset === p
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                            : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'}"
                    >
                        <span class="block font-medium">{PRESET_LABEL[p]}</span>
                        <span class="mt-0.5 block text-xs leading-relaxed text-zinc-500">
                            {PRESET_DESCRIPTION[p]}
                        </span>
                    </button>
                {/each}
            </div>

            <!-- 축 값은 고급 설정이라 접어 둔다. 다만 뭐가 정해졌는지는 알 수 있어야 한다 -->
            <details class="mt-2">
                <summary class="cursor-pointer text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                    {PRESET_LABEL[preset]}을(를) 고르면 정해지는 것
                </summary>
                <dl class="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    {#each [["시간", TIMING_LABEL[axes.timing]], ["결과 공개", REVEAL_LABEL[axes.reveal]], ["순위", SCORING_LABEL[axes.scoring]], ["참가", JOIN_POLICY_LABEL[axes.joinPolicy]], ["공개 범위", VISIBILITY_LABEL[axes.visibility]]] as [k, v] (k)}
                        <div class="flex justify-between gap-2 border-b border-zinc-100 py-1 dark:border-zinc-900">
                            <dt class="text-zinc-400">{k}</dt>
                            <dd>{v}</dd>
                        </div>
                    {/each}
                </dl>
                <p class="mt-2 text-xs text-zinc-400">만든 뒤에 하나씩 바꿀 수 있습니다.</p>
            </details>
        </div>

        <label class="block text-sm">
            <span class="mb-1 block font-medium">제목</span>
            <input
                bind:value={title}
                placeholder="예: 자료구조 1주차"
                class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
        </label>

        <label class="block text-sm">
            <span class="mb-1 block font-medium">주소</span>
            <span class="flex items-center gap-1">
                <span class="shrink-0 text-sm text-zinc-400">/c/</span>
                <input
                    bind:value={slug}
                    oninput={() => (slugTouched = true)}
                    class="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
            </span>
            <span class="mt-1 block text-xs text-zinc-400">
                제목에서 자동으로 만듭니다. 고치면 그대로 둡니다.
            </span>
        </label>

        <label class="block text-sm">
            <span class="mb-1 block font-medium">설명 (선택)</span>
            <MarkdownInput bind:value={description} rows={4} allowUpload placeholder="안내문이나 머리말" />
        </label>

        {#if needsFixed}
            <div class="grid gap-3 sm:grid-cols-2">
                <label class="block text-sm">
                    <span class="mb-1 block font-medium">시작</span>
                    <input
                        type="datetime-local"
                        bind:value={startsAt}
                        class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                </label>
                <label class="block text-sm">
                    <span class="mb-1 block font-medium">종료</span>
                    <input
                        type="datetime-local"
                        bind:value={endsAt}
                        class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                </label>
            </div>
        {/if}

        {#if needsDuration}
            <label class="block text-sm">
                <span class="mb-1 block font-medium">제한 시간 (분)</span>
                <input
                    type="number"
                    bind:value={durationMinutes}
                    min="1"
                    class="w-40 rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span class="mt-1 block text-xs text-zinc-400">
                    참가자가 시작을 누른 시점부터 이 시간이 흐릅니다.
                </span>
            </label>
        {/if}

        <div class="flex flex-wrap items-center gap-3">
            <button
                onclick={create}
                disabled={busy || !slug.trim() || !title.trim() || (needsFixed && (!startsAt || !endsAt))}
                class="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
                {busy ? "..." : "만들고 내용 채우기"}
            </button>
            <span class="text-xs text-zinc-400">만들면 바로 문제와 설명을 넣는 화면으로 갑니다.</span>
        </div>
    </div>
{/if}

{#if !loaded}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else if rows.length === 0}
    <div class="mt-6 rounded-md border border-zinc-200 px-6 py-12 text-center dark:border-zinc-800">
        <p class="text-sm text-zinc-500">아직 만든 것이 없습니다.</p>
        <p class="mt-1 text-xs text-zinc-400">
            수업 자료는 교재, 연습 문제 묶음은 문제집, 시간이 정해진 것은 대회입니다.
        </p>
        {#if !creating}
            <button
                onclick={() => (creating = true)}
                class="mt-4 rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
                새로 만들기
            </button>
        {/if}
    </div>
{:else}
    <ul class="mt-4 divide-y divide-zinc-100 dark:divide-zinc-900">
        {#each rows as r (r.id)}
            {@const st = statusOf(r)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <span class="w-16 shrink-0 text-xs text-zinc-400">{PRESET_LABEL[r.preset]}</span>
                <a href="/admin/collections/{r.id}" class="font-medium hover:underline">{r.title}</a>
                <span class="rounded px-1.5 py-0.5 text-xs {st.cls}">{st.text}</span>
                {#if r.visibility !== "public"}
                    <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                        {VISIBILITY_LABEL[r.visibility]}
                    </span>
                {/if}

                <span class="ml-auto flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                    {#if r.problemCount === 0}
                        <span class="text-amber-600 dark:text-amber-400">문제 없음</span>
                    {:else}
                        <span>문제 {r.problemCount}</span>
                    {/if}
                    <span>인원 {r.memberCount}</span>
                    {#if r.timing === "fixed" && r.startsAt && r.endsAt}
                        <span>{formatDate(r.startsAt)} ~ {formatDate(r.endsAt)}</span>
                    {:else if r.timing === "per_user"}
                        <span>각자 {r.durationMinutes}분</span>
                    {/if}
                    <a href="/c/{r.slug}" class="hover:underline">보기</a>
                </span>
            </li>
        {/each}
    </ul>
{/if}
