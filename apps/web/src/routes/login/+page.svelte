<script lang="ts">
    import { goto } from "$app/navigation";
    import { session } from "$lib/session.svelte";

    let mode = $state<"login" | "register">("login");
    let handle = $state("");
    let email = $state("");
    let password = $state("");
    /** 기본값은 꺼짐이어야 한다. 체크된 채로 가입시키면 동의로 인정되지 않는다 */
    let researchConsent = $state(false);
    let error = $state<string | null>(null);
    let busy = $state(false);

    async function submit(e: Event) {
        e.preventDefault();
        busy = true;
        error = null;
        try {
            if (mode === "login") await session.login(email, password);
            else await session.register(handle, email, password, researchConsent);
            void goto("/");
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        } finally {
            busy = false;
        }
    }
</script>

<div class="mx-auto mt-10 max-w-sm">
    <h1 class="text-xl font-bold">{mode === "login" ? "로그인" : "회원가입"}</h1>

    <form onsubmit={submit} class="mt-6 flex flex-col gap-3">
        {#if mode === "register"}
            <label class="flex flex-col gap-1 text-sm">
                아이디
                <input
                    bind:value={handle}
                    required
                    autocomplete="username"
                    class="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span class="text-xs text-zinc-400">공개되는 표시 이름입니다. 로그인은 이메일로 합니다.</span>
            </label>
        {/if}

        <label class="flex flex-col gap-1 text-sm">
            이메일
            <input
                bind:value={email}
                type="email"
                required
                autocomplete="email"
                class="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
        </label>

        <label class="flex flex-col gap-1 text-sm">
            비밀번호
            <input
                bind:value={password}
                type="password"
                required
                minlength={mode === "register" ? 8 : undefined}
                autocomplete={mode === "login" ? "current-password" : "new-password"}
                class="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
        </label>

        {#if mode === "register"}
            <label class="mt-1 flex items-start gap-2 text-sm">
                <input type="checkbox" bind:checked={researchConsent} class="mt-0.5" />
                <span>
                    제출한 코드와 채점 기록을 <strong>연구 목적</strong>으로 쓰는 데 동의합니다.
                    <span class="block text-xs text-zinc-400">
                        선택 사항입니다. 동의하지 않아도 모든 기능을 쓸 수 있고, 나중에 설정에서 바꿀 수 있습니다.
                    </span>
                </span>
            </label>
        {/if}

        {#if error}
            <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {error}
            </p>
        {/if}

        <button
            type="submit"
            disabled={busy}
            class="mt-2 rounded-md bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
            {busy ? "처리 중..." : mode === "login" ? "로그인" : "가입"}
        </button>
    </form>

    <button
        onclick={() => {
            mode = mode === "login" ? "register" : "login";
            error = null;
        }}
        class="mt-4 w-full text-sm text-zinc-500 hover:underline"
    >
        {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
    </button>
</div>
