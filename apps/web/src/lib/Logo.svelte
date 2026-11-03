<script lang="ts">
    /**
     * 로고.
     *
     * 표시는 체크 하나다. 온라인 저지에서 제일 자주 보는 것이 "맞았습니다" 이고,
     * 16px 로 줄여도 알아볼 수 있는 몇 안 되는 모양이다. 글자를 넣으면 favicon 크기에서
     * 뭉개진다.
     *
     * 체크의 긴 획 끝을 살짝 세워 O 의 오른쪽 어깨처럼 보이게 두었다. 알아보라고 만든
     * 장치는 아니고, 그냥 밋밋한 체크보다 덜 흔해 보이려는 것이다.
     *
     * 색은 고정한다. currentColor 로 두면 머리글 글자색을 따라가서 로고가 회색이 된다.
     */
    let {
        size = 22,
        showText = true,
        showSub = true,
    }: {
        size?: number;
        /** 표시만 쓸 때 false */
        showText?: boolean;
        /** "오직" 을 같이 보일지. 좁은 화면에서는 끈다 */
        showSub?: boolean;
    } = $props();
</script>

<span class="flex items-center gap-2">
    <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        aria-hidden="true"
        class="shrink-0"
    >
        <rect width="32" height="32" rx="9" class="fill-blue-600 dark:fill-blue-500" />
        <path
            d="M9.5 16.8 L13.8 21.2 L22.8 10.6"
            fill="none"
            stroke="white"
            stroke-width="3.4"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
    </svg>

    {#if showText}
        <span class="flex items-baseline gap-1.5">
            <span class="text-lg leading-none font-bold tracking-tight">OJIK</span>
            {#if showSub}
                <span class="text-sm leading-none text-zinc-400">오직</span>
            {/if}
        </span>
    {/if}
</span>
