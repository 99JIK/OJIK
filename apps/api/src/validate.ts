import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import type { ZodSchema, ZodIssue } from "zod";

/**
 * zValidator 를 감싸서 검증 실패 응답을 나머지 API 와 같은 모양으로 만든다.
 *
 * 기본 zValidator 는 zod 의 issue 배열을 그대로 내보낸다. 응답 형식이 엔드포인트마다
 * 달라지고, 프론트가 에러 문구를 꺼내는 경로도 둘이 된다.
 * 여기서는 전부 { error: "..." } 하나로 맞춘다.
 */
export function v<T extends ZodSchema>(
    target: "json" | "query" | "param" | "form" | "header",
    schema: T,
) {
    return zValidator(target, schema, (result) => {
        if (result.success) return;
        throw new HTTPException(400, { message: describe(result.error.issues) });
    });
}

/** 첫 문제 하나만 문구로 만든다. 여러 개를 나열해도 사용자가 고칠 곳은 보통 하나다 */
function describe(issues: ZodIssue[]): string {
    const first = issues[0];
    if (!first) return "요청 형식이 올바르지 않습니다";

    const where = first.path.length > 0 ? first.path.join(".") : "요청";

    if (first.code === "invalid_enum_value") {
        return `${where}: 지원하지 않는 값입니다 (가능: ${first.options.join(", ")})`;
    }
    if (first.code === "invalid_type" && first.received === "undefined") {
        return `${where}: 필수 항목입니다`;
    }
    // zod 스키마에 한국어 message 를 준 경우 그게 그대로 쓰인다
    return `${where}: ${first.message}`;
}
