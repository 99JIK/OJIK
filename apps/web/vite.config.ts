import { fileURLToPath } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

// .env 는 저장소 루트에 하나만 둔다. vite 기본값은 이 패키지 디렉터리라 그대로 두면 못 읽는다
const envDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
    // 세 번째 인자를 "" 로 주면 VITE_ 접두어가 없는 값도 읽는다. API 포트를 알아야 해서
    const env = loadEnv(mode, envDir, "");
    const apiPort = env.PORT || "3000";

    return {
        plugins: [tailwindcss(), sveltekit()],
        envDir,
        server: {
            port: 5173,
            /**
             * 개발 중 /api 를 API 서버로 넘긴다.
             *
             * 이게 없으면 프론트가 보낸 /api/... 를 vite 자신이 받아 404 를 낸다.
             * 절대 URL(VITE_API_BASE)로 바꿔도 되지만, 프록시로 두면 같은 오리진이라
             * 쿠키와 CORS 를 신경 쓸 필요가 없다. 운영의 nginx 구성과도 같은 모양이다.
             */
            proxy: {
                "/api": {
                    target: `http://localhost:${apiPort}`,
                    changeOrigin: false,
                },
            },
        },
    };
});
