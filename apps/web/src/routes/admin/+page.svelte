<script lang="ts">
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";

    // 관리 메뉴의 첫 화면. 문제가 없으면 나머지가 다 빈 껍데기라 여기로 보낸다
    onMount(() => {
        void goto("/admin/problems", { replaceState: true });
    });
</script>

<p class="text-sm text-zinc-500">이동 중...</p>
