import { get, post, setUnauthorizedHandler, ApiError } from "./api";
import type { PublicUser } from "./types";

/**
 * 로그인 상태. 토큰은 httpOnly 쿠키에 있어서 스크립트가 못 읽는다.
 * 그래서 "로그인했나"는 저장된 토큰을 보는 게 아니라 /auth/me 를 물어서 안다.
 */
class Session {
    user = $state<PublicUser | null>(null);
    ready = $state(false);

    get isStaff(): boolean {
        return this.user?.role === "admin" || this.user?.role === "staff";
    }

    async load(): Promise<void> {
        try {
            const r = await get<{ user: PublicUser }>("/auth/me");
            this.user = r.user;
        } catch {
            // 401 이든 네트워크 오류든 화면상 비로그인으로 둔다
            this.user = null;
        } finally {
            this.ready = true;
        }
    }

    async login(email: string, password: string): Promise<void> {
        const r = await post<{ user: PublicUser }>("/auth/login", { email, password });
        this.user = r.user;
    }

    async register(
        handle: string,
        email: string,
        password: string,
        researchConsent: boolean,
    ): Promise<void> {
        const r = await post<{ user: PublicUser }>("/auth/register", {
            handle,
            email,
            password,
            researchConsent,
        });
        this.user = r.user;
    }

    async logout(): Promise<void> {
        await post("/auth/logout").catch(() => {});
        this.user = null;
    }
}

export const session = new Session();

// 어디서든 401 이 오면 로그인 상태를 지운다. 만료된 토큰으로 계속 로그인한 척하지 않게
setUnauthorizedHandler(() => {
    session.user = null;
});

export { ApiError };
