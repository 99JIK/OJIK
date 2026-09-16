/**
 * API 호출 한 곳. 도메인마다 호출 함수를 따로 두지 않는다.
 *
 * KOJ 프론트는 src/api/ 아래에 도메인별 함수가 60여 개 있었고 공통 axios 인스턴스가 없었다.
 * 각 함수가 토큰을 인자로 받아 헤더를 직접 만들었고, 401 처리와 공통 에러 정책이 없었다.
 * 여기서는 이 파일이 그 전부를 맡는다.
 */

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

/** 401 이 오면 화면이 로그인 상태를 지울 수 있게 알린다 */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler = () => {};
export function setUnauthorizedHandler(h: UnauthorizedHandler): void {
    onUnauthorized = h;
}

interface Options {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined | null>;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
    const url = new URL(BASE + path, window.location.origin);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    let res: Response;
    try {
        res = await fetch(url, {
            method: opts.method ?? "GET",
            // 토큰은 httpOnly 쿠키다. 스크립트가 헤더를 만들 일이 없다
            credentials: "include",
            headers: opts.body ? { "Content-Type": "application/json" } : {},
            body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
    } catch {
        // 상태 코드가 없는 오류. KOJ 는 여기서 axios 원문(ERR_NETWORK 등)을 그대로 띄웠다
        throw new ApiError(0, "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    }

    if (res.status === 401) onUnauthorized();

    if (!res.ok) {
        let message = `요청이 실패했습니다 (${res.status})`;
        try {
            const j = (await res.json()) as { error?: string };
            if (j.error) message = j.error;
        } catch {
            // 본문이 JSON 이 아니면 위 기본 문구를 쓴다
        }
        throw new ApiError(res.status, message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

export const get = <T>(path: string, query?: Options["query"]) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });
