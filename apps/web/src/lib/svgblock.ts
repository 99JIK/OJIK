/**
 * 본문 안의 SVG 블록 찾기.
 *
 * 그림판이 넣은 그림을 다시 열어 고치려면 커서가 어느 그림 안에 있는지 알아야 한다.
 * 정규식으로 여는 태그와 닫는 태그를 짝지어 찾는다. SVG 는 중첩될 수 있지만 그림판이
 * 중첩을 만들지 않으므로 여기서는 보지 않는다. 남이 붙여넣은 중첩 SVG 를 만나면
 * 바깥 것을 통째로 잡는데, 통째로 다시 그리게 되는 것뿐이라 손해가 없다.
 *
 * 화면과 떼어 두는 건 테스트 때문이다. 커서 위치 판정은 눈으로 확인하기 나쁜 종류다.
 */

export interface SvgBlock {
    svg: string;
    /** value 안에서의 범위. 고친 뒤 이 자리를 통째로 바꾼다 */
    start: number;
    end: number;
}

/** pos 가 들어 있는 SVG 블록. 없으면 null */
export function extractSvgAt(text: string, pos: number): SvgBlock | null {
    for (const b of findSvgBlocks(text)) {
        // 경계도 안쪽으로 친다. 그림 바로 뒤에 커서를 두고 여는 게 자연스럽다
        if (pos >= b.start && pos <= b.end) return b;
    }
    return null;
}

/** 본문에 든 SVG 블록 전부 */
export function findSvgBlocks(text: string): SvgBlock[] {
    const out: SvgBlock[] = [];
    const open = /<svg\b/gi;
    let m: RegExpExecArray | null;

    while ((m = open.exec(text)) !== null) {
        const start = m.index;
        const close = text.indexOf("</svg>", start);
        if (close === -1) break;
        const end = close + "</svg>".length;
        out.push({ svg: text.slice(start, end), start, end });
        open.lastIndex = end;
    }
    return out;
}

/** 범위를 바꾼 문자열 */
export function replaceRange(text: string, start: number, end: number, next: string): string {
    return text.slice(0, start) + next + text.slice(end);
}
