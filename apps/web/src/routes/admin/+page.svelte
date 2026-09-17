<script lang="ts">
    import { goto } from "$app/navigation";
    import { session } from "$lib/session.svelte";

    /**
     * 관리 메뉴의 첫 화면.
     *
     * 출제자는 문제가 없으면 나머지가 빈 껍데기라 문제 목록으로 보낸다.
     * 강사는 문제 관리 화면에 볼 것이 없다. 공개 아카이브는 출제자 몫이고
     * 강의 전용 문제는 강의 화면 안에서 다룬다. 그래서 강의 목록으로 보낸다.
     */
    $effect(() => {
        if (!session.ready) return;
        if (!session.canTeach) {
            void goto("/", { replaceState: true });
            return;
        }
        void goto(session.isStaff ? "/admin/problems" : "/admin/collections", { replaceState: true });
    });
</script>

<p class="text-sm text-zinc-500">이동 중...</p>
