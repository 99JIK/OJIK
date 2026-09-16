export const ROLES = ["admin", "staff", "user"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
    admin: "관리자",
    staff: "출제자",
    user: "사용자",
};

const RANK: Record<Role, number> = { user: 0, staff: 1, admin: 2 };

/** 권한은 서열로만 본다. 역할이 늘면 RANK 만 고치면 됨 */
export function atLeast(role: Role, required: Role): boolean {
    return RANK[role] >= RANK[required];
}
