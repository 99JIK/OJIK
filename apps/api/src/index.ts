import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { env, corsOrigins } from "./env";
import { handle } from "./db";
import { attachUser, type AuthEnv } from "./auth";
import { authRoutes } from "./routes/auth";
import { metaRoutes } from "./routes/meta";
import { problemRoutes } from "./routes/problems";
import { submissionRoutes } from "./routes/submissions";
import { collectionRoutes } from "./routes/collections";
import { solutionRoutes } from "./routes/solutions";

const app = new Hono<AuthEnv>();

app.use("*", logger());
app.use(
    "*",
    cors({
        origin: corsOrigins,
        // 쿠키로 인증하므로 켜야 한다. 이게 켜지면 origin 에 * 를 못 쓴다
        credentials: true,
    }),
);
app.use("*", attachUser);

app.route("/api/auth", authRoutes);
app.route("/api", metaRoutes);
app.route("/api/problems", problemRoutes);
app.route("/api/submissions", submissionRoutes);
app.route("/api/collections", collectionRoutes);
app.route("/api/solutions", solutionRoutes);

/**
 * 처리되지 않은 예외를 여기서 500 으로 바꾼다.
 * KOJ 백엔드는 Recover 미들웨어가 없어서 핸들러 패닉이 커넥션 끊김으로 나갔고,
 * 프론트에는 HTTP 오류가 아니라 Network Error 로 보였다. 원인 추적이 한 단계 더 멀어진다.
 */
app.onError((err, c) => {
    if (err instanceof HTTPException) {
        return c.json({ error: err.message }, err.status);
    }
    console.error("[unhandled]", err);
    // 내부 메시지를 그대로 내보내지 않는다. 스택에 경로와 쿼리가 들어 있다
    return c.json({ error: "서버 오류가 발생했습니다" }, 500);
});

app.notFound((c) => c.json({ error: "없는 경로입니다" }, 404));

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`api listening on :${info.port}`);
});

// 종료 신호를 받으면 받던 요청을 마치고 DB 커넥션을 정리한다
for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
        server.close(async () => {
            await handle.close().catch(() => {});
            process.exit(0);
        });
    });
}
