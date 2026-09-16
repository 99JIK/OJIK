<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { session } from "$lib/session.svelte";

    let { children } = $props();

    /**
     * 화면을 숨기는 건 안내일 뿐이다. 실제 차단은 서버가 한다.
     * 여기서는 권한 없는 사람이 빈 화면에서 헤매지 않게 안내만 띄운다.
     */
    const tabs = [
        { href: "/admin/problems", label: "문제" },
        { href: "/admin/collections", label: "컬렉션" },
        { href: "/admin/users", label: "사용자" },
    ];

    function active(href: string): boolean {
        return page.url.pathname.startsWith(href);
    }
</script>

{#if !session.ready}
    <p class="text-sm text-zinc-500">불러오는 중...</p>
{:else if !session.isStaff}
    <div class="mx-auto mt-16 max-w-md text-center">
        <h1 class="text-lg font-semibold">권한이 없습니다</h1>
        <p class="mt-2 text-sm text-zinc-500">
            관리 화면은 출제자 이상만 볼 수 있습니다.
        </p>
        {#if !session.user}
            <button
                onclick={() => goto("/login")}
                class="mt-4 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
                로그인
            </button>
        {/if}
    </div>
{:else}
    <div class="flex items-baseline justify-between">
        <h1 class="text-xl font-bold">관리</h1>
        <span class="text-sm text-zinc-400">{session.user?.handle}</span>
    </div>

    <nav class="mt-4 flex gap-1 border-b border-zinc-200 text-sm dark:border-zinc-800">
        {#each tabs as t (t.href)}
            <a
                href={t.href}
                class="border-b-2 px-4 py-2 transition {active(t.href)
                    ? 'border-blue-600 font-semibold text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}"
            >
                {t.label}
            </a>
        {/each}
    </nav>

    <div class="mt-6">
        {@render children()}
    </div>
{/if}
