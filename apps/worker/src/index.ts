import os from "node:os";
import { eq, sql } from "drizzle-orm";
import {
    createDb,
    claimNext,
    heartbeat,
    reclaimStale,
    QUEUE_CHANNEL,
    judgeWorkers,
    submissions,
    type Submission,
} from "@ojik/db";
import { JUDGE_HEARTBEAT_INTERVAL_MS, JUDGE_LEASE_TIMEOUT_MS, MAX_JUDGE_ATTEMPTS } from "@ojik/core";
import { config } from "./config";
import { log } from "./log";
import { RunnerPool } from "./pool";
import { judge } from "./judge";
import { resolveJudgeEnv } from "./judge-env";

const handle = createDb(config.DATABASE_URL, { max: config.WORKER_CAPACITY + 4 });
const { db, sql: pg } = handle;
const pool = new RunnerPool();

/** 지금 이 워커가 채점 중인 제출 id. heartbeat 대상이자 종료 시 기다릴 대상 */
const inFlight = new Set<number>();
let draining = false;
/** 큐를 한 번 더 봐야 한다는 신호. NOTIFY 와 채점 완료가 여기를 친다 */
let wake: (() => void) | null = null;
/** 이 워커의 채점 환경 id. 기동 때 한 번 정해진다 */
let judgeEnvId: number | null = null;

function poke(): void {
    wake?.();
}

async function main(): Promise<void> {
    log.info("starting", {
        capacity: config.WORKER_CAPACITY,
        tcParallel: config.WORKER_TC_PARALLEL,
        dataDir: config.DATA_DIR,
        boxRoot: config.BOX_ROOT,
    });

    // 컨테이너를 건드리기 전에 중복부터 본다. 순서가 바뀌면 이미 남의 컨테이너를 지운 뒤다
    await register();
    await pool.start();

    // 채점 환경을 한 번 기록해 둔다. 제출마다 이 id 를 남겨야 시간값을 나중에 해석할 수 있다
    judgeEnvId = await resolveJudgeEnv(db, pool);

    // 큐에 들어오면 폴링 주기를 기다리지 않고 바로 깨어난다.
    // 연결이 끊기면 알림을 놓치지만 POLL_INTERVAL_MS 폴링이 안전망이다
    await pg.listen(QUEUE_CHANNEL, () => poke());

    installSignals();
    void heartbeatLoop();
    void reclaimLoop();

    while (!draining) {
        const slots = config.WORKER_CAPACITY - inFlight.size;
        if (slots > 0) {
            const claimed = await claimNext(db, config.WORKER_ID, slots).catch((e) => {
                log.error("claim failed", { err: String(e) });
                return [] as Submission[];
            });
            for (const sub of claimed) {
                inFlight.add(sub.id);
                void handleOne(sub);
            }
            // 가득 채웠으면 바로 한 번 더 본다. 큐가 밀려 있을 때 폴링 주기만큼 노는 걸 막는다
            if (claimed.length === slots && slots > 0) continue;
        }
        await waitForWork(config.POLL_INTERVAL_MS);
    }

    log.info("draining", { inFlight: inFlight.size });
    while (inFlight.size > 0) await sleep(200);
    await shutdown(0);
}

async function handleOne(sub: Submission): Promise<void> {
    try {
        await judge(db, pool, sub, judgeEnvId);
    } catch (e) {
        await onJudgeFailure(sub, e);
    } finally {
        inFlight.delete(sub.id);
        poke();
    }
}

/**
 * 채점이 예외로 끝난 경우. 시도 횟수가 남았으면 큐로 되돌리고, 다 썼으면 확정한다.
 *
 * KOJ 는 어느 단계에서 실패하든 Nack(requeue=false) 로 메시지를 버리고 internal_error 로
 * 확정해서, 일시적인 docker 오류에도 학생이 다시 제출해야 했다.
 */
async function onJudgeFailure(sub: Submission, e: unknown): Promise<void> {
    const msg = e instanceof Error ? e.message : String(e);
    const giveUp = sub.attempts >= MAX_JUDGE_ATTEMPTS;
    log.error("judge failed", { submission: sub.id, attempts: sub.attempts, giveUp, err: msg });

    try {
        if (giveUp) {
            await db
                .update(submissions)
                .set({
                    status: "done",
                    verdict: "internal_error",
                    judgeError: msg.slice(0, 4000),
                    judgedAt: new Date(),
                    claimedBy: null,
                    claimedAt: null,
                    heartbeatAt: null,
                })
                .where(eq(submissions.id, sub.id));
        } else {
            await db
                .update(submissions)
                .set({
                    status: "queued",
                    judgeError: msg.slice(0, 4000),
                    claimedBy: null,
                    claimedAt: null,
                    heartbeatAt: null,
                    queuedAt: new Date(),
                })
                .where(eq(submissions.id, sub.id));
            await db.execute(sql`SELECT pg_notify(${QUEUE_CHANNEL}, '')`);
        }
    } catch (e2) {
        // DB 까지 안 되면 손 쓸 게 없다. lease 가 끊겨 다른 워커가 회수하도록 둔다
        log.error("failed to record judge failure", { submission: sub.id, err: String(e2) });
    }
}

