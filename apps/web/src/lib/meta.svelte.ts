import { get } from "./api";
import type { LanguageOption } from "./types";

/**
 * 서버가 주는 메타 정보. 언어 목록과 채점 대기 현황.
 *
 * 언어 선택지를 화면에 배열로 박지 않는다. KOJ 는 모달 3곳에 같은 배열이 복사돼 있어서
 * 언어를 추가하면 어딘가 하나가 빠졌다. 여기서 한 번 받아 전 화면이 공유한다.
 */
class Meta {
    languages = $state<LanguageOption[]>([]);
    private loading: Promise<void> | null = null;

    /** 여러 화면이 동시에 불러도 요청은 한 번만 나간다 */
    ensureLanguages(): Promise<void> {
        this.loading ??= (async () => {
            try {
                const r = await get<{ languages: LanguageOption[] }>("/languages");
                this.languages = r.languages;
            } catch {
                // 실패하면 빈 목록. 제출 화면이 선택지를 못 그리고 안내를 띄운다
                this.loading = null;
            }
        })();
        return this.loading;
    }

    /** enum 값을 사람이 읽는 이름으로. 목록에 c 가 아니라 C17 이 보이게 한다 */
    label(id: string): string {
        return this.languages.find((l) => l.id === id)?.label ?? id;
    }
}

export const meta = new Meta();

/**
 * 채점 대기 현황.
 *
 * "대기 12건" 한 줄이 "왜 안 채점되냐"는 문의를 크게 줄인다.
 * 값은 헬스체크 API 가 이미 내고 있어서 새로 만들 게 없다.
 */
class Queue {
    queued = $state(0);
    judging = $state(0);
    workersAlive = $state(0);
    /** 큐가 쌓였는데 살아 있는 워커가 없으면 장애다 */
    stalled = $state(false);
    loaded = $state(false);

    async refresh(): Promise<void> {
        try {
            const r = await get<{
                queue: { queued: number; judging: number };
                workers: { alive: boolean }[];
            }>("/queue");
            this.queued = r.queue.queued;
            this.judging = r.queue.judging;
            this.workersAlive = r.workers.filter((w) => w.alive).length;
            this.stalled = this.workersAlive === 0 && this.queued > 0;
        } catch {
            // 연결이 끊긴 경우. 화면에 숫자를 안 띄우고 조용히 넘어간다
            this.stalled = false;
        } finally {
            this.loaded = true;
        }
    }
}

export const queue = new Queue();
