import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
    UPLOAD_MAX_BYTES,
    UPLOAD_TYPES,
    uploadExtension,
    uploadName,
    isValidUploadName,
} from "@ojik/core";
import { sha256, writeUpload, readUpload } from "../storage";
import { requireRole, type AuthEnv } from "../auth";

/**
 * 문제 본문과 교재에 넣는 그림.
 *
 * DB 에 행을 안 만든다. 본문의 마크다운이 곧 참조다. 파일 표를 따로 두면 그 표와 본문이
 * 어긋나는 상태를 관리해야 하는데, 지금 규모에서 얻는 게 없다.
 *
 * 올린 사람을 기록하지 않는 것도 같은 이유다. 필요해지면 그때 표를 만든다.
 */
export const uploadRoutes = new Hono<AuthEnv>()
    /**
     * 그림 올리기. 강사 이상만.
     *
     * 아무나 올리게 두면 저장소가 곧 남의 파일 호스팅이 된다. 문제와 교재를 쓰는 사람만
     * 필요한 기능이라 거기 맞춘다.
     */
    .post("/", requireRole("instructor"), async (c) => {
        const form = await c.req.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) {
            throw new HTTPException(400, { message: "file 필드에 그림을 담아 보내세요" });
        }

        const ext = uploadExtension(file.type);
        if (!ext) {
            throw new HTTPException(415, {
                message: `지원하지 않는 형식입니다 (${file.type || "알 수 없음"}). ` +
                    `쓸 수 있는 형식: ${Object.values(UPLOAD_TYPES).join(", ")}`,
            });
        }
        if (file.size > UPLOAD_MAX_BYTES) {
            throw new HTTPException(413, {
                message: `그림이 너무 큽니다 (${Math.round(file.size / 1024)}KB). ` +
                    `최대 ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB 입니다.`,
            });
        }

        const buf = Buffer.from(await file.arrayBuffer());
        // Content-Type 은 보낸 쪽이 정하는 값이라 믿지 않는다. 앞 바이트로 실제 형식을 본다
        if (!matchesMagic(buf, ext)) {
            throw new HTTPException(415, {
                message: "파일 내용이 확장자와 다릅니다. 원본 그림을 그대로 올려 주세요.",
            });
        }

        const name = uploadName(sha256(buf), ext);
        await writeUpload(name, buf);

        return c.json({ name, url: `/api/uploads/${name}`, bytes: buf.length }, 201);
    })

    /**
     * 그림 내려주기. 로그인 없이 열린다.
     *
     * 문제 본문이 비공개여도 이 주소를 아는 사람은 그림을 볼 수 있다. 이름이 내용 해시라
     * 찍어서 맞히기는 어렵지만, 본문을 한 번이라도 본 사람은 주소를 안다. 대회 문제의
     * 그림을 이걸로 감출 수는 없다는 뜻이다.
     *
     * 문제 단위 권한 검사를 붙이려면 그림이 어느 문제 것인지 알아야 하고, 그러면 위에서
     * 안 만들기로 한 파일 표가 필요해진다. 지금은 안 한다.
     */
    .get("/:name", async (c) => {
        const name = c.req.param("name");
        // 경로 조작은 여기서 끝난다. 우리가 만든 이름 모양이 아니면 파일을 안 찾는다
        if (!isValidUploadName(name)) throw new HTTPException(404, { message: "없는 그림입니다" });

        const buf = await readUpload(name);
        if (!buf) throw new HTTPException(404, { message: "없는 그림입니다" });

        const ext = name.split(".").pop()!;
        const mime = Object.entries(UPLOAD_TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";

        return c.body(buf.buffer as ArrayBuffer, 200, {
            "content-type": mime,
            // 이름이 내용 해시라 내용이 바뀌면 이름도 바뀐다. 영구 캐시해도 안전하다
            "cache-control": "public, max-age=31536000, immutable",
            // 그림으로만 쓰인다. 브라우저가 내용을 보고 다른 형식으로 해석하지 않게 못박는다
            "x-content-type-options": "nosniff",
        });
    });

/**
 * 앞 몇 바이트로 실제 형식 확인.
 *
 * 브라우저가 보내는 Content-Type 은 파일 확장자에서 추측한 값이라, 이름만 바꾼 파일이
 * 그대로 통과한다. 그림이 아닌 걸 그림 주소로 서빙하는 상태를 만들지 않으려는 것이다.
 */
function matchesMagic(buf: Buffer, ext: string): boolean {
    if (buf.length < 12) return false;
    switch (ext) {
        case "png":
            return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        case "jpg":
            return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        case "gif":
            return buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a";
        case "webp":
            return buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
        default:
            return false;
    }
}
