import { and, eq, asc } from "drizzle-orm";
import { atLeast, isRunning, hasEnded, canRevealVerdict } from "@ojik/core";
import {
    collections,
    collectionItems,
    collectionMembers,
    type Collection,
    type CollectionMember,
    type Problem,
    type User,
} from "@ojik/db";
import { db } from "./db";

/**
 * 접근 판정을 한 곳에 모은다.
 * 화면에서 버튼을 숨기는 건 안내일 뿐이고, 실제 차단은 전부 여기를 거친다.
 */

export interface ProblemAccess {
    canView: boolean;
    canSubmit: boolean;
    /** 시간 제한이 있는 컬렉션 안에서의 접근이면 그 컬렉션. 제출 행에 박힌다 */
    collection: Collection | null;
    member: CollectionMember | null;
}

/**
 * 지금 이 사용자가 볼 수 있는 시간 제한 컬렉션 중 이 문제를 담고 있는 것을 찾는다.
 *
 * timing 이 none 이 아닌 것만 본다. 상시 문제집은 문제를 묶는 수단이지 감춘 문제를 여는
 * 수단이 아니다. 대회와 코딩테스트만 그 권한을 갖는다.
 */
async function activeGate(
    user: User,
    problemId: number,
): Promise<{ collection: Collection; member: CollectionMember } | null> {
    const rows = await db
        .select({ c: collections, m: collectionMembers })
        .from(collectionItems)
        .innerJoin(collections, eq(collections.id, collectionItems.collectionId))
        .innerJoin(
            collectionMembers,
            and(
                eq(collectionMembers.collectionId, collections.id),
                eq(collectionMembers.userId, user.id),
            ),
        )
        .where(eq(collectionItems.problemId, problemId))
        .orderBy(asc(collections.id));

    // 여러 곳에 걸쳐 있으면 지금 진행 중인 것을 고른다
    for (const r of rows) {
        if (r.c.timing !== "none" && isRunning(r.c, r.m)) return { collection: r.c, member: r.m };
    }
    return null;
}

export async function problemAccess(user: User | null, problem: Problem): Promise<ProblemAccess> {
    const none = { collection: null, member: null };

    if (user && atLeast(user.role, "staff")) {
        return { canView: true, canSubmit: true, ...none };
    }

    const publiclyOpen =
        problem.isPublic && (problem.publicFrom === null || problem.publicFrom <= new Date());

    if (!user) {
        return { canView: publiclyOpen, canSubmit: false, ...none };
    }

    // 진행 중인 대회나 코딩테스트에 걸린 문제는 공개 전이라도 보이고 제출도 된다
    const gate = await activeGate(user, problem.id);
    if (gate) {
        return { canView: true, canSubmit: true, collection: gate.collection, member: gate.member };
    }

    return { canView: publiclyOpen, canSubmit: publiclyOpen, ...none };
}

/**
 * 컬렉션 자체를 볼 수 있는지.
 * private 은 멤버이거나 staff 여야 한다. unlisted 는 주소를 알면 보인다.
 */
export async function collectionAccess(
    user: User | null,
    c: Collection,
): Promise<{ canView: boolean; canManage: boolean; member: CollectionMember | null }> {
    const isStaff = !!user && atLeast(user.role, "staff");

    let member: CollectionMember | null = null;
    if (user) {
        const [m] = await db
            .select()
            .from(collectionMembers)
            .where(and(eq(collectionMembers.collectionId, c.id), eq(collectionMembers.userId, user.id)));
        member = m ?? null;
    }

    const canManage = isStaff || member?.role === "manager";
    if (canManage) return { canView: true, canManage, member };

    if (c.visibility === "private") return { canView: !!member, canManage: false, member };
    return { canView: true, canManage: false, member };
}

/**
 * 컬렉션의 문제 목록을 지금 보여줘도 되는지.
 *
 * 시작 전 대회는 문제 제목조차 감춘다. 코딩테스트는 시작 버튼을 누르기 전에는 안 보인다.
 * 상시 컬렉션은 언제나 보인다.
 */
export function canSeeItems(
    c: Collection,
    member: CollectionMember | null,
    canManage: boolean,
): boolean {
    if (canManage) return true;
    if (c.timing === "none") return true;
    if (c.timing === "fixed") return !!c.startsAt && new Date() >= c.startsAt;
    return !!member?.startedAt;
}

/**
 * 제출의 판정을 지금 보여줘도 되는지.
 *
 * 코딩테스트는 본인 제출이라도 끝나기 전에는 결과를 감춘다. 채점은 정상으로 돌고
 * 화면에는 "채점됨"까지만 나온다. 운영자는 언제나 본다.
 */
export async function verdictVisible(
    viewer: User | null,
    collectionId: number | null,
): Promise<boolean> {
    if (!collectionId) return true;
    if (viewer && atLeast(viewer.role, "staff")) return true;

    const [c] = await db.select().from(collections).where(eq(collections.id, collectionId));
    if (!c) return true;
    if (c.reveal !== "after_end") return true;

    let member: CollectionMember | null = null;
    if (viewer) {
        const [m] = await db
            .select()
            .from(collectionMembers)
            .where(
                and(eq(collectionMembers.collectionId, c.id), eq(collectionMembers.userId, viewer.id)),
            );
        member = m ?? null;
    }
    return canRevealVerdict(c, member);
}

/** 남의 제출 소스를 볼 수 있는지. 대회 중에는 본인과 운영자만 */
export function canViewSource(
    user: User | null,
    submissionUserId: number,
    isCodePublic: boolean,
): boolean {
    if (!user) return isCodePublic;
    if (user.id === submissionUserId) return true;
    if (atLeast(user.role, "staff")) return true;
    return isCodePublic;
}

export { isRunning, hasEnded };
