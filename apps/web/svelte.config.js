import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
    preprocess: vitePreprocess(),
    kit: {
        // SPA 로 뽑는다. 서버 렌더링을 안 쓰므로 배포는 정적 파일 복사 + nginx 뿐이다.
        // KOJ 의 배포 흐름(dist 를 통째로 올리고 nginx reload)을 그대로 쓸 수 있다
        adapter: adapter({ fallback: "index.html", strict: false }),
    },
};