/** 큐에 일이 생기거나 timeout 이 지날 때까지 대기 */
function waitForWork(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
        const t = setTimeout(done, timeoutMs);
        wake = done;
        function done() {
            clearTimeout(t);
            wake = null;
            resolve();
        }
    });
}

async function heartbeatLoop(): Promise<void> {
    while (true) {
        await sleep(JUDGE_HEARTBEAT_INTERVAL_MS);
        try {
            await heartbeat(db, config.WORKER_ID, [...inFlight]);
            await db
                .update(judgeWorkers)
                .set({ lastSeenAt: new Date(), busy: inFlight.size })
                .where(eq(judgeWorkers.id, config.WORKER_ID));
        } catch (e) {
            log.warn("heartbeat failed", { err: String(e) });
        }
    }
}

/**
 * 죽은 워커가 물고 있던 제출 회수. 워커가 여럿이면 다 같이 돌리지만
 * UPDATE 가 원자적이라 한 행을 두 워커가 회수하지 않는다.
 */
async function reclaimLoop(): Promise<void> {
    while (true) {
        await sleep(JUDGE_HEARTBEAT_INTERVAL_MS * 2);
        try {
            const n = await reclaimStale(db);
            if (n > 0) log.warn("reclaimed stale submissions", { count: n });
        } catch (e) {
            log.warn("reclaim failed", { err: String(e) });
        }
    }
}

/**
 * 같은 WORKER_ID 로 도는 워커가 이미 있으면 뜨지 않는다.
 *
 * 러너 컨테이너 이름과 isolate 박스 id 가 WORKER_ID 로 갈리므로, 두 워커가 같은 id 를 쓰면
 * 서로의 컨테이너를 지우고 다시 만들며 상대가 채점하던 제출을 죽인다. 로그만 보면
 * "컨테이너가 사라졌다"로 보여서 원인을 찾기가 아주 나쁘다.
 *
 * 한 호스트에 워커를 여럿 띄우려면 WORKER_ID 와 BOX_ID_BASE 를 워커마다 달리 줘야 한다.
 */
async function ensureNotDuplicate(): Promise<void> {
    const [existing] = await db
        .select()
        .from(judgeWorkers)
        .where(eq(judgeWorkers.id, config.WORKER_ID));
    if (!existing) return;

    const silentMs = Date.now() - existing.lastSeenAt.getTime();
    if (silentMs >= JUDGE_LEASE_TIMEOUT_MS) return; // 죽은 워커의 흔적이다. 이어받는다

    throw new Error(
        `WORKER_ID '${config.WORKER_ID}' 로 도는 워커가 이미 있습니다 ` +
            `(${existing.hostname}, 마지막 신호 ${Math.round(silentMs / 1000)}초 전).\n` +
            `  그 워커를 먼저 정리하거나, 이 워커의 WORKER_ID 와 BOX_ID_BASE 를 다르게 주세요.\n` +
            `  같은 id 로 둘이 뜨면 서로의 러너 컨테이너를 지우며 채점을 망칩니다.`,
    );
}

async function register(): Promise<void> {
    await ensureNotDuplicate();
    await db
        .insert(judgeWorkers)
        .values({
            id: config.WORKER_ID,
            hostname: os.hostname(),
            version: process.env.npm_package_version ?? "dev",
            capacity: config.WORKER_CAPACITY,
            busy: 0,
        })
        .onConflictDoUpdate({
            target: judgeWorkers.id,
            set: {
                hostname: os.hostname(),
                capacity: config.WORKER_CAPACITY,
                busy: 0,
                startedAt: new Date(),
                lastSeenAt: new Date(),
            },
        });
}

/**
 * 종료 신호를 받으면 새 제출을 안 집고 진행 중인 것만 마친다.
 * KOJ 워커는 시그널 처리가 없어 즉사했고, 띄워 둔 채점 컨테이너가 dockerd 아래 고아로 남았다.
 * 여기서는 러너 컨테이너가 이 프로세스 소유라 stop 에서 같이 정리된다.
 */
function installSignals(): void {
    let forced = false;
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
        process.on(sig, () => {
            if (forced) {
                log.warn("forced exit");
                process.exit(1);
            }
            if (draining) {
                forced = true;
                log.warn("한 번 더 누르면 진행 중인 채점을 버리고 즉시 종료합니다");
                return;
            }
            log.info("shutdown requested", { signal: sig, inFlight: inFlight.size });
            draining = true;
            poke();
        });
    }
}

async function shutdown(code: number): Promise<void> {
    try {
        await db.delete(judgeWorkers).where(eq(judgeWorkers.id, config.WORKER_ID));
    } catch {
        // 지우기 실패해도 lastSeenAt 이 늙어서 화면에서 죽은 걸로 보인다
    }
    await pool.stop().catch(() => {});
    await handle.close().catch(() => {});
    log.info("stopped");
    process.exit(code);
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

main().catch(async (e) => {
    log.error("fatal", { err: e instanceof Error ? e.stack : String(e) });
    await shutdown(1);
});
