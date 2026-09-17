<script lang="ts">
    import Markdown from "$lib/Markdown.svelte";
    import { session } from "$lib/session.svelte";
    import { UPLOAD_MAX_BYTES } from "@ojik/core";
    import { extractSvgAt, replaceRange } from "$lib/svgblock";

    /**
     * 마크다운 입력칸.
     *
     * 보기 방식이 셋이다. 나란히가 기본이고, 좁은 화면에서는 위아래로 쌓인다.
     * 처음엔 탭만 뒀는데 수식과 도식은 쓰면서 바로 확인해야 해서 나란히를 기본으로 바꿨다.
     *
     * 미리보기는 타자가 멈춘 뒤에 그린다. 글자마다 파싱하면 mermaid 가 든 본문에서 버벅인다.
     * 쓰기 전용일 때는 마크다운 파서를 아예 안 받는다.
     *
     * 그림은 두 갈래다. 캡처 같은 건 붙여넣거나 끌어다 놓으면 올라가고, 도형은 그림판으로
     * 그려서 SVG 를 본문에 직접 넣는다. 그림판은 열 때 받는다.
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
        /** 그림 올리기와 그림판을 켤지. 권한이 없으면 켜도 안 보인다 */
        allowUpload?: boolean;
    } = $props();

    type Mode = "write" | "split" | "preview";
    let mode = $state<Mode>("split");
    let area = $state<HTMLTextAreaElement | null>(null);
    let fileInput = $state<HTMLInputElement | null>(null);
    let uploading = $state(0);
    let uploadError = $state<string | null>(null);
    let dragging = $state(false);

    /** 그림판. 열 때만 받는다 */
    let drawOpen = $state(false);
    let drawInitial = $state("");
    let drawRange = $state<[number, number] | null>(null);

    const over = $derived(maxLength !== undefined && value.length > maxLength);
    const canDraw = $derived(allowUpload && session.canTeach);

    /**
     * 미리보기에 넘길 원문.
     *
     * 타자가 멈춘 뒤 200ms 에 따라간다. 이 값이 없으면 글자마다 마크다운을 다시 파싱하고,
     * 수식이나 도식이 든 본문에서는 그게 바로 느껴진다.
     */
    let previewSrc = $state("");
    $effect(() => {
        const v = value;
        if (mode === "write") return;
        const t = setTimeout(() => (previewSrc = v), 200);
        return () => clearTimeout(t);
    });

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
        if (!canDraw) return;
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void upload(files);
        }
    }

    function onDrop(e: DragEvent) {
        dragging = false;
        if (!canDraw) return;
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void upload(files);
        }
    }

    /**
     * 그림판을 연다.
     *
     * 커서가 이미 그린 그림 안에 있으면 그걸 불러와 고친다. 아니면 새로 그린다.
     * 고친 뒤 통째로 다시 넣는 방식이라, 그림 하나를 조금 바꾸려고 지우고 다시 그릴 일이 없다.
     */
    function openDraw() {
        const pos = area?.selectionStart ?? value.length;
        const found = extractSvgAt(value, pos);
        drawInitial = found?.svg ?? "";
        drawRange = found ? [found.start, found.end] : null;
        drawOpen = true;
    }

    function onDrawSave(svg: string) {
        if (drawRange) {
            value = replaceRange(value, drawRange[0], drawRange[1], svg);
        } else {
            insertAtCursor(`\n\n${svg}\n\n`);
        }
        drawOpen = false;
    }
</script>

<div
    class="rounded-md border {dragging
        ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900'
        : 'border-zinc-300 dark:border-zinc-700'}"
>
    <div class="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-2 py-1 dark:border-zinc-800">
        {#each [["write", "쓰기"], ["split", "나란히"], ["preview", "미리보기"]] as [m, label] (m)}
            <button
                type="button"
                onclick={() => (mode = m as Mode)}
                class="rounded px-2 py-1 text-xs {mode === m
                    ? 'bg-zinc-200 font-medium dark:bg-zinc-700'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}"
            >
                {label}
            </button>
        {/each}

        {#if canDraw}
            <span class="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700"></span>
            <button
                type="button"
                onclick={openDraw}
                class="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
                그림판
            </button>
            <button
                type="button"
                onclick={() => fileInput?.click()}
                class="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
                그림 올리기
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

    <!--
        grid 자식에 min-w-0 을 준다.

        1fr 은 minmax(auto, 1fr) 이라 칸의 최소 너비가 내용의 min-content 다. 미리보기에
        긴 코드 줄이 하나라도 있으면 그 줄 너비만큼 칸이 벌어지고, 결국 페이지가 가로로
        넘친다. overflow-x-auto 를 걸어도 이 최소값은 안 줄어든다.
    -->
    <div class="grid {mode === 'split' ? 'md:grid-cols-2 md:divide-x' : ''} divide-zinc-200 dark:divide-zinc-800">
        {#if mode !== "preview"}
            <textarea
                bind:this={area}
                bind:value
                {rows}
                {placeholder}
                {disabled}
                onpaste={onPaste}
                ondrop={onDrop}
                ondragover={(e) => {
                    if (!canDraw) return;
                    e.preventDefault();
                    dragging = true;
                }}
                ondragleave={() => (dragging = false)}
                class="min-w-0 w-full resize-y bg-transparent p-3 font-mono text-sm outline-none disabled:opacity-50"
            ></textarea>
        {/if}

        {#if mode !== "write"}
            <div class="min-h-40 min-w-0 overflow-auto p-3">
                {#if previewSrc.trim()}
                    <Markdown source={previewSrc} />
                {:else}
                    <p class="text-sm text-zinc-400">쓴 내용이 없습니다.</p>
                {/if}
            </div>
        {/if}
    </div>
</div>

{#if uploadError}
    <p class="mt-1 text-xs text-red-600 dark:text-red-400">{uploadError}</p>
{/if}

<p class="mt-1 text-xs text-zinc-400">
    마크다운을 씁니다. 수식은 <code>$...$</code>, 순서도와 표는 <code>```mermaid</code> 블록.
    {#if canDraw}
        그림은 그림판으로 그리거나, 캡처를 붙여넣으세요.
    {/if}
</p>

{#if drawOpen}
    {#await import("$lib/SvgDraw.svelte")}
        <div class="fixed inset-0 z-50 grid place-items-center bg-black/40">
            <p class="rounded-md bg-white px-6 py-4 text-sm dark:bg-zinc-900">그림판을 불러오는 중...</p>
        </div>
    {:then m}
        {@const SvgDraw = m.default}
        <SvgDraw initial={drawInitial} onsave={onDrawSave} oncancel={() => (drawOpen = false)} />
    {:catch}
        <div class="fixed inset-0 z-50 grid place-items-center bg-black/40">
            <div class="rounded-md bg-white px-6 py-4 text-sm dark:bg-zinc-900">
                <p>그림판을 불러오지 못했습니다.</p>
                <button onclick={() => (drawOpen = false)} class="mt-2 text-blue-600 underline">닫기</button>
            </div>
        </div>
    {/await}
{/if}
