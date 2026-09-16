import { VERDICT_LABEL, STATUS_LABEL, type Verdict, type SubmissionStatus } from "@ojik/core";

/** 판정별 색. 컴포넌트마다 삼항으로 색을 박지 않는다 */
export function verdictClass(v: Verdict | null, status: SubmissionStatus): string {
    if (status !== "done") return "text-blue-600 dark:text-blue-400";
    switch (v) {
        case "accepted":
            return "text-green-600 dark:text-green-400 font-semibold";
        case "compile_error":
            return "text-orange-600 dark:text-orange-400";
        case "internal_error":
            return "text-zinc-500";
        default:
            return "text-red-600 dark:text-red-400";
    }
}

export function verdictText(v: Verdict | null, status: SubmissionStatus, judged = 0, total = 0): string {
    if (status === "queued") return STATUS_LABEL.queued;
    if (status === "judging") {
        return total > 0 ? `채점 중 (${Math.floor((judged / total) * 100)}%)` : STATUS_LABEL.judging;
    }
    if (status === "canceled") return STATUS_LABEL.canceled;
    return v ? VERDICT_LABEL[v] : "-";
}

export function formatMemory(kb: number | null): string {
    if (kb === null) return "-";
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

export function formatTime(ms: number | null): string {
    return ms === null ? "-" : `${ms} ms`;
}

export function formatDate(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 맞힌 비율. 제출이 없으면 표시하지 않는다. 0% 와 데이터 없음은 다르다 */
export function acceptRate(accepted: number, total: number): string {
    return total === 0 ? "-" : `${((accepted / total) * 100).toFixed(1)}%`;
}
