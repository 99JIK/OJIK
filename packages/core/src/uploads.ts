// 본문에 넣는 그림의 규칙. API 와 화면이 같은 값을 보게 여기 모은다.

/**
 * 허용 형식.
 *
 * SVG 는 뺐다. 임의의 SVG 는 script 와 foreignObject 를 품을 수 있어서, 나중에 누가
 * <object> 나 <iframe> 으로 열거나 파일을 그대로 내려받게 하면 그 순간 XSS 경로가 된다.
 * 지금 화면이 <img> 로만 그려서 안전하다는 건 지금 화면 얘기지 파일 얘기가 아니다.
 *
 * 도식은 mermaid 로 본문에 직접 쓰면 된다. 그림판을 붙일 때는 업로드가 아니라
 * 본문에 인라인으로 넣고 살균기를 거치게 할 것.
 */
export const UPLOAD_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
};

/** 한 장 상한. 문제 본문에 들어갈 그림이라 이 이상은 원본을 줄여 올리는 게 맞다 */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export function uploadExtension(mime: string): string | null {
    return UPLOAD_TYPES[mime.toLowerCase()] ?? null;
}

/**
 * 저장된 그림의 이름. 내용 해시라서 같은 그림을 여러 번 올려도 한 벌만 남는다.
 *
 * 이름이 내용으로 정해지므로 지우는 건 위험하다. 다른 문제가 같은 그림을 쓰고 있을 수 있다.
 */
export function uploadName(sha256: string, ext: string): string {
    return `${sha256}.${ext}`;
}

/** 파일명이 우리가 만든 모양인지. 경로 조작을 여기서 막는다 */
export function isValidUploadName(name: string): boolean {
    return /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/.test(name);
}
