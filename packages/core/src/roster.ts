// 수강생 명단 파일. 계정이 없는 사람까지 한 번에 만들 때 쓴다.

/**
 * CSV 로 받는다. 엑셀(.xlsx)은 파싱에 라이브러리가 필요한데, 엑셀에서 "다른 이름으로 저장"
 * 하면 CSV 가 나오므로 얻는 게 적다. 서식이 없는 것도 이점이다. 셀 서식 때문에 학번이
 * 1.2E+9 로 저장되는 사고가 안 난다.
 *
 * 열은 셋이다.
 *   handle   로그인에 쓰는 아이디. 영문, 숫자, 밑줄
 *   email    계정당 하나. 이미 쓰는 주소면 그 계정을 명단에 넣는다
 *   name     표시 이름. 비워도 된다
 *
 * 헤더 줄은 있어도 되고 없어도 된다. 첫 줄이 열 이름처럼 보이면 건너뛴다.
 */

export interface RosterRow {
    handle: string;
    email: string;
    name: string;
    /** 파일에서 몇 번째 줄인지. 오류를 알려줄 때 쓴다 */
    line: number;
}

export interface RosterParse {
    rows: RosterRow[];
    /** 줄 번호와 사유. 통째로 거부하지 않고 고칠 수 있게 돌려준다 */
    errors: Array<{ line: number; message: string }>;
}

export const ROSTER_HEADER = "handle,email,name";
export const ROSTER_SAMPLE = [
    ROSTER_HEADER,
    "student01,student01@example.com,홍길동",
    "student02,student02@example.com,김영희",
].join("\n");

/** 한 번에 만들 수 있는 최대 인원. 실수로 큰 파일을 올렸을 때 막는다 */
export const ROSTER_MAX_ROWS = 500;

const HANDLE_RE = /^[A-Za-z0-9_]{2,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 따옴표를 다루는 최소한의 CSV 분해.
 *
 * 이름에 쉼표가 들어갈 수 있어서 따옴표만큼은 봐야 한다. 줄바꿈이 든 셀은 안 받는다.
 * 명단에 그런 값이 들어올 이유가 없고, 지원하면 줄 단위로 나누는 것부터 다시 짜야 한다.
 */
function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quoted) {
            if (ch === '"') {
                // "" 는 따옴표 한 개
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                cur += ch;
            }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === "," || ch === "\t") {
            out.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out.map((c) => c.trim());
}

/** 첫 줄이 열 이름처럼 보이는지 */
function looksLikeHeader(cells: string[]): boolean {
    const joined = cells.join(",").toLowerCase();
    return joined.includes("handle") || joined.includes("email") || joined.includes("아이디");
}

export function parseRoster(text: string): RosterParse {
    const rows: RosterRow[] = [];
    const errors: RosterParse["errors"] = [];
    const seenHandle = new Set<string>();
    const seenEmail = new Set<string>();

    // BOM 을 걷어낸다. 엑셀이 UTF-8 로 저장하면 앞에 붙는다
    const lines = text.replace(/^﻿/, "").split(/\r\n?|\n/);

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        const line = i + 1;
        if (!raw.trim()) continue;

        const cells = splitCsvLine(raw);
        if (i === 0 && looksLikeHeader(cells)) continue;

        const [handle = "", email = "", name = ""] = cells;

        if (!handle && !email) continue;
        if (!HANDLE_RE.test(handle)) {
            errors.push({ line, message: `아이디 "${handle}" 가 규칙에 안 맞습니다 (영문, 숫자, 밑줄 2~20자)` });
            continue;
        }
        if (!EMAIL_RE.test(email)) {
            errors.push({ line, message: `이메일 "${email}" 가 주소 모양이 아닙니다` });
            continue;
        }

        const h = handle.toLowerCase();
        const e = email.toLowerCase();
        if (seenHandle.has(h)) {
            errors.push({ line, message: `아이디 "${handle}" 가 파일 안에서 겹칩니다` });
            continue;
        }
        if (seenEmail.has(e)) {
            errors.push({ line, message: `이메일 "${email}" 가 파일 안에서 겹칩니다` });
            continue;
        }
        seenHandle.add(h);
        seenEmail.add(e);

        rows.push({ handle, email, name, line });
    }

    return { rows, errors };
}

/**
 * 임시 비밀번호.
 *
 * 헷갈리는 글자를 뺀다. 종이에 적어 나눠 주거나 불러 주는 상황이라 0 과 O, 1 과 l 이
 * 섞이면 그 자리에서 문제가 된다.
 *
 * 만든 뒤 한 번만 돌려준다. 해시만 저장하므로 다시 볼 수 없고, 잃어버리면 다시 만들어야 한다.
 */
const PW_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeTempPassword(length = 12, random: () => number = Math.random): string {
    let out = "";
    for (let i = 0; i < length; i++) {
        out += PW_ALPHABET[Math.floor(random() * PW_ALPHABET.length)];
    }
    return out;
}

/** 만든 계정을 나눠 줄 CSV. 강사가 받아서 배포한다 */
export function resultCsv(rows: Array<{ handle: string; email: string; name: string; password: string }>): string {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = "handle,email,name,password";
    const body = rows.map((r) => [r.handle, r.email, r.name, r.password].map(esc).join(","));
    // 엑셀이 UTF-8 로 열게 BOM 을 붙인다. 없으면 한글 이름이 깨져 보인다
    return "﻿" + [head, ...body].join("\r\n") + "\r\n";
}
