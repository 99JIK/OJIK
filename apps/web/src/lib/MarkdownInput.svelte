<script lang="ts">
    import Markdown from "$lib/Markdown.svelte";
    import { session } from "$lib/session.svelte";
    import { UPLOAD_MAX_BYTES } from "@ojik/core";

    /**
     * 마크다운 입력칸. 쓰기와 미리보기를 탭으로 오간다.
     *
     * 두 칸을 나란히 두는 방식은 안 쓴다. 좁은 화면에서 양쪽 다 못 읽을 폭이 되고,
     * 미리보기는 다 쓰고 한 번 보는 게 보통이다.
     *
     * 미리보기는 탭을 누른 뒤에만 그린다. 안 누르면 마크다운 파서도 안 받는다.
     *
     * 그림은 붙여넣거나 끌어다 놓으면 올라간다. 파일 고르기 버튼도 두지만 그건 마지막
     * 수단이고, 문제 본문에 넣는 그림은 대개 캡처라 붙여넣기가 제일 빠르다.
     */
    let {
        value = $bindable(""),
        placeholder = "",
        rows = 12,
        maxLength,
        disabled = false,
        allowUpload = false,
    }: {
        value?: string;
        placeholder?: string;
        rows?: number;
        maxLength?: number;
        disabled?: boolean;
        /** 그림 올리기를 켤지. 권한이 없으면 켜도 안 보인다 */
        allowUpload?: boolean;
    } = $props();

    let tab = $state<"write" | "preview">("write");
    let area = $state<HTMLTextAreaElement | null>(null);
    let fileInput = $state<HTMLInputElement | null>(null);
    let uploading = $state(0);
    let uploadError = $state<string | null>(null);
    let dragging = $state(false);

    const over = $derived(maxLength !== undefined && value.length > maxLength);
    const canUpload = $derived(allowUpload && session.canTeach);

    /** 커서 자리에 끼워 넣는다. 끝에 붙이면 쓰던 자리를 잃는다 */
    function insertAtCursor(text: string) {
        const el = area;
        if (!el) {
            value += text;
            return;
        }
        const start = el.selectionStart;
        const end = el.selectionEnd;
        value = value.slice(0, start) + text + value.slice(end);
        // 값이 반영된 뒤에 커서를 옮긴다
        queueMicrotask(() => {
            el.focus();
            el.selectionStart = el.selectionEnd = start + text.length;
        });
    }

    async function upload(files: File[]) {
        const images = files.filter((f) => f.type.startsWith("image/"));
        if (images.length === 0) return;

        uploadError = null;
        for (const f of images) {
            if (f.size > UPLOAD_MAX_BYTES) {
                uploadError = `${f.name || "그림"} 이(가) 너무 큽니다 (${Math.round(f.size / 1024)}KB). 최대 ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB.`;
                continue;
            }
            uploading++;
            // 올리는 동안 자리를 잡아 둔다. 여러 장이면 어느 것이 어디 들어갈지 헷갈린다
            const token = `![올리는 중...](uploading-${Date.now()}-${uploading})`;
            insertAtCursor(token);
            try {
                const form = new FormData();
                form.append("file", f);
                const r = await fetch("/api/uploads", { method: "POST", body: form });
                const body = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(body.error ?? `올리기 실패 (${r.status})`);
                value = value.replace(token, `![](${body.url})`);
            } catch (e) {
                value = value.replace(token, "");
                uploadError = e instanceof Error ? e.message : String(e);
            } finally {
                uploading--;
            }
        }
    }

    function onPaste(e: ClipboardEvent) {
        if (!canUpload) return;
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void upload(files);
        }
    }

    function onDrop(e: DragEvent) {
        dragging = false;
        if (!canUpload) return;
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void upload(files);
        }
    }
</script>

<div
    class="rounded-md border {dragging
        ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900'
        : 'border-zinc-300 dark:border-zinc-700'}"
>
    <div class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1 dark:border-zinc-800">
        <button
            type="button"
            onclick={() => (tab = "write")}
            class="rounded px-2 py-1 text-xs {tab === 'write'
                ? 'bg-zinc-200 font-medium dark:bg-zinc-700'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}"
        >
            쓰기
        </button>
        <button
            type="button"
            onclick={() => (tab = "preview")}
            class="rounded px-2 py-1 text-xs {tab === 'preview'
                ? 'bg-zinc-200 font-medium dark:bg-zinc-700'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}"
        >
            미리보기
        </button>

        {#if canUpload}
            <button
                type="button"
                onclick={() => fileInput?.click()}
                class="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
                그림
            </button>
            <input
                bind:this={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                class="hidden"
                onchange={(e) => {
                    void upload(Array.from(e.currentTarget.files ?? []));
                    e.currentTarget.value = "";
                }}
            />
        {/if}

        <span class="ml-auto text-xs {over ? 'text-red-600 dark:text-red-400' : 'text-zinc-400'}">
            {#if uploading > 0}
                올리는 중 {uploading}
            {:else if maxLength !== undefined}
                {value.length} / {maxLength}
            {/if}
        </span>
    </div>

    {#if tab === "write"}
        <textarea
            bind:this={area}
            bind:value
            {rows}
            {placeholder}
            {disabled}
            onpaste={onPaste}
            ondrop={onDrop}
            ondragover={(e) => {
                if (!canUpload) return;
                e.preventDefault();
                dragging = true;
            }}
            ondragleave={() => (dragging = false)}
            class="w-full resize-y rounded-b-md bg-transparent p-3 font-mono text-sm outline-none disabled:opacity-50"
        ></textarea>
    {:else}
        <div class="min-h-40 p-3">
            {#if value.trim()}
                <Markdown source={value} />
            {:else}
                <p class="text-sm text-zinc-400">쓴 내용이 없습니다.</p>
            {/if}
        </div>
    {/if}
</div>

{#if uploadError}
    <p class="mt-1 text-xs text-red-600 dark:text-red-400">{uploadError}</p>
{/if}

<p class="mt-1 text-xs text-zinc-400">
    마크다운을 씁니다. 수식은 <code>$...$</code>, 도식과 그래프는 <code>```mermaid</code> 블록.
    {#if canUpload}
        그림은 붙여넣거나 끌어다 놓으세요.
    {/if}
</p>
