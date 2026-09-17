import { get, post, setUnauthorizedHandler, ApiError } from "./api";
import type { PublicUser } from "./types";
import { atLeast } from "@ojik/core";

/**
 * 로그인 상태. 토큰은 httpOnly 쿠키에 있어서 스크립트가 못 읽는다.
 * 그래서 "로그인했나"는 저장된 토큰을 보는 게 아니라 /auth/me 를 물어서 안다.
 */
class Session {
    user = $state<PublicUser | null>(null);
    ready = $state(false);

    /**
     * 권한 판정은 core 의 서열을 쓴다. 여기서 문자열을 나열하면 역할이 늘 때마다
     * 프론트만 빠뜨린다. instructor 를 넣었을 때 실제로 그럴 뻔했다
     */
    get isStaff(): boolean {
        return !!this.user && atLeast(this.user.role, "staff");
    }

    /** 강의를 열고 운영할 수 있는지. 출제자와 관리자도 포함된다 */
    get canTeach(): boolean {
        return !!this.user && atLeast(this.user.role, "instructor");
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
