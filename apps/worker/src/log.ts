import { config } from "./config";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const min = LEVELS[config.LOG_LEVEL];

function emit(level: keyof typeof LEVELS, msg: string, extra?: Record<string, unknown>) {
    if (LEVELS[level] < min) return;
    const line = { t: new Date().toISOString(), level, worker: config.WORKER_ID, msg, ...extra };
    const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
    out.write(JSON.stringify(line) + "\n");
}

export const log = {
    debug: (m: string, e?: Record<string, unknown>) => emit("debug", m, e),
    info: (m: string, e?: Record<string, unknown>) => emit("info", m, e),
    warn: (m: string, e?: Record<string, unknown>) => emit("warn", m, e),
    error: (m: string, e?: Record<string, unknown>) => emit("error", m, e),
};
