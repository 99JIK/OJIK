<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { get, post, patch, del, ApiError } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { formatDate } from "$lib/format";
    import { SOLUTION_LIMITS } from "@ojik/core";
    import Markdown from "$lib/Markdown.svelte";
    import MarkdownInput from "$lib/MarkdownInput.svelte";

    /** 풀이 하나와 댓글. 목록과 같은 조건으로 막힌다 */

    interface Solution {
        id: number;
        problemId: number;
        title: string;
        body: string;
        commentCount: number;
        createdAt: string;
        updatedAt: string;
        userId: number;
        handle: string;
    }

    interface Comment {
        id: number;
        body: string;
        createdAt: string;
        userId: number;
        handle: string;
    }

    interface Detail {
        solution: Solution;
        comments: Comment[];
        canEdit: boolean;
        canDelete: boolean;
    }

    const id = $derived(Number(page.params.id ?? 0));

    let data = $state<Detail | null>(null);
    let locked = $state(false);
    let error = $state<string | null>(null);

    let editing = $state(false);
    let editTitle = $state("");
    let editBody = $state("");

    let comment = $state("");
    let busy = $state(false);
    let actionError = $state<string | null>(null);

    async function load() {
        try {
            data = await get<Detail>(`/solutions/${id}`);
            locked = false;
            error = null;
        } catch (e) {
            if (e instanceof ApiError && e.status === 403) {
                locked = true;
                data = null;
            } else {
                error = e instanceof Error ? e.message : String(e);
            }
        }
    }

    $effect(() => {
        void id;
        if (session.user) void load();
    });

    function startEdit() {
        if (!data) return;
        editTitle = data.solution.title;
        editBody = data.solution.body;
        editing = true;
        actionError = null;
    }

    async function run(fn: () => Promise<unknown>) {
        busy = true;
        actionError = null;
        try {
            await fn();
        } catch (e) {
            actionError = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    const saveEdit = () =>
        run(async () => {
            await patch(`/solutions/${id}`, { title: editTitle.trim(), body: editBody.trim() });
            editing = false;
            await load();
        });

    const addComment = () =>
        run(async () => {
            await post(`/solutions/${id}/comments`, { body: comment.trim() });
            comment = "";
            await load();
        });

    async function removeSolution() {
        if (!data) return;
        if (!confirm("이 풀이를 지울까요? 달린 댓글은 남습니다.")) return;
        await run(async () => {
            await del(`/solutions/${id}`);
            await goto(`/problem/${data!.solution.problemId}/solutions`);
        });
    }

    async function removeComment(cid: number) {
        if (!confirm("이 댓글을 지울까요?")) return;
        await run(async () => {
            await del(`/solutions/${id}/comments/${cid}`);
            await load();
        });
    }
</script>

{#if !session.user}
    <p class="mt-8 text-sm text-zinc-500">
        <a href="/login" class="text-blue-600 hover:underline dark:text-blue-400">로그인</a>이 필요합니다.
    </p>
{:else if locked}
    <p class="mt-8 text-sm text-zinc-500">이 문제를 맞히면 풀이를 읽을 수 있습니다.</p>
{:else if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if data}
    {@const s = data.solution}
    <a
        href="/problem/{s.problemId}/solutions"
        class="text-sm text-blue-600 hover:underline dark:text-blue-400"
    >
        풀이 목록으로
    </a>

    {#if editing}
        <input
            bind:value={editTitle}
            maxlength={SOLUTION_LIMITS.titleMax}
            class="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-lg font-bold dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div class="mt-3">
            <MarkdownInput bind:value={editBody} maxLength={SOLUTION_LIMITS.bodyMax} />
        </div>
        <div class="mt-3 flex gap-2">
            <button
                onclick={saveEdit}
                disabled={busy}
                class="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
                저장
            </button>
            <button
                onclick={() => (editing = false)}
                class="rounded-md px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
                취소
            </button>
        </div>
    {:else}
        <div class="mt-3 flex items-baseline justify-between gap-4">
            <h1 class="text-2xl font-bold">{s.title}</h1>
            <div class="flex shrink-0 gap-3 text-sm">
                {#if data.canEdit}
                    <button onclick={startEdit} class="text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200">
                        고치기
                    </button>
                {/if}
                {#if data.canDelete}
                    <button
                        onclick={removeSolution}
                        class="text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
                    >
                        지우기
                    </button>
                {/if}
            </div>
        </div>
        <p class="mt-1 text-xs text-zinc-400">
            <a href="/user/{s.handle}" class="hover:underline">{s.handle}</a>
            · {formatDate(s.createdAt)}
            {#if s.updatedAt !== s.createdAt}· 고침 {formatDate(s.updatedAt)}{/if}
        </p>

        <div class="mt-5">
            <Markdown source={s.body} />
        </div>
    {/if}

    {#if actionError}
        <p class="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {actionError}
        </p>
    {/if}

    <section class="mt-10">
        <h2 class="text-sm font-semibold">댓글 {data.comments.length}</h2>

        <ul class="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {#each data.comments as cm (cm.id)}
                <li class="py-3">
                    <div class="flex items-baseline gap-2 text-xs text-zinc-400">
                        <a href="/user/{cm.handle}" class="hover:underline">{cm.handle}</a>
                        <span>{formatDate(cm.createdAt)}</span>
                        {#if session.user && (cm.userId === session.user.id || session.user.role !== "user")}
                            <button
                                onclick={() => removeComment(cm.id)}
                                class="ml-auto underline hover:text-zinc-600 dark:hover:text-zinc-300"
                            >
                                지우기
                            </button>
                        {/if}
                    </div>
                    <p class="mt-1 whitespace-pre-wrap text-sm">{cm.body}</p>
                </li>
            {/each}
        </ul>

        <textarea
            bind:value={comment}
            rows="3"
            maxlength={SOLUTION_LIMITS.commentMax}
            placeholder="댓글"
            class="mt-3 w-full rounded-md border border-zinc-300 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        ></textarea>
        <button
            onclick={addComment}
            disabled={busy || comment.trim().length === 0}
            class="mt-2 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
            남기기
        </button>
    </section>
{:else}
    <p class="mt-8 text-sm text-zinc-500">불러오는 중...</p>
{/if}
