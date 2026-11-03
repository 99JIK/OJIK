<script lang="ts">
    import { page } from "$app/state";
    import { get, ApiError } from "$lib/api";
    import { session } from "$lib/session.svelte";
    import { verdictClass, verdictText, formatDate } from "$lib/format";
    import { ROLE_LABEL, VERDICT_LABEL, getLanguage, type Role, type Verdict } from "@ojik/core";
    import type { SubmissionRow } from "$lib/types";

    /**
     * 사용자 프로필.
     *
     * 집계는 서버가 한다. 전에는 최근 제출 50건을 받아 화면에서 세고 있어서, 많이 푼
     * 사람일수록 숫자가 틀렸다.
     *
     * 로그인했으면 보는 사람과의 차이를 같이 보여 준다. 남이 풀었는데 내가 안 푼 문제가
     * 제일 쓸모 있어서 그걸 앞에 둔다.
     */

    interface Profile {
        user: {
            handle: string;
            displayName: string | null;
            role: Role;
            createdAt: string;
            solvedCount: number;
            submissionCount: number;
        };
        solved: number[];
        byLanguage: Array<{ language: string; n: number; accepted: number }>;
        byVerdict: Array<{ verdict: Verdict; n: number }>;
        activity: Array<{ day: string; n: number }>;
        rank: number | null;
        totalUsers: number | null;
        isMe: boolean;
        compare: {
            viewerSolved: number;
            common: number;
            onlyThem: number;
            onlyMe: number;
            onlyThemSample: number[];
        } | null;
    }

    const handle = $derived(page.params.handle ?? "");

    let data = $state<Profile | null>(null);
    let recent = $state<SubmissionRow[]>([]);
    let error = $state<string | null>(null);

    $effect(() => {
        const h = handle;
        // 로그인 상태가 정해진 뒤에 받는다. 비교 정보가 로그인 여부에 달려 있어서,
        // 먼저 받으면 로그인했는데도 비교가 빈 채로 남는다
        if (!session.ready) return;
        void (async () => {
            try {
                data = await get<Profile>(`/users/${encodeURIComponent(h)}`);
                error = null;
            } catch (e) {
                data = null;
                error = e instanceof ApiError && e.status === 404 ? "없는 사용자입니다" : String(e);
                return;
            }
            const r = await get<{ submissions: SubmissionRow[] }>("/submissions", {
                handle: h,
                limit: 20,
            }).catch(() => ({ submissions: [] }));
            recent = r.submissions;
        })();
    });

    const totalJudged = $derived(data ? data.byVerdict.reduce((a, b) => a + b.n, 0) : 0);
    const acceptedCount = $derived(data?.byVerdict.find((v) => v.verdict === "accepted")?.n ?? 0);
    const accuracy = $derived(totalJudged > 0 ? Math.round((acceptedCount / totalJudged) * 100) : null);
    const maxDay = $derived(data ? Math.max(1, ...data.activity.map((a) => a.n)) : 1);

    /**
     * 최근 26주를 날짜 칸으로 편다. 제출이 없는 날도 자리를 차지해야 흐름이 보인다.
     *
     * 첫 칸을 일요일에 맞춘다. 안 그러면 주 경계가 세로줄과 안 맞아서 "이번 주" 를
     * 눈으로 못 읽는다.
     */
    /** YYYY-MM-DD. toISOString 을 쓰면 UTC 라 9시간이 어긋난다 */
    function keyOf(d: Date): string {
        const p2 = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    }

    const days = $derived.by(() => {
        if (!data) return [];
        const byDay = new Map(data.activity.map((a) => [a.day, a.n]));
        const out: Array<{ day: string; n: number; future: boolean }> = [];
        const today = new Date();
        const todayKey = keyOf(today);

        /*
         * 마지막 칸을 이번 주 토요일로 맞춘다.
         *
         * 26주는 182일이고 182 는 7 의 배수라, 끝이 토요일이면 시작은 정확히 일요일이 된다.
         * 열이 곧 한 주가 되어야 "이번 주에 얼마나 했나" 를 눈으로 읽을 수 있다.
         */
        const end = today.getTime() + (6 - today.getDay()) * 86400000;
        for (let i = 181; i >= 0; i--) {
            const d = new Date(end - i * 86400000);
            const key = keyOf(d);
            out.push({ day: key, n: byDay.get(key) ?? 0, future: key > todayKey });
        }
        return out;
    });

    function langLabel(id: string): string {
        return getLanguage(id)?.label ?? id;
    }
