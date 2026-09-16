import { Hono } from "hono";
import { z } from "zod";
import { v } from "../validate";
import { and, eq, sql, count } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { CONSENT_VERSION } from "@ojik/core";
import { users, userEmails, consents } from "@ojik/db";
import { db } from "../db";
import {
    hashPassword,
    verifyPassword,
    issueToken,
    setAuthCookie,
    clearAuthCookie,
    requireAuth,
    type AuthEnv,
} from "../auth";

/** 계정당 등록 가능한 이메일 수. 제약이 아니라 정책이라 코드에 둔다 */
const MAX_EMAILS = 2;

const RegisterBody = z.object({
    handle: z
        .string()
        .min(3)
        .max(20)
        // URL 에 그대로 들어가고 표시 이름으로도 쓰이므로 문자 종류를 좁힌다
        .regex(/^[a-zA-Z0-9_]+$/, "영문, 숫자, 밑줄만 쓸 수 있습니다"),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    displayName: z.string().max(40).optional(),
    /**
     * 연구 목적 이용 동의. 기본값은 false 여야 한다.
     * 체크된 채로 가입시키면 동의로 인정되지 않는다.
     */
    researchConsent: z.boolean().default(false),
});

const LoginBody = z.object({
    email: z.string().min(1),
    password: z.string().min(1),
});

function publicUser(u: typeof users.$inferSelect) {
    return {
        id: u.id,
        handle: u.handle,
        displayName: u.displayName,
        role: u.role,
        solvedCount: u.solvedCount,
        submissionCount: u.submissionCount,
        createdAt: u.createdAt,
    };
}

