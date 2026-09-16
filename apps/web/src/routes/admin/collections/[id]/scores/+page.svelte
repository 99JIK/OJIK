<script lang="ts">
    import { page } from "$app/state";
    import { get } from "$lib/api";
    import { PROBLEM_KIND_LABEL, MEMBER_ROLE_LABEL, type ProblemKind, type MemberRole } from "@ojik/core";

    /**
     * 성적표. 학생 x 문제 표.
     *
     * 순위표와 다른 물건이다. 순위표는 대회용으로 등수를 매기고, 이건 수업용으로
     * 누가 뭘 어디까지 했는지를 본다. 등수가 없고 안 낸 칸이 그대로 보인다.
     *
     * CSV 로 받을 수 있게 둔다. 성적을 학교 시스템에 옮겨야 하는데 그게 없으면
     * 결국 화면을 보고 손으로 친다.
     */
    interface Item {
        problemId: number | null;
        idx: number;
        title: string;
        kind: ProblemKind;
    }
    interface Member {
        userId: number;
        handle: string;
        displayName: string | null;
        role: MemberRole;
    }
    interface Cell {
        userId: number;
        problemId: number;
        best: number;
        tries: number;
        solved: boolean;
    }

    const id = $derived(Number(page.params.id));

    let items = $state<Item[]>([]);
    let members = $state<Member[]>([]);
    let cells = $state<Cell[]>([]);
    let error = $state<string | null>(null);
    let loaded = $state(false);

    $effect(() => {
        const cid = id;
        void (async () => {
            try {
                const r = await get<{ items: Item[]; members: Member[]; cells: Cell[] }>(
                    `/collections/${cid}/scores`,
                );
                items = r.items;
                members = r.members;
                cells = r.cells;
                error = null;
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
            } finally {
                loaded = true;
            }
        })();
    });

    /** 빠른 조회용. 학생 x 문제는 금방 커진다 */
    const byKey = $derived(new Map(cells.map((c) => [`${c.userId}:${c.problemId}`, c])));
    const cellOf = (u: number, p: number | null) => (p === null ? undefined : byKey.get(`${u}:${p}`));

    const totals = $derived(
        new Map(
            members.map((m) => [
                m.userId,
                items.reduce((a, it) => a + (cellOf(m.userId, it.problemId)?.best ?? 0), 0),
            ]),
        ),
    );

    const solvedCounts = $derived(
        new Map(
            members.map((m) => [
                m.userId,
                items.filter((it) => cellOf(m.userId, it.problemId)?.solved).length,
            ]),
        ),
    );

    function downloadCsv() {
        const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
        const head = ["아이디", "이름", "역할", ...items.map((i) => i.title), "합계", "맞힌 수"];
        const lines = [head.map(esc).join(",")];

        for (const m of members) {
            const row = [
                m.handle,
                m.displayName ?? "",
                MEMBER_ROLE_LABEL[m.role],
                ...items.map((it) => {
                    const c = cellOf(m.userId, it.problemId);
                    // 안 낸 칸은 빈칸으로 둔다. 0 으로 적으면 "내고 0점" 과 구분이 안 된다
                    return c ? String(c.best) : "";
                }),
                String(totals.get(m.userId) ?? 0),
                `${solvedCounts.get(m.userId) ?? 0}/${items.length}`,
            ];
            lines.push(row.map(esc).join(","));
        }

        // 엑셀이 UTF-8 로 열게 BOM 을 붙인다. 없으면 한글 이름이 깨진다
        const csv = "﻿" + lines.join("\r\n") + "\r\n";
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `성적표-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-xl font-bold">성적표</h1>
    <div class="flex gap-3 text-sm">
        <a href="/admin/collections/{id}" class="text-zinc-500 hover:underline">편집으로</a>
        <button
            onclick={downloadCsv}
            disabled={members.length === 0}
            class="rounded-md bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
            CSV 받기
        </button>
    </div>
</div>

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if !loaded}
    <p class="mt-6 text-sm text-zinc-500">불러오는 중...</p>
{:else if members.length === 0 || items.length === 0}
    <p class="mt-6 rounded-md border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        {members.length === 0 ? "명단이 비어 있습니다." : "담긴 문제가 없습니다."}
    </p>
{:else}
    <div class="mt-4 overflow-auto">
        <table class="w-full border-collapse text-sm">
            <thead>
                <tr class="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th class="sticky left-0 bg-white px-2 py-2 font-medium dark:bg-zinc-950">아이디</th>
                    <th class="px-2 py-2 font-medium">이름</th>
                    {#each items as it (it.problemId)}
                        <th class="px-2 py-2 text-center font-medium">
                            <span class="block max-w-24 truncate" title={it.title}>{it.title}</span>
                            {#if it.kind !== "code"}
                                <span class="text-xs font-normal text-zinc-400">{PROBLEM_KIND_LABEL[it.kind]}</span>
                            {/if}
                        </th>
                    {/each}
                    <th class="px-2 py-2 text-right font-medium">합계</th>
                    <th class="px-2 py-2 text-right font-medium">맞힌 수</th>
                </tr>
            </thead>
            <tbody>
                {#each members as m (m.userId)}
                    <tr class="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900">
                        <td class="sticky left-0 bg-white px-2 py-1.5 dark:bg-zinc-950">
                            <a href="/user/{m.handle}" class="hover:underline">{m.handle}</a>
                            {#if m.role !== "member"}
                                <span class="ml-1 text-xs text-zinc-400">{MEMBER_ROLE_LABEL[m.role]}</span>
                            {/if}
                        </td>
                        <td class="px-2 py-1.5 text-zinc-500">{m.displayName ?? ""}</td>

                        {#each items as it (it.problemId)}
                            {@const c = cellOf(m.userId, it.problemId)}
                            <td class="px-2 py-1.5 text-center tabular-nums">
                                {#if !c}
                                    <!-- 안 낸 칸. 0 으로 적으면 "내고 0점" 과 구분이 안 된다 -->
                                    <span class="text-zinc-300 dark:text-zinc-700">·</span>
                                {:else if c.solved}
                                    <span class="text-green-600 dark:text-green-400">{c.best}</span>
                                {:else}
                                    <span class="text-amber-600 dark:text-amber-400" title="{c.tries}번 냄">
                                        {c.best}
                                    </span>
                                {/if}
                            </td>
                        {/each}

                        <td class="px-2 py-1.5 text-right font-medium tabular-nums">{totals.get(m.userId) ?? 0}</td>
                        <td class="px-2 py-1.5 text-right tabular-nums text-zinc-500">
                            {solvedCounts.get(m.userId) ?? 0}/{items.length}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>

    <p class="mt-3 text-xs text-zinc-400">
        점수는 그 문제에서 받은 최고 점수입니다. 여러 번 냈으면 제일 잘 본 것을 칩니다.
        <span class="text-green-600 dark:text-green-400">초록</span>은 맞힘,
        <span class="text-amber-600 dark:text-amber-400">주황</span>은 냈지만 못 맞힘,
        <span class="text-zinc-400">·</span>은 안 냄입니다.
    </p>
{/if}
