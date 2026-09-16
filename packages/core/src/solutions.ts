// 풀이 공유의 규칙. API 와 화면이 같은 값을 보게 여기 모은다.
//
// 읽기와 쓰기 모두 그 문제를 맞힌 사람에게만 연다. 안 푼 사람이 풀이를 보면
// 문제를 푸는 의미가 없고, 안 푼 사람이 글을 쓸 일도 없다.

export const SOLUTION_LIMITS = {
    /** 누구나 하루에 이만큼은 쓸 수 있다 */
    dailyBase: 3,
    /** 맞힌 문제 이 수마다 하루 한도가 1 늘어난다 */
    dailyPerSolved: 10,
    /** 아무리 많이 풀어도 하루 한도는 여기까지 */
    dailyMax: 20,
    /**
     * 링크를 쓰려면 이만큼은 맞혀야 한다. 가입 직후 계정으로 광고를 뿌리는 걸 막는 용도다.
     * 5 는 임의로 고른 값이고, 근거가 있는 수가 아니다. 광고가 실제로 들어오면 조정한다
     */
    linkMinSolved: 5,

    titleMax: 120,
    bodyMax: 20_000,
    commentMax: 2_000,
} as const;

/**
 * 하루에 쓸 수 있는 글 + 댓글 수.
 *
 * 글과 댓글을 따로 세지 않고 합쳐서 센다. 둘을 나누면 "댓글 칸이 남았는데 글은 못 쓴다"
 * 같은 설명을 화면에 해야 하고, 막으려는 건 어차피 한 사람이 하루에 쏟아내는 양이다.
 */
export function dailyWriteLimit(solvedCount: number): number {
    const earned = SOLUTION_LIMITS.dailyBase + Math.floor(solvedCount / SOLUTION_LIMITS.dailyPerSolved);
    return Math.min(SOLUTION_LIMITS.dailyMax, earned);
}

/**
 * 링크가 들어 있는지. 완벽한 판별이 아니라 광고 글을 걸러 내는 수준이다.
 *
 * 마크다운 링크, 벌거벗은 URL, www 로 시작하는 것을 본다. 우회는 당연히 가능하고
 * (점을 [.] 로 쓰는 식) 그것까지 막을 생각은 없다. 그건 사람이 지우면 된다.
 */
export function containsLink(text: string): boolean {
    return /\b(?:https?:\/\/|www\.)\S/i.test(text) || /\]\(\s*[a-z]+:/i.test(text);
}

/** 하루 경계를 한국 시간으로 본다. UTC 로 세면 오전 9시에 한도가 초기화돼 이상하다 */
export const SOLUTION_DAY_TIMEZONE = "Asia/Seoul";
