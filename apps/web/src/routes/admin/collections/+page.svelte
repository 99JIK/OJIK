<script lang="ts">
    import { get, post } from "$lib/api";
    import { formatDate } from "$lib/format";
    import {
        COLLECTION_PRESETS,
        PRESET_LABEL,
        PRESET_DEFAULTS,
        TIMING_LABEL,
        type CollectionPreset,
    } from "@ojik/core";

    interface Row {
        id: number;
        slug: string;
        title: string;
        preset: CollectionPreset;
        timing: "none" | "fixed" | "per_user";
        visibility: string;
        startsAt: string | null;
        endsAt: string | null;
        durationMinutes: number | null;
    }

    let rows = $state<Row[]>([]);
    let error = $state<string | null>(null);
    let loaded = $state(false);

    // 새로 만들기
    let creating = $state(false);
    let preset = $state<CollectionPreset>("problemset");
    let slug = $state("");
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

    /** 프리셋이 정하는 축 값. 사용자는 이걸 몰라도 되지만 만들 때 뭐가 정해지는지는 보여준다 */
    const axes = $derived(PRESET_DEFAULTS[preset]);
    const needsFixed = $derived(axes.timing === "fixed");
    const needsDuration = $derived(axes.timing === "per_user");

    async function create() {
        busy = true;
        error = null;
        try {
            const body: Record<string, unknown> = { preset, slug, title, description };
            if (needsFixed) {
                body.startsAt = new Date(startsAt).toISOString();
                body.endsAt = new Date(endsAt).toISOString();
            }
            if (needsDuration) body.durationMinutes = durationMinutes;

            await post("/collections", body);
            creating = false;
            slug = "";
            title = "";
            description = "";
            await load();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }
</script>

<div class="flex items-center justify-between">
    <button
        onclick={() => (creating = !creating)}
        class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
    >
        {creating ? "닫기" : "새 컬렉션"}
    </button>
    <span class="text-sm text-zinc-400">{rows.length}개</span>
</div>

{#if error}
    <p class="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{/if}

{#if creating}
    <div class="mt-4 space-y-3 rounded-md border border-zinc-200 p-5 dark:border-zinc-800">
        <label class="block text-sm">
            <span class="mb-1 block font-medium">종류</span>
            <select
                bind:value={preset}
                class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
                {#each COLLECTION_PRESETS as p (p)}
                    <option value={p}>{PRESET_LABEL[p]}</option>
                {/each}
            </select>
            <span class="mt-1 block text-xs text-zinc-400">
                시간 {TIMING_LABEL[axes.timing]} · 결과 {axes.reveal === "immediate"
                    ? "즉시"
                    : axes.reveal === "frozen"
                      ? "동결"
                      : "종료 후"} · 참가 {axes.joinPolicy} · {axes.visibility}
            </span>
        </label>

        <div class="grid gap-3 sm:grid-cols-2">
            <label class="block text-sm">
                <span class="mb-1 block font-medium">주소 (slug)</span>
                <input
                    bind:value={slug}
                    placeholder="week-1"
                    class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
            </label>
            <label class="block text-sm">
                <span class="mb-1 block font-medium">제목</span>
                <input
                    bind:value={title}
                    class="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
            </label>
        </div>

        <label class="block text-sm">
            <span class="mb-1 block font-medium">설명</span>
            <textarea
                bind:value={description}
                rows="3"
                class="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            ></textarea>
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

        <button
            onclick={create}
            disabled={busy || !slug.trim() || !title.trim() || (needsFixed && (!startsAt || !endsAt))}
            class="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
            {busy ? "..." : "만들기"}
        </button>
    </div>
{/if}

{#if !loaded}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else}
    <table class="ojik-table mt-4 w-full text-sm">
        <thead class="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
                <th class="w-24 font-medium">종류</th>
                <th class="font-medium">제목</th>
                <th class="w-28 font-medium">주소</th>
                <th class="w-44 font-medium">기간</th>
                <th class="w-24"></th>
            </tr>
        </thead>
        <tbody>
            {#each rows as r (r.id)}
                <tr class="border-b border-zinc-100 dark:border-zinc-900">
                    <td class="text-zinc-500">{PRESET_LABEL[r.preset]}</td>
                    <td>
                        <a href="/admin/collections/{r.id}" class="hover:underline">{r.title}</a>
                    </td>
                    <td class="font-mono text-xs text-zinc-400">{r.slug}</td>
                    <td class="text-xs text-zinc-500">
                        {#if r.timing === "fixed" && r.startsAt && r.endsAt}
                            {formatDate(r.startsAt)} ~ {formatDate(r.endsAt)}
                        {:else if r.timing === "per_user"}
                            각자 {r.durationMinutes}분
                        {:else}
                            상시
                        {/if}
                    </td>
                    <td class="text-right">
                        <a href="/c/{r.slug}" class="text-xs text-zinc-500 hover:underline">보기</a>
                    </td>
                </tr>
            {:else}
                <tr><td colspan="5" class="py-8 text-center text-zinc-400">컬렉션이 없습니다</td></tr>
            {/each}
        </tbody>
    </table>
{/if}
