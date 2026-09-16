// 컬렉션(교재, 문제집, 대회, 코딩테스트)이 쓰는 어휘.
//
// 넷은 별개의 타입이 아니라 아래 축들의 값 조합이다. 축을 분리해 두면 화면과 API 를
// 한 벌만 만들면 되고, 새 형태가 필요할 때 조합만 바꾸면 된다.

export const VISIBILITIES = ["public", "unlisted", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const VISIBILITY_LABEL: Record<Visibility, string> = {
    public: "공개",
    unlisted: "링크 공개",
    private: "비공개",
};

/** 만든 의도. 동작을 정하지 않고 표시와 기본값에만 쓴다 */
export const COLLECTION_PRESETS = ["course", "problemset", "contest", "exam"] as const;
export type CollectionPreset = (typeof COLLECTION_PRESETS)[number];

export const PRESET_LABEL: Record<CollectionPreset, string> = {
    course: "교재",
    problemset: "문제집",
    contest: "대회",
    exam: "코딩 테스트",
};

/**
 * 만들 때 고르는 화면에 붙일 한 줄 설명.
 *
 * 넷의 차이는 축 값 조합인데, 축 이름(timing, reveal, joinPolicy)을 그대로 보여 주면
 * 처음 쓰는 사람은 뭘 고를지 모른다. 무엇에 쓰는 물건인지로 적는다.
 */
export const PRESET_DESCRIPTION: Record<CollectionPreset, string> = {
    course: "설명과 문제를 섞어 순서대로 읽습니다. 수업 자료와 연습 문제에 씁니다.",
    problemset: "문제만 모읍니다. 누가 어디까지 풀었는지 진도로 봅니다.",
    contest: "정해진 시각에 다 같이 시작합니다. 순위표가 붙고 끝나기 전에는 얼립니다.",
    exam: "각자 시작을 누른 시점부터 시간이 흐릅니다. 결과는 끝난 뒤에 공개합니다.",
};

/**
 * 제목에서 주소를 만든다.
 *
 * 영문과 숫자만 남긴다. 한글 제목이면 남는 게 없는데, 그때는 부르는 쪽이 대체값을 준다.
 * 한글을 로마자로 바꾸는 건 규칙이 지저분하고 결과도 예쁘지 않아서 안 한다.
 */
export function slugify(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}

/** 축 1: 시간 창 */
export const TIMINGS = ["none", "fixed", "per_user"] as const;
export type Timing = (typeof TIMINGS)[number];

export const TIMING_LABEL: Record<Timing, string> = {
    none: "상시",
    fixed: "정해진 시각",
    per_user: "각자 시작",
};

/** 축 2: 결과 공개 */
export const REVEALS = ["immediate", "frozen", "after_end"] as const;
export type Reveal = (typeof REVEALS)[number];

export const REVEAL_LABEL: Record<Reveal, string> = {
    immediate: "즉시 공개",
    frozen: "종료 전 동결",
    after_end: "종료 후 공개",
};

/** 축 3: 순위 */
export const SCORINGS = ["none", "progress", "icpc", "ioi"] as const;
export type Scoring = (typeof SCORINGS)[number];

export const SCORING_LABEL: Record<Scoring, string> = {
    none: "순위 없음",
    progress: "진도",
    icpc: "ICPC (푼 수 + 페널티)",
    ioi: "IOI (부분점수 합)",
};

/** 축 4: 참가 */
export const JOIN_POLICIES = ["open", "members", "register", "invite"] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

export const JOIN_POLICY_LABEL: Record<JoinPolicy, string> = {
    open: "누구나",
    members: "멤버만",
    register: "등록한 사람",
    invite: "초대받은 사람",
};

/** 축 5: 항목 종류. text 를 섞을 수 있다는 것이 교재를 가능하게 한다 */
export const ITEM_KINDS = ["problem", "text"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const MEMBER_ROLES = ["member", "manager"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** ICPC 오답 1회당 붙는 페널티 분. 관례값이지 표준이 아니다 */
export const DEFAULT_PENALTY_MINUTES = 20;

/** 축들의 묶음. 프리셋이 채워 주는 값이다 */
export interface CollectionAxes {
    timing: Timing;
    reveal: Reveal;
    scoring: Scoring;
    joinPolicy: JoinPolicy;
    visibility: Visibility;
}

/**
 * 프리셋별 기본 축 값.
 *
 * 화면은 "대회 만들기" 버튼만 보여주고 이 값을 채운다. 사용자는 축의 존재를 몰라도 된다.
 * 축을 직접 만지는 건 고급 설정으로 접어 둔다.
 */
export const PRESET_DEFAULTS: Record<CollectionPreset, CollectionAxes> = {
    course: {
        timing: "none",
        reveal: "immediate",
        scoring: "none",
        joinPolicy: "open",
        visibility: "public",
    },
    problemset: {
        timing: "none",
        reveal: "immediate",
        scoring: "progress",
        joinPolicy: "open",
        visibility: "public",
    },
    contest: {
        timing: "fixed",
        reveal: "frozen",
        scoring: "icpc",
        joinPolicy: "register",
        visibility: "public",
    },
    exam: {
        timing: "per_user",
        reveal: "after_end",
        scoring: "none",
        joinPolicy: "invite",
        visibility: "private",
    },
};

/**
 * 축 조합이 말이 되는지 본다. 스키마로는 못 막으므로 API 가 검사한다.
 * 문제가 있으면 사람이 읽을 문장으로 돌려준다.
 */
export function validateAxes(
    a: CollectionAxes & { startsAt?: Date | null; endsAt?: Date | null; durationMinutes?: number | null },
): string[] {
    const problems: string[] = [];

    if (a.timing === "fixed") {
        if (!a.startsAt || !a.endsAt) problems.push("정해진 시각이면 시작과 종료가 있어야 합니다");
        else if (a.endsAt <= a.startsAt) problems.push("종료가 시작보다 뒤여야 합니다");
    }
    if (a.timing === "per_user" && !a.durationMinutes) {
        problems.push("각자 시작이면 제한 시간(분)이 있어야 합니다");
    }
    if (a.timing === "none") {
        if (a.reveal === "after_end") problems.push("끝나는 시각이 없으면 종료 후 공개를 쓸 수 없습니다");
        if (a.reveal === "frozen") problems.push("끝나는 시각이 없으면 동결을 쓸 수 없습니다");
    }
    // 동결은 스코어보드를 가리는 것이라 순위가 없으면 의미가 없다
    if (a.reveal === "frozen" && a.scoring === "none") {
        problems.push("순위가 없으면 동결할 스코어보드가 없습니다");
    }
    if (a.joinPolicy === "open" && a.visibility === "private") {
        problems.push("비공개인데 누구나 참가는 앞뒤가 안 맞습니다");
    }
    return problems;
}

/** 지금 이 컬렉션이 진행 중인지. per_user 는 사람마다 다르므로 멤버 행을 같이 본다 */
export function isRunning(
    c: { timing: Timing; startsAt: Date | null; endsAt: Date | null },
    member?: { startedAt: Date | null; endsAt: Date | null } | null,
    now: Date = new Date(),
): boolean {
    switch (c.timing) {
        case "none":
            return true;
        case "fixed":
            return !!c.startsAt && !!c.endsAt && now >= c.startsAt && now <= c.endsAt;
        case "per_user":
            return !!member?.startedAt && !!member.endsAt && now >= member.startedAt && now <= member.endsAt;
    }
}

/** 끝났는지. 결과 공개 판정에 쓴다 */
export function hasEnded(
    c: { timing: Timing; endsAt: Date | null },
    member?: { endsAt: Date | null } | null,
    now: Date = new Date(),
): boolean {
    switch (c.timing) {
        case "none":
            return false;
        case "fixed":
            return !!c.endsAt && now > c.endsAt;
        case "per_user":
            return !!member?.endsAt && now > member.endsAt;
    }
}

/**
 * 제출의 판정을 지금 보여줘도 되는지.
 *
 * 코딩 테스트는 본인 제출이라도 끝나기 전에는 결과를 감춘다. 채점은 정상으로 돌고
 * "채점됨"까지만 보인다. 이게 exam 프리셋의 핵심이다.
 */
export function canRevealVerdict(
    c: { reveal: Reveal; timing: Timing; endsAt: Date | null },
    member?: { endsAt: Date | null } | null,
    now: Date = new Date(),
): boolean {
    if (c.reveal !== "after_end") return true;
    return hasEnded(c, member, now);
}
