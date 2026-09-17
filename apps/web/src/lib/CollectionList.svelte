<script lang="ts">
    import { get } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { formatDate } from "$lib/format";
    import {
        PRESET_LABEL,
        PRESET_DESCRIPTION,
        VISIBILITY_LABEL,
        type CollectionPreset,
        type Visibility,
    } from "@ojik/core";

    /**
     * 교재, 문제집, 대회, 코딩테스트 목록을 한 컴포넌트로 그린다.
     * 서버에서 넷이 같은 테이블이라 화면도 하나면 된다. preset 만 다르게 넘긴다.
     *
     * 줄 목록이 아니라 카드로 둔다. 제목만 있는 줄이 이어지면 어디서 하나가 끝나고 다음이
     * 시작하는지 안 보인다. 개수와 진도를 같이 보여 주는 것도 같은 이유다. 들어가 보기 전에
     * "이게 뭔지" 와 "내가 어디까지 했는지" 를 알 수 있어야 한다.
     */
    let { preset }: { preset: CollectionPreset } = $props();

    interface Row {
        id: number;
        slug: string;
        title: string;
        description: string;
        preset: CollectionPreset;
        timing: "none" | "fixed" | "per_user";
        visibility: Visibility;
        startsAt: string | null;
        endsAt: string | null;
        durationMinutes: number | null;
        problemCount: number;
        memberCount: number;
        ownerHandle: string | null;
        mySolved: number;
    }

    let rows = $state<Row[]>([]);
    let error = $state<string | null>(null);
    let loaded = $state(false);

    $effect(() => {
        const p = preset;
        loaded = false;
        void (async () => {
            try {
                const r = await get<{ collections: Row[] }>("/collections", { preset: p });
                rows = r.collections;
                error = null;
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
            } finally {
                loaded = true;
            }
        })();
    });

    /** 시간 창이 있는 것만 진행 상태를 표시한다. 상시 컬렉션엔 의미가 없다 */
    function phase(r: Row): { text: string; cls: string } | null {
        if (r.timing === "none") return null;
        if (r.timing === "per_user") {
            return { text: "각자 시작", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" };
        }
        const now = Date.now();
        if (r.startsAt && now < new Date(r.startsAt).getTime()) {
            return { text: "예정", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" };
        }
        if (r.endsAt && now > new Date(r.endsAt).getTime()) {
            return { text: "종료", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" };
        }
        return { text: "진행 중", cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" };
    }

    function period(r: Row): string | null {
        if (r.timing === "fixed" && r.startsAt && r.endsAt) {
            return `${formatDate(r.startsAt)} ~ ${formatDate(r.endsAt)}`;
        }
        if (r.timing === "per_user" && r.durationMinutes) return `제한 ${r.durationMinutes}분`;
        if (r.endsAt) return `마감 ${formatDate(r.endsAt)}`;
        return null;
    }

    /** 설명은 첫 줄만. 마크다운 기호는 목록에서 거슬리므로 흔한 것만 걷어낸다 */
    function summary(md: string): string {
        const first = md.split("\n").find((l) => l.trim()) ?? "";
        return first.replace(/^#{1,6}\s*/, "").replace(/[*_`>]/g, "").slice(0, 120);
    }
</script>

<div>
    <h1 class="text-xl font-bold">{PRESET_LABEL[preset]}</h1>
    <p class="mt-1 text-sm text-zinc-500">{PRESET_DESCRIPTION[preset]}</p>
</div>

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if !loaded}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else if rows.length === 0}
    <div class="mt-6 rounded-md border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
        <p class="text-sm text-zinc-500">아직 없습니다.</p>
        {#if session.canTeach}
            <a
                href="/admin/collections"
                class="mt-3 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
                만들러 가기
            </a>
        {/if}
    </div>
{:else}
    <ul class="mt-5 grid gap-3 sm:grid-cols-2">
        {#each rows as r (r.id)}
            {@const p = phase(r)}
            {@const t = period(r)}
            {@const done = r.problemCount > 0 && r.mySolved >= r.problemCount}
            <li>
                <a
                    href="/c/{r.slug}"
                    class="block h-full rounded-md border border-zinc-200 p-4 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                >
                    <div class="flex flex-wrap items-center gap-1.5">
                        {#if p}
                            <span class="rounded px-1.5 py-0.5 text-xs {p.cls}">{p.text}</span>
                        {/if}
                        {#if r.visibility !== "public"}
                            <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                                {VISIBILITY_LABEL[r.visibility]}
                            </span>
                        {/if}
                        {#if done}
                            <span class="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-300">
                                완료
                            </span>
                        {/if}
                    </div>

                    <h2 class="mt-1.5 font-medium">{r.title}</h2>

                    {#if r.description}
                        <p class="mt-1 line-clamp-2 text-sm text-zinc-500">{summary(r.description)}</p>
                    {/if}

                    <!-- 로그인했으면 진도를 막대로. 숫자만 있으면 여러 개를 훑을 때 비교가 안 된다 -->
                    {#if session.user && r.problemCount > 0}
                        <div class="mt-3 flex items-center gap-2">
                            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                <div
                                    class="h-full rounded-full {done ? 'bg-green-500' : 'bg-blue-500'}"
                                    style="width: {Math.round((r.mySolved / r.problemCount) * 100)}%"
                                ></div>
                            </div>
                            <span class="shrink-0 text-xs tabular-nums text-zinc-500">
                                {r.mySolved}/{r.problemCount}
                            </span>
                        </div>
                    {/if}

                    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                        <span>문제 {r.problemCount}</span>
                        {#if r.memberCount > 0}
                            <span>참가 {r.memberCount}</span>
                        {/if}
                        {#if r.ownerHandle}
                            <span>{r.ownerHandle}</span>
                        {/if}
                        {#if t}
                            <span class="ml-auto">{t}</span>
                        {/if}
                    </div>
                </a>
            </li>
        {/each}
    </ul>
{/if}
