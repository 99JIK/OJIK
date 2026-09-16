import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { sign, verify } from "hono/jwt";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { atLeast, type Role } from "@ojik/core";
import { users, type User } from "@ojik/db";
import { db } from "./db";
import { env } from "./env";

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

export const COOKIE_NAME = "ojik_token";

/** 서명 알고리즘. sign 과 verify 가 반드시 같아야 한다 */
const ALG = "HS256" as const;

/**
 * scrypt 로 해시한다. bcrypt/argon2 는 네이티브 빌드가 필요해서 배포 환경마다 걸린다.
 * scrypt 는 node 내장이라 의존성이 없다.
 * 저장 형식: scrypt$<반복파라미터없음>$<salt hex>$<hash hex>
 */
export async function hashPassword(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scrypt(plain, salt, 64);
    return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const salt = Buffer.from(parts[1]!, "hex");
    const expected = Buffer.from(parts[2]!, "hex");
    const actual = await scrypt(plain, salt, expected.length);
    // 길이가 다르면 timingSafeEqual 이 던진다. 비교 전에 막는다
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
}

export interface TokenPayload {
    sub: number;
    role: Role;
    handle: string;
    exp: number;
    /** hono 의 JWTPayload 가 인덱스 시그니처를 요구한다 */
    [key: string]: unknown;
}

export async function issueToken(user: User): Promise<string> {
    const payload: TokenPayload = {
        sub: user.id,
        role: user.role,
        handle: user.handle,
        exp: Math.floor(Date.now() / 1000) + env.JWT_TTL_SEC,
    };
    return sign(payload, env.JWT_SECRET, ALG);
}

export function setAuthCookie(c: Parameters<typeof setCookie>[0], token: string): void {
    // httpOnly 라 스크립트가 못 읽는다. KOJ 는 sessionStorage 에 넣어서 XSS 하나로 토큰이 샜다
    setCookie(c, COOKIE_NAME, token, {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: "Lax",
        path: "/",
        maxAge: env.JWT_TTL_SEC,
    });
}

export function clearAuthCookie(c: Parameters<typeof deleteCookie>[0]): void {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
}

type Env = { Variables: { user: User | null } };

/**
 * 토큰이 있으면 사용자를 붙이고, 없거나 깨졌으면 그냥 통과시킨다.
 * 접근 제어는 requireAuth / requireRole 가 한다. 공개 API 와 보호 API 가 같은 파이프를 탄다.
 */
export const attachUser = createMiddleware<Env>(async (c, next) => {
    c.set("user", null);
    const header = c.req.header("Authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const token = bearer ?? getCookie(c, COOKIE_NAME) ?? null;

    if (token) {
        try {
            const payload = (await verify(token, env.JWT_SECRET, ALG)) as unknown as TokenPayload;
            // 토큰의 role 을 그대로 믿지 않고 DB 를 본다. 권한을 내려도 기존 토큰이 살아 있으면
            // 만료까지 그 권한이 유지되기 때문이다
            const [u] = await db.select().from(users).where(eq(users.id, payload.sub));
            if (u) c.set("user", u);
        } catch {
            // 만료되거나 서명이 안 맞는 토큰은 비로그인으로 취급한다
        }
    }
    await next();
});

export const requireAuth = createMiddleware<Env>(async (c, next) => {
    if (!c.get("user")) throw new HTTPException(401, { message: "로그인이 필요합니다" });
    await next();
});

export function requireRole(role: Role) {
    return createMiddleware<Env>(async (c, next) => {
        const u = c.get("user");
        if (!u) throw new HTTPException(401, { message: "로그인이 필요합니다" });
        if (!atLeast(u.role, role)) throw new HTTPException(403, { message: "권한이 없습니다" });
        await next();
    });
}

export type AuthEnv = Env;
