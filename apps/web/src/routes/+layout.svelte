<script lang="ts">
    import "../app.css";
    import { onMount } from "svelte";
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { session } from "$lib/session.svelte";
    import Logo from "$lib/Logo.svelte";

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
    <!--
        머리글은 화면에 붙여 둔다. 문제를 아래로 내리며 읽다가 채점 현황으로 가려고
        맨 위까지 올라갈 일이 없게.

        좁은 화면에서는 메뉴가 두 줄이 되는 대신 가로로 밀린다. 줄이 늘면 본문이 그만큼
        내려가고, 그게 문제 화면에서 제일 거슬린다.
    -->
    <header
        class="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/85"
    >
        <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-5">
            <a href="/" class="shrink-0" aria-label="OJIK 홈">
                <Logo showSub={false} />
            </a>

            <nav class="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 text-sm">
                {#each nav as item (item.href)}
                    {@const on = active(item.href)}
                    <a
                        href={item.href}
                        aria-current={on ? "page" : undefined}
                        class="shrink-0 rounded-md px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800
                            {on
                            ? 'bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                            : 'text-zinc-600 dark:text-zinc-400'}">{item.label}</a
                    >
                {/each}
            </nav>

            <div class="flex shrink-0 items-center gap-1">
                <button
                    onclick={toggleTheme}
                    class="rounded-md px-2 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    aria-label="테마 전환"
                    title={dark ? "밝게" : "어둡게"}>{dark ? "☀" : "☾"}</button
                >

                {#if session.canTeach}
                    <a
                        href="/admin"
                        class="rounded-md px-2.5 py-1.5 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800
                            {active('/admin')
                            ? 'bg-zinc-100 font-semibold dark:bg-zinc-800'
                            : 'text-zinc-600 dark:text-zinc-400'}"
                        >{session.isStaff ? "관리" : "강의"}</a
                    >
                {/if}

                {#if !session.ready}
                    <span class="px-2 text-sm text-zinc-300 dark:text-zinc-700">···</span>
                {:else if session.user}
                    <a
                        href="/user/{session.user.handle}"
                        class="max-w-28 truncate rounded-md px-2.5 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        title={session.user.handle}
                    >
                        {session.user.handle}
                    </a>
                    <button
                        onclick={logout}
                        class="rounded-md px-2 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                        로그아웃
                    </button>
                {:else}
                    <a
                        href="/login"
                        class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
                    >
                        로그인
                    </a>
                {/if}
            </div>
        </div>
    </header>

    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {@render children()}
    </main>

    <footer class="border-t border-zinc-200 dark:border-zinc-800">
        <div
            class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-zinc-400"
        >
            <span>OJIK 오직</span>
            <a
                href="https://github.com/99JIK/OJIK"
                target="_blank"
                rel="noreferrer"
                class="hover:text-zinc-600 hover:underline dark:hover:text-zinc-300"
            >
                GitHub
            </a>
        </div>
    </footer>
</div>
