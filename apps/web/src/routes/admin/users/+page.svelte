<script lang="ts">
    import { get, patch } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { formatDate } from "$lib/format";
    import { ROLES, ROLE_LABEL, type Role } from "@ojik/core";

    interface Row {
        id: number;
        handle: string;
        displayName: string | null;
        role: Role;
        solvedCount: number;
        submissionCount: number;
        createdAt: string;
        lastLoginAt: string | null;
    }

    let rows = $state<Row[]>([]);
    let q = $state("");
    let error = $state<string | null>(null);
    let notice = $state<string | null>(null);
    let loaded = $state(false);

    async function load() {
        try {
            const r = await get<{ users: Row[] }>("/admin/users", { q });
            rows = r.users;
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

    async function setRole(u: Row, role: Role) {
        if (role === u.role) return;
        if (!confirm(`${u.handle} 의 권한을 ${ROLE_LABEL[role]} 로 바꿉니다. 계속할까요?`)) {
            await load(); // select 를 되돌린다
            return;
        }
        try {
            await patch(`/admin/users/${u.id}/role`, { role });
            notice = `${u.handle} -> ${ROLE_LABEL[role]}`;
            await load();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            await load();
        }
    }
</script>

<div class="flex items-center justify-between">
    <span class="text-sm text-zinc-400">{rows.length}명</span>
    <input
        bind:value={q}
        placeholder="아이디 검색"
        class="w-56 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    />
</div>

{#if notice}
    <p class="mt-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
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
                <th class="w-12 font-medium">id</th>
                <th class="font-medium">아이디</th>
                <th class="w-32 font-medium">권한</th>
                <th class="w-20 text-right font-medium">푼 문제</th>
                <th class="w-32 font-medium">마지막 로그인</th>
            </tr>
        </thead>
        <tbody>
            {#each rows as u (u.id)}
                {@const isMe = session.user?.id === u.id}
                <tr class="border-b border-zinc-100 dark:border-zinc-900">
                    <td class="tabular-nums text-zinc-400">{u.id}</td>
                    <td>
                        <a href="/user/{u.handle}" class="hover:underline">{u.handle}</a>
                        {#if u.displayName}
                            <span class="ml-2 text-zinc-400">{u.displayName}</span>
                        {/if}
                        {#if isMe}
                            <span class="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                나
                            </span>
                        {/if}
                    </td>
                    <td>
                        <select
                            value={u.role}
                            onchange={(e) => setRole(u, e.currentTarget.value as Role)}
                            disabled={isMe}
                            class="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
                        >
                            {#each ROLES as r (r)}
                                <option value={r}>{ROLE_LABEL[r]}</option>
                            {/each}
                        </select>
                    </td>
                    <td class="text-right tabular-nums">{u.solvedCount}</td>
                    <td class="text-xs text-zinc-500">
                        {u.lastLoginAt ? formatDate(u.lastLoginAt) : "-"}
                    </td>
                </tr>
            {:else}
                <tr><td colspan="5" class="py-8 text-center text-zinc-400">사용자가 없습니다</td></tr>
            {/each}
        </tbody>
    </table>
    <p class="mt-3 text-xs text-zinc-400">
        자기 권한은 내릴 수 없습니다. 실수로 없애면 서버에서 <code>npm run set-role</code> 로만 되돌릴 수 있습니다.
    </p>
{/if}
