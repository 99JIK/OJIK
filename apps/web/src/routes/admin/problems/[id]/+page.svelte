<script lang="ts">
    import { page } from "$app/state";
    import ProblemEditor from "$lib/ProblemEditor.svelte";

    const id = $derived(Number(page.params.id));
</script>

<div class="mb-4 flex items-baseline justify-between">
    <h2 class="text-lg font-semibold">문제 {id}</h2>
    <a href="/admin/problems" class="text-sm text-zinc-500 hover:underline">목록으로</a>
</div>

{#key id}
    <ProblemEditor problemId={id} />
{/key}
