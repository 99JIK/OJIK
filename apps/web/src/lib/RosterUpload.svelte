<script lang="ts">
    import { post } from "$lib/api";
    import { ROSTER_SAMPLE, ROSTER_MAX_ROWS, MEMBER_ROLES, MEMBER_ROLE_LABEL, type MemberRole } from "@ojik/core";

    /**
     * 명단 파일로 한 번에 등록.
     *
     * 계정이 없는 사람은 만들어 준다. 전에는 이미 가입한 사람만 넣을 수 있어서 수업 첫 주에
     * 전원이 먼저 가입해야 했다.
     *
     * 만든 계정의 임시 비밀번호는 한 번만 내려온다. 해시만 저장하므로 다시 못 본다.
     * 그래서 결과를 받기 전에는 창을 못 닫게 막고, 받았는지 눈에 띄게 둔다.
     */
    let { collectionId, onchange }: { collectionId: number; onchange: () => void } = $props();

    let csv = $state("");
    let role = $state<MemberRole>("member");
    let busy = $state(false);
    let error = $state<string | null>(null);

    interface Result {
        created: number;
        linked: number;
        errors: Array<{ line: number; message: string }>;
        passwordCsv: string | null;
    }
    let result = $state<Result | null>(null);
    let downloaded = $state(false);

    function download(name: string, text: string) {
        const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }

    function readFile(file: File) {
        const r = new FileReader();
        r.onload = () => (csv = String(r.result ?? ""));
        r.readAsText(file, "utf-8");
    }

    async function upload() {
        busy = true;
        error = null;
        result = null;
        downloaded = false;
        try {
            result = await post<Result>(`/collections/${collectionId}/roster`, { csv, role });
            csv = "";
            onchange();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }
</script>

<div class="space-y-3">
    <div class="flex flex-wrap items-center gap-3 text-sm">
        <button
            type="button"
            onclick={() => download("명단-양식.csv", "﻿" + ROSTER_SAMPLE + "\r\n")}
            class="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
        >
            양식 내려받기
        </button>
        <label class="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
            파일 고르기
            <input
                type="file"
                accept=".csv,text/csv,text/plain"
                class="hidden"
                onchange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) readFile(f);
                    e.currentTarget.value = "";
                }}
            />
        </label>
        <label class="flex items-center gap-2">
            역할
            <select
                bind:value={role}
                class="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
                {#each MEMBER_ROLES as r (r)}
                    <option value={r}>{MEMBER_ROLE_LABEL[r]}</option>
                {/each}
            </select>
        </label>
    </div>

    <textarea
        bind:value={csv}
        rows="6"
        spellcheck="false"
        placeholder={"handle,email,name\n" + "student01,student01@example.com,홍길동"}
        class="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
    ></textarea>

    <p class="text-xs text-zinc-400">
        아이디, 이메일, 이름 순입니다. 첫 줄이 열 이름이면 건너뜁니다. 한 번에 {ROSTER_MAX_ROWS}명까지.
        <br />
        이미 있는 계정은 그대로 명단에 넣고 비밀번호를 건드리지 않습니다. 없는 사람만 새로 만듭니다.
    </p>

    {#if error}
        <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
    {/if}

    <button
        onclick={upload}
        disabled={busy || !csv.trim()}
        class="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
        {busy ? "올리는 중..." : "등록"}
    </button>

    {#if result}
        <div class="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <p class="text-sm">
                새 계정 <strong>{result.created}</strong>개, 기존 계정 <strong>{result.linked}</strong>명을 넣었습니다.
            </p>

            {#if result.passwordCsv}
                <!--
                    임시 비밀번호는 여기서만 볼 수 있다. 눈에 띄게 두고, 받기 전에는
                    받았다는 표시를 안 한다
                -->
                <div
                    class="mt-3 rounded-md border px-4 py-3 {downloaded
                        ? 'border-zinc-200 dark:border-zinc-800'
                        : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'}"
                >
                    <p class="text-sm font-medium">
                        {downloaded ? "내려받았습니다" : "임시 비밀번호를 지금 받으세요"}
                    </p>
                    <p class="mt-1 text-xs text-zinc-500">
                        비밀번호는 해시로만 저장돼서 이 화면을 벗어나면 다시 볼 수 없습니다.
                        잃어버리면 계정마다 새로 정해 줘야 합니다.
                    </p>
                    <button
                        onclick={() => {
                            download("계정-비밀번호.csv", result!.passwordCsv!);
                            downloaded = true;
                        }}
                        class="mt-2 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        비밀번호 CSV 받기
                    </button>
                </div>
            {/if}

            {#if result.errors.length > 0}
                <div class="mt-3">
                    <p class="text-sm font-medium text-red-700 dark:text-red-400">
                        못 넣은 줄 {result.errors.length}개
                    </p>
                    <ul class="mt-1 max-h-40 overflow-auto text-xs text-zinc-500">
                        {#each result.errors as e (e.line + e.message)}
                            <li>{e.line}줄: {e.message}</li>
                        {/each}
                    </ul>
                    <p class="mt-1 text-xs text-zinc-400">
                        나머지는 다 들어갔습니다. 이 줄만 고쳐서 다시 올리세요.
                    </p>
                </div>
            {/if}
        </div>
    {/if}
</div>
