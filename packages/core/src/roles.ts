export const ROLES = ["admin", "staff", "instructor", "user"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
    admin: "관리자",
    staff: "출제자",
    instructor: "강사",
    user: "사용자",
};

/**
 * 서열.
 *
 * 강사는 강의(컬렉션)를 열 수 있고, 출제자는 거기에 더해 공개 아카이브에 문제를 낸다.
 * 둘을 직교한 두 축으로 두는 것도 생각했지만, 실제로 출제자에게 강의를 막을 이유가 없어서
 * 서열 하나로 둔다. 권한 판정이 한 줄로 끝난다.
 */
const RANK: Record<Role, number> = { user: 0, instructor: 1, staff: 2, admin: 3 };

/** 권한은 서열로만 본다. 역할이 늘면 RANK 만 고치면 됨 */
export function atLeast(role: Role, required: Role): boolean {
    return RANK[role] >= RANK[required];
}
