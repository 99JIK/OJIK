import { z } from "zod";
import { loadEnv } from "@ojik/core/env";

loadEnv();

const Schema = z.object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3000),

    /*
     * 들을 주소.
     *
     * 기본이 0.0.0.0 이라 공인 IP 가 붙은 서버에서는 API 가 그대로 바깥에 열린다.
     * nginx 뒤에 둘 때는 127.0.0.1 로 묶어야 한다. 그러면 역프록시를 건너뛴 직접 접속이
     * 아예 불가능해져서, CORS 설정이 틀려도 그게 구멍이 되지 않는다.
     *
     * 개발에서는 0.0.0.0 이 편하다. WSL2 안에서 띄우고 Windows 브라우저로 보는 경우가 있다.
     */
    HOST: z.string().default("0.0.0.0"),

    /** 토큰 서명 키. 운영에서 기본값이 남아 있으면 누구나 관리자 토큰을 만들 수 있다 */
    JWT_SECRET: z.string().min(32),
    /** 액세스 토큰 수명(초) */
    JWT_TTL_SEC: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),

    /** 테스트케이스와 첨부의 루트. 워커의 DATA_DIR 과 같은 실체여야 한다 */
    DATA_DIR: z.string().min(1),

    /** 쉼표로 구분한 허용 출처. KOJ 는 main.go 에 박아 뒀다 */
    CORS_ORIGINS: z.string().default("http://localhost:5173"),

    /** 쿠키에 Secure 를 붙일지. https 뒤에 있으면 true */
    COOKIE_SECURE: z
        .enum(["true", "false"])
        .default("false")
        .transform((v) => v === "true"),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
    console.error("설정이 올바르지 않습니다:");
    for (const i of parsed.error.issues) console.error(`  ${i.path.join(".")}: ${i.message}`);
    process.exit(1);
}

export const env = parsed.data;
export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