export const authRoutes = new Hono<AuthEnv>()
    .post("/register", v("json", RegisterBody), async (c) => {
        const body = c.req.valid("json");

        // 유일성은 DB 인덱스가 최종 판단이다. 여기 검사는 에러 문구를 위한 것이고,
        // 동시 요청이면 아래 insert 가 제약 위반으로 떨어진다
        const [dupHandle] = await db
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.handle}) = lower(${body.handle})`);
        if (dupHandle) throw new HTTPException(409, { message: "이미 쓰이는 아이디입니다" });

        const [dupEmail] = await db
            .select({ id: userEmails.id })
            .from(userEmails)
            .where(sql`lower(${userEmails.email}) = lower(${body.email})`);
        if (dupEmail) throw new HTTPException(409, { message: "이미 쓰이는 이메일입니다" });

        const passwordHash = await hashPassword(body.password);

        const user = await db.transaction(async (tx) => {
            const [u] = await tx
                .insert(users)
                .values({
                    handle: body.handle,
                    passwordHash,
                    displayName: body.displayName ?? null,
                })
                .returning();

            await tx.insert(userEmails).values({ userId: u!.id, email: body.email, isPrimary: true });

            if (body.researchConsent) {
                await tx.insert(consents).values({
                    userId: u!.id,
                    kind: "research",
                    version: CONSENT_VERSION.research,
                });
            }
            return u!;
        });

        const token = await issueToken(user);
        setAuthCookie(c, token);
        return c.json({ user: publicUser(user), token }, 201);
    })

    /** 로그인은 등록된 아무 주소로나 된다. 학교 메일을 추가하면 그걸로도 들어온다 */
    .post("/login", v("json", LoginBody), async (c) => {
        const { email, password } = c.req.valid("json");

        const [row] = await db
            .select({ user: users })
            .from(userEmails)
            .innerJoin(users, eq(users.id, userEmails.userId))
            .where(sql`lower(${userEmails.email}) = lower(${email})`);

        // 계정이 없는 경우와 비밀번호가 틀린 경우를 구분해 알려주지 않는다.
        // 존재 여부를 흘리면 대상을 추려 공격할 수 있다
        if (!row || !(await verifyPassword(password, row.user.passwordHash))) {
            throw new HTTPException(401, { message: "이메일 또는 비밀번호가 올바르지 않습니다" });
        }

        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.user.id));
        const token = await issueToken(row.user);
        setAuthCookie(c, token);
        return c.json({ user: publicUser(row.user), token });
    })

    .post("/logout", (c) => {
        clearAuthCookie(c);
        return c.json({ ok: true });
    })

    .get("/me", requireAuth, async (c) => {
        const u = c.get("user")!;
        const emails = await db
            .select({
                id: userEmails.id,
                email: userEmails.email,
                isPrimary: userEmails.isPrimary,
                verifiedAt: userEmails.verifiedAt,
            })
            .from(userEmails)
            .where(eq(userEmails.userId, u.id))
            .orderBy(userEmails.id);

        const granted = await db
            .select({ kind: consents.kind, version: consents.version })
            .from(consents)
            .where(and(eq(consents.userId, u.id), sql`${consents.revokedAt} IS NULL`));

        return c.json({ user: publicUser(u), emails, consents: granted });
    })

    /** 이메일 추가. 학교 메일을 붙이거나 주소를 갈아탈 때 쓴다 */
    .post("/emails", requireAuth, v("json", z.object({ email: z.string().email() })), async (c) => {
        const u = c.get("user")!;
        const { email } = c.req.valid("json");

        const [n] = await db.select({ n: count() }).from(userEmails).where(eq(userEmails.userId, u.id));
        if ((n?.n ?? 0) >= MAX_EMAILS) {
            throw new HTTPException(409, {
                message: `이메일은 ${MAX_EMAILS}개까지 등록할 수 있습니다. 먼저 하나를 지우세요.`,
            });
        }

        const [dup] = await db
            .select({ id: userEmails.id })
            .from(userEmails)
            .where(sql`lower(${userEmails.email}) = lower(${email})`);
        if (dup) throw new HTTPException(409, { message: "이미 쓰이는 이메일입니다" });

        const [row] = await db.insert(userEmails).values({ userId: u.id, email }).returning();
        return c.json({ email: row }, 201);
    })

    /** 대표 주소 변경. 알림이 이 주소로 간다 */
    .patch("/emails/:id{[0-9]+}/primary", requireAuth, async (c) => {
        const u = c.get("user")!;
        const id = Number(c.req.param("id"));

        const [target] = await db
            .select()
            .from(userEmails)
            .where(and(eq(userEmails.id, id), eq(userEmails.userId, u.id)));
        if (!target) throw new HTTPException(404, { message: "이메일을 찾을 수 없습니다" });

        await db.transaction(async (tx) => {
            await tx.update(userEmails).set({ isPrimary: false }).where(eq(userEmails.userId, u.id));
            await tx.update(userEmails).set({ isPrimary: true }).where(eq(userEmails.id, id));
        });
        return c.json({ ok: true });
    })

    .delete("/emails/:id{[0-9]+}", requireAuth, async (c) => {
        const u = c.get("user")!;
        const id = Number(c.req.param("id"));

        const rows = await db.select().from(userEmails).where(eq(userEmails.userId, u.id));
        // 마지막 주소를 지우면 로그인할 방법이 없어진다
        if (rows.length <= 1) {
            throw new HTTPException(409, { message: "마지막 이메일은 지울 수 없습니다" });
        }
        const target = rows.find((r) => r.id === id);
        if (!target) throw new HTTPException(404, { message: "이메일을 찾을 수 없습니다" });

        await db.transaction(async (tx) => {
            await tx.delete(userEmails).where(eq(userEmails.id, id));
            // 대표를 지웠으면 남은 것 중 하나를 대표로 올린다. 대표가 없는 상태를 두지 않는다
            if (target.isPrimary) {
                const next = rows.find((r) => r.id !== id)!;
                await tx.update(userEmails).set({ isPrimary: true }).where(eq(userEmails.id, next.id));
            }
        });
        return c.json({ ok: true });
    })

    /** 연구 이용 동의 변경. 철회는 행을 지우지 않고 revokedAt 을 찍는다 */
    .put("/consent/research", requireAuth, v("json", z.object({ granted: z.boolean() })), async (c) => {
        const u = c.get("user")!;
        const { granted } = c.req.valid("json");

        if (granted) {
            await db.insert(consents).values({
                userId: u.id,
                kind: "research",
                version: CONSENT_VERSION.research,
            });
        } else {
            await db
                .update(consents)
                .set({ revokedAt: new Date() })
                .where(
                    and(
                        eq(consents.userId, u.id),
                        eq(consents.kind, "research"),
                        sql`${consents.revokedAt} IS NULL`,
                    ),
                );
        }
        return c.json({ ok: true, granted });
    });
