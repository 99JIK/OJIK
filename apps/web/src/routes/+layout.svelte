<script lang="ts">
    import "../app.css";
    import { onMount } from "svelte";
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { session } from "$lib/session.svelte";

    let { children } = $props();
    let dark = $state(false);

    onMount(() => {
        // 저장된 선택이 없으면 OS 설정을 따른다
        const saved = localStorage.getItem("theme");
        dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
        applyTheme();
        void session.load();
    });

    function applyTheme() {
        document.documentElement.classList.toggle("dark", dark);
    }

    function toggleTheme() {
        dark = !dark;
        localStorage.setItem("theme", dark ? "dark" : "light");
        applyTheme();
    }

    const nav = [
        { href: "/", label: "문제" },
        { href: "/submissions", label: "채점 현황" },
        { href: "/courses", label: "교재" },
        { href: "/problemsets", label: "문제집" },
        { href: "/contests", label: "대회" },
        { href: "/ranking", label: "랭킹" },
    ];

    function active(href: string): boolean {
        return href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(href);
    }

    async function logout() {
        await session.logout();
        void goto("/");
    }
</script>

<div class="flex min-h-full flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <header class="border-b border-zinc-200 dark:border-zinc-800">
        <div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
            <a href="/" class="flex items-baseline gap-1.5">
                <span class="text-lg font-bold text-blue-600 dark:text-blue-400">OJIK</span>
                <span class="text-sm text-zinc-400">오직</span>
            </a>

            <nav class="flex flex-1 gap-1 text-sm">
                {#each nav as item (item.href)}
                    <a
                        href={item.href}
                        class="rounded-md px-3 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        class:bg-zinc-100={active(item.href)}
                        class:dark:bg-zinc-800={active(item.href)}
                        class:font-semibold={active(item.href)}>{item.label}</a
                    >
                {/each}
            </nav>

            <button
                onclick={toggleTheme}
                class="rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="테마 전환">{dark ? "밝게" : "어둡게"}</button
            >

            {#if session.isStaff}
                <a
                    href="/admin"
                    class="rounded-md px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    class:font-semibold={active("/admin")}>관리</a
                >
            {/if}

            {#if !session.ready}
                <span class="text-sm text-zinc-400">...</span>
            {:else if session.user}
                <div class="flex items-center gap-3 text-sm">
                    <a href="/user/{session.user.handle}" class="font-medium hover:underline">
                        {session.user.handle}
                    </a>
                    <button onclick={logout} class="text-zinc-500 hover:underline">로그아웃</button>
                </div>
            {:else}
                <a href="/login" class="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                    로그인
                </a>
            {/if}
        </div>
    </header>

    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {@render children()}
    </main>

    <footer class="border-t border-zinc-200 px-4 py-4 text-center text-xs text-zinc-400 dark:border-zinc-800">
        OJIK 오직
    </footer>
</div>