</script>

{#if error}
    <p class="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
    </p>
{:else if !data}
    <p class="mt-8 text-sm text-zinc-500">불러오는 중...</p>
{:else}
    {@const u = data.user}
    <div class="flex flex-wrap items-baseline justify-between gap-2">
        <div>
            <h1 class="text-2xl font-bold">
                {u.handle}
                {#if data.isMe}
                    <span class="ml-1 align-middle text-xs font-normal text-zinc-400">나</span>
                {/if}
            </h1>
            <p class="mt-1 text-sm text-zinc-500">
                {#if u.displayName}{u.displayName} · {/if}{ROLE_LABEL[u.role]} · 가입 {formatDate(u.createdAt)}
            </p>
        </div>
        {#if data.rank && data.totalUsers}
            <div class="text-right">
                <div class="text-xl font-bold tabular-nums">{data.rank}위</div>
                <div class="text-xs text-zinc-400">{data.totalUsers}명 중</div>
            </div>
        {/if}
    </div>

    <!-- 셋뿐이라 화면 폭을 다 쓰면 칸마다 빈 곳이 넓다. 왼쪽으로 몰고 폭을 제한한다 -->
    <dl class="mt-5 grid max-w-xl grid-cols-3 gap-3">
        {#each [["맞힌 문제", `${u.solvedCount}`], ["제출", `${u.submissionCount}`], ["정답률", accuracy === null ? "-" : `${accuracy}%`]] as [k, v] (k)}
            <div class="ojik-card px-4 py-3">
                <dt class="text-xs text-zinc-500">{k}</dt>
                <dd class="mt-1 text-xl font-bold tabular-nums">{v}</dd>
            </div>
        {/each}
    </dl>

    {#if data.compare}
        {@const cp = data.compare}
        <section class="mt-6 rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
            <h2 class="text-sm font-semibold">나와 비교</h2>
            <div class="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
                <div>
                    <div class="text-lg font-semibold tabular-nums">{cp.onlyMe}</div>
                    <div class="text-xs text-zinc-500">나만 푼 문제</div>
                </div>
                <div>
                    <div class="text-lg font-semibold tabular-nums">{cp.common}</div>
                    <div class="text-xs text-zinc-500">둘 다 푼 문제</div>
                </div>
                <div>
                    <div class="text-lg font-semibold tabular-nums">{cp.onlyThem}</div>
                    <div class="text-xs text-zinc-500">{u.handle}만 푼 문제</div>
                </div>
            </div>

            <p class="mt-3 text-xs text-zinc-500">
                내가 맞힌 문제 {cp.viewerSolved}개, {u.handle} 이(가) 맞힌 문제 {u.solvedCount}개.
            </p>

            {#if cp.onlyThemSample.length > 0}
                <h3 class="mt-4 mb-1 text-xs font-medium">{u.handle}은(는) 풀었고 나는 아직인 문제</h3>
                <div class="flex flex-wrap gap-1">
                    {#each cp.onlyThemSample as pid (pid)}
                        <a
                            href="/problem/{pid}"
                            class="rounded bg-white px-2 py-1 text-xs tabular-nums hover:underline dark:bg-zinc-900"
                            >{pid}</a
                        >
                    {/each}
                    {#if cp.onlyThem > cp.onlyThemSample.length}
                        <span class="px-2 py-1 text-xs text-zinc-400">
                            외 {cp.onlyThem - cp.onlyThemSample.length}개
                        </span>
                    {/if}
                </div>
            {/if}
        </section>
    {:else if !session.user}
        <p class="mt-6 rounded-md bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:bg-zinc-900">
            <a href="/login" class="text-blue-600 hover:underline dark:text-blue-400">로그인</a>하면 나와
            비교해서 볼 수 있습니다.
        </p>
    {/if}

    <!--
        활동 요약.

        격자, 언어, 판정을 한 카드에 둔다. 셋 다 "이 사람이 어떻게 풀어 왔나" 하나를
        말하는 것이라, 카드를 셋으로 나누면 화면만 길어지고 같은 것을 세 번 보게 된다.

        막대는 항목이 둘 이상일 때만 그린다. 하나뿐이면 언제나 꽉 찬 막대가 나오는데
        그건 비교가 아니라 장식이다. 제출 한 건짜리 프로필에서 회색 막대가 화면을
        가로지르고 있었다.
    -->
    {#if data.activity.length > 0 || data.byLanguage.length > 0 || data.byVerdict.length > 0}
        <!--
            격자와 통계를 좌우로 둔다.

            위아래로 쌓았더니 격자 오른쪽이 통째로 비었다. 격자는 26주라 폭이 정해져 있고
            통계는 줄 몇 개뿐이라, 둘을 나란히 놓아야 카드가 안 빈다.
        -->
        <section class="ojik-card mt-6 flex flex-col gap-6 p-5 lg:flex-row">
            {#if data.activity.length > 0}
                <div class="min-w-0 shrink-0">
                    <div class="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <h2 class="text-sm font-semibold">최근 26주</h2>
                        <span class="flex items-center gap-1 text-xs text-zinc-400">
                            적음
                            <span class="inline-block h-2.5 w-2.5 rounded-[3px] bg-zinc-100 dark:bg-zinc-800"></span>
                            <span class="inline-block h-2.5 w-2.5 rounded-[3px] bg-green-500 opacity-40"></span>
                            <span class="inline-block h-2.5 w-2.5 rounded-[3px] bg-green-500 opacity-70"></span>
                            <span class="inline-block h-2.5 w-2.5 rounded-[3px] bg-green-500"></span>
                            많음
                        </span>
                    </div>

                    <div class="overflow-x-auto pb-1">
                        <div class="grid w-max grid-flow-col grid-rows-7 gap-[3px]">
                            {#each days as d (d.day)}
                                <div
                                    class="h-3.5 w-3.5 rounded-[3px] {d.future
                                        ? 'bg-transparent'
                                        : d.n === 0
                                          ? 'bg-zinc-100 dark:bg-zinc-800'
                                          : 'bg-green-500'}"
                                    style={d.n === 0 ? "" : `opacity: ${0.35 + 0.65 * (d.n / maxDay)}`}
                                    title={d.future ? "" : `${d.day} 제출 ${d.n}건`}
                                ></div>
                            {/each}
                        </div>
                    </div>
                </div>
            {/if}

            {#if data.byLanguage.length > 0 || data.byVerdict.length > 0}
                <div
                    class="grid min-w-0 flex-1 gap-x-8 gap-y-5 sm:grid-cols-2 {data.activity.length > 0
                        ? 'border-t border-zinc-100 pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8 dark:border-zinc-800'
                        : ''}"
                >
                    {#if data.byLanguage.length > 0}
                        {@const topLang = data.byLanguage[0]!.n}
                        <div>
                            <h3 class="mb-2 text-xs font-semibold text-zinc-500">언어</h3>
                            <ul class="space-y-2 text-sm">
                                {#each data.byLanguage as l (l.language)}
                                    <li class="flex items-baseline gap-2">
                                        <span class="min-w-0 flex-1 truncate">{langLabel(l.language)}</span>
                                        {#if data.byLanguage.length > 1}
                                            <div class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                                <div
                                                    class="h-full rounded-full bg-blue-500"
                                                    style="width: {Math.round((l.n / topLang) * 100)}%"
                                                ></div>
                                            </div>
                                        {/if}
                                        <span class="shrink-0 text-xs tabular-nums text-zinc-500">
                                            {l.accepted}/{l.n}
                                        </span>
                                    </li>
                                {/each}
                            </ul>
                            <p class="mt-2 text-xs text-zinc-400">맞힌 제출 / 전체 제출</p>
                        </div>
                    {/if}

                    {#if data.byVerdict.length > 0}
                        <div>
                            <h3 class="mb-2 text-xs font-semibold text-zinc-500">판정</h3>
                            <ul class="space-y-2 text-sm">
                                {#each data.byVerdict as v (v.verdict)}
                                    <li class="flex items-baseline gap-2">
                                        <span class="min-w-0 flex-1 truncate {verdictClass(v.verdict, 'done')}">
                                            {VERDICT_LABEL[v.verdict]}
                                        </span>
                                        {#if data.byVerdict.length > 1}
                                            <div class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                                <div
                                                    class="h-full rounded-full bg-zinc-400"
                                                    style="width: {Math.round((v.n / data.byVerdict[0].n) * 100)}%"
                                                ></div>
                                            </div>
                                        {/if}
                                        <span class="shrink-0 text-xs tabular-nums text-zinc-500">{v.n}</span>
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}
                </div>
            {/if}
        </section>
    {/if}

    <!--
        맞힌 문제와 최근 제출을 좌우로.

        둘 다 짧아서 위아래로 쌓으면 오른쪽이 통째로 빈다. 맞힌 문제가 많아지면
        번호가 줄바꿈되며 세로로 자라므로 그때는 알아서 균형이 맞는다.
    -->
    <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
    <section class="ojik-card p-4">
        <h2 class="mb-3 text-sm font-semibold">맞힌 문제 {data.solved.length}</h2>
        {#if data.solved.length === 0}
            <p class="text-sm text-zinc-400">없습니다</p>
        {:else}
            <div class="flex flex-wrap gap-1">
                {#each data.solved as pid (pid)}
                    <a
                        href="/problem/{pid}"
                        class="rounded bg-green-100 px-2 py-1 text-xs tabular-nums text-green-800 hover:underline dark:bg-green-950 dark:text-green-300"
                        >{pid}</a
                    >
                {/each}
            </div>
        {/if}
    </section>

    <section class="ojik-card p-4">
        <div class="mb-1 flex items-baseline justify-between">
            <h2 class="text-sm font-semibold">최근 제출</h2>
            <a
                href="/submissions?handle={u.handle}"
                class="text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
                전체 보기
            </a>
        </div>
        <div class="overflow-x-auto">
            <table class="ojik-table w-full text-sm">
                <tbody>
                    {#each recent as r (r.id)}
                        <tr class="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                            <td class="nowrap w-16 tabular-nums text-zinc-500">
                                <a href="/submission/{r.id}" class="hover:underline">{r.id}</a>
                            </td>
                            <td class="clip">
                                <a href="/problem/{r.problemId}" class="hover:underline" title={r.problemTitle}>
                                    {r.problemTitle}
                                </a>
                            </td>
                            <td class="nowrap w-32 {verdictClass(r.verdict, r.status)}">
                                {verdictText(r.verdict, r.status, r.judgedCount, r.totalCount)}
                            </td>
                            <td class="nowrap w-36 text-right text-zinc-500">{formatDate(r.createdAt)}</td>
                        </tr>
                    {:else}
                        <tr><td colspan="4" class="py-8 text-center text-zinc-400">제출이 없습니다</td></tr>
                    {/each}
                </tbody>
            </table>
        </div>
    </section>
    </div>
{/if}
