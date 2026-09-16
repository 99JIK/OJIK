// 동의 항목. 문구 버전은 바뀔 수 있으므로 상수로 둔다.

export const CONSENT_KINDS = ["research"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const CONSENT_LABEL: Record<ConsentKind, string> = {
    research: "연구 목적 이용",
};

/**
 * 지금 받고 있는 동의 문구의 버전.
 *
 * 문구를 고치면 이 값을 올린다. 그래야 "누가 어떤 문구에 동의했는지"를 가릴 수 있고,
 * 옛 버전에만 동의한 사용자를 골라 다시 물을 수 있다.
 */
export const CONSENT_VERSION: Record<ConsentKind, string> = {
    research: "2026-09-16",
};
