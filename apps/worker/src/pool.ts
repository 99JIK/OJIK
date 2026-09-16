import path from "node:path";
import fs from "node:fs/promises";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { RUNNER_IDS, type RunnerId } from "@ojik/core";
import { config, dockerEndpoints } from "./config";
import { log } from "./log";
import * as isolate from "./isolate";

/**
 * 상주 러너 풀.
 *
 * KOJ 는 제출 한 건마다 docker run 으로 2GB 짜리 단일 이미지를 새로 띄웠다.
 * 여기서는 언어별 컨테이너를 미리 올려 두고 isolate 박스만 빌려준다.
 * 제출당 비용이 "컨테이너 기동 + 이미지 레이어 준비"에서 "디렉터리 하나 만들기"로 바뀐다.
 *
 * 컨테이너 안에는 우리 코드가 없다. 컴파일러와 isolate 뿐이다.
 * 채점 로직은 전부 호스트의 이 프로세스에 있고, 컨테이너로는 exec 만 보낸다.
 */

/**
 * 쓸 수 있는 박스 id 상한. images/runner/Dockerfile.base 의 num_boxes 와 같아야 한다.
 * 그 값을 올리면 여기도 올려야 하고, 반대로 여기만 올리면 isolate 가 거부한다.
 */
const MAX_BOX_ID = 1000;

export interface Box {
    runner: RunnerId;
    containerKey: string;
    boxId: number;
    /** 호스트에서 본 박스 작업 디렉터리. isolate 안에서는 /box 다 */
    hostDir: string;
    /** 호스트에서 본 meta 파일 자리. 박스 밖이라야 프로그램이 못 건드린다 */
    hostMetaDir: string;
}

interface ContainerSlot {
    key: string;
    runner: RunnerId;
    container: Docker.Container;
    /** 이 컨테이너 전용 박스 루트. 컨테이너마다 따로 둬야 box id 가 안 겹친다 */
    hostBoxRoot: string;
}

interface Waiter {
    resolve: (b: Box) => void;
    reject: (e: unknown) => void;
}

export class RunnerPool {
    private docker: Docker;
    private slots = new Map<RunnerId, ContainerSlot[]>();
    private free = new Map<RunnerId, Box[]>();
    private waiters = new Map<RunnerId, Waiter[]>();
    /** 못 띄운 러너와 그 사유. 해당 언어 제출이 왔을 때 그대로 알려준다 */
    private unavailable = new Map<RunnerId, string>();
    private boxesPerContainer: number;

    constructor() {
        // 실제 연결은 start() 에서 확인한다. 여기서는 첫 후보로 만들어만 둔다
        this.docker = new Docker(dockerEndpoints()[0]);
        // 한 컨테이너가 감당할 박스 수. 워커가 동시에 돌릴 수 있는 최대 실행 수와 맞춘다.
        // 여유 1 은 컴파일 단계가 실행 박스와 겹칠 때를 위한 것
        this.boxesPerContainer =
            Math.ceil((config.WORKER_CAPACITY * config.WORKER_TC_PARALLEL) / config.RUNNER_REPLICAS) + 1;
    }

    /**
     * 러너 하나가 안 떠도 나머지는 살린다.
     *
     * java 이미지가 없다고 C 제출까지 채점을 못 하는 건 말이 안 된다.
     * 못 띄운 러너는 기억해 뒀다가, 그 언어 제출이 왔을 때 사유를 그대로 돌려준다.
     * 전부 실패하면 그때는 기동을 포기한다.
     */
    async start(): Promise<void> {
        await this.connect();

        const needed = RUNNER_IDS.length * config.RUNNER_REPLICAS * this.boxesPerContainer;
        if (config.BOX_ID_BASE + needed > MAX_BOX_ID) {
            throw new Error(
                `박스 id 가 모자랍니다. BOX_ID_BASE(${config.BOX_ID_BASE}) + 필요 ${needed} > ${MAX_BOX_ID}. ` +
                    `WORKER_CAPACITY 나 WORKER_TC_PARALLEL 을 줄이거나 러너 이미지의 num_boxes 를 늘리세요.`,
            );
        }

        // 박스 id 를 러너와 replica 를 가로질러 전역으로 센다.
        // 컨테이너마다 0 부터 다시 시작하면 샌드박스 uid 가 겹쳐서, 한 언어의 프로세스 사용량이
        // 다른 언어의 제출을 EAGAIN 으로 죽인다. 자세한 건 config.ts 의 BOX_ID_BASE 주석
        let nextBoxId = config.BOX_ID_BASE;

        for (const runner of RUNNER_IDS) {
            try {
                const slots: ContainerSlot[] = [];
                const boxes: Box[] = [];
                for (let r = 0; r < config.RUNNER_REPLICAS; r++) {
                    const key = `${runner}-${r}`;
                    const slot = await this.ensureContainer(runner, key);
                    slots.push(slot);
                    for (let b = 0; b < this.boxesPerContainer; b++) {
                        const boxId = nextBoxId++;
                        boxes.push({
                            runner,
                            containerKey: key,
                            boxId,
                            hostDir: path.join(slot.hostBoxRoot, String(boxId), "box"),
                            hostMetaDir: path.join(slot.hostBoxRoot, String(boxId)),
                        });
                    }
                }
                this.slots.set(runner, slots);
                this.free.set(runner, boxes);
                this.waiters.set(runner, []);
                log.info("runner ready", { runner, containers: slots.length, boxes: boxes.length });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.unavailable.set(runner, msg);
                log.error("runner unavailable", { runner, err: msg });
            }
        }

        if (this.slots.size === 0) {
            throw new Error(
                `러너를 하나도 띄우지 못했습니다. 'npm run runners:build' 와 'npm run smoke:judge' 를 먼저 돌리세요.\n` +
                    [...this.unavailable].map(([r, m]) => `  ${r}: ${m}`).join("\n"),
            );
        }
        if (this.unavailable.size > 0) {
            log.warn("일부 언어는 채점할 수 없습니다", { runners: [...this.unavailable.keys()] });
        }
    }

    /** 붙을 수 있는 docker 엔드포인트를 찾는다. 못 찾으면 어디를 시도했는지 알려준다 */
    private async connect(): Promise<void> {
        const tried: string[] = [];
        for (const ep of dockerEndpoints()) {
            const d = new Docker(ep);
            try {
                await d.ping();
                this.docker = d;
                log.info("docker connected", { endpoint: ep.socketPath });
                return;
            } catch (e) {
                tried.push(`${ep.socketPath}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        throw new Error(
            ["docker 엔진에 붙지 못했습니다. Docker Desktop 이 실행 중인지 확인하세요.", ...tried].join(
                "\n  ",
            ),
        );
    }

    /** 채점 가능한 러너 목록. 헬스체크나 진단에 쓴다 */
    availableRunners(): RunnerId[] {
        return [...this.slots.keys()];
    }

    /**
     * 지금 채점에 쓰이는 환경을 적는다. 이미지 다이제스트에 컴파일러 버전이 담긴다.
     * 태그(latest)가 아니라 다이제스트를 보는 이유는 같은 태그로 내용이 바뀌기 때문이다.
     */
    async describeEnvironment(): Promise<{ runnerImages: string; isolateVersion: string }> {
        const images: string[] = [];
        for (const runner of [...this.slots.keys()].sort()) {
            const tag = `${config.RUNNER_IMAGE_PREFIX}-${runner}:latest`;
            try {
                const info = await this.docker.getImage(tag).inspect();
                const digest = info.RepoDigests?.[0] ?? info.Id;
                images.push(`${runner}=${digest}`);
            } catch {
                images.push(`${runner}=unknown`);
            }
        }

        let isolateVersion = "";
        const firstSlots = [...this.slots.values()][0];
        const slot = firstSlots?.[0];
        if (slot) {
            try {
                const r = await this.execOnce(
                    { runner: slot.runner, containerKey: slot.key, boxId: 0, hostDir: "", hostMetaDir: "" },
                    ["isolate", "--version"],
                );
                isolateVersion = r.stdout.split("\n")[0]?.trim() ?? "";
            } catch {
                // 못 읽어도 나머지는 남긴다
            }
        }

        return { runnerImages: images.join(" "), isolateVersion };
    }

    private async ensureContainer(runner: RunnerId, key: string): Promise<ContainerSlot> {
        // 워커 id 를 이름에 넣는다. 한 호스트에 워커를 여럿 띄우면 이게 없을 때
        // 서로 같은 이름의 컨테이너를 지우고 다시 만들며 상대의 채점을 죽인다.
        // 박스 루트도 같은 이유로 워커별로 갈라야 한다
        const name = `${config.RUNNER_CONTAINER_PREFIX}-${config.WORKER_ID}-${key}`;
        const image = `${config.RUNNER_IMAGE_PREFIX}-${runner}:latest`;
        const hostBoxRoot = path.join(config.BOX_ROOT, config.WORKER_ID, key);

        await fs.mkdir(hostBoxRoot, { recursive: true });

        // 이전에 뜬 게 있으면 지우고 새로 만든다. 재사용하면 박스 상태가 어중간하게 남는다
        const existing = this.docker.getContainer(name);
        try {
            await existing.remove({ force: true });
            log.debug("removed stale runner container", { name });
        } catch {
            // 없으면 그만
        }

        const container = await this.docker.createContainer({
            name,
            Image: image,
            Cmd: ["sleep", "infinity"],
            HostConfig: {
                // isolate 는 마운트 네임스페이스와 cgroup 을 직접 다룬다. 권한이 필요하다.
                // 바깥 경계가 이만큼 약해지는 대신 안쪽은 isolate 가 막는다.
                // 이 절충이 부담스러우면 docs/judge-pipeline.md 의 보안 경계 절을 볼 것
                Privileged: true,
                NetworkMode: "none",
                Binds: [
                    `${hostBoxRoot}:/var/local/lib/isolate`,
                    // 테스트케이스는 읽기 전용으로 붙인다. 제출마다 복사하지 않는다.
                    // KOJ 가 제출마다 TC 전체를 cp -r 한 게 static 46GB 의 주범이었다
                    `${path.join(config.DATA_DIR, "problems")}:/problems:ro`,
                ],
            },
        });
        await container.start();

        // entrypoint 가 cgroup 위임에 실패하면 컨테이너가 바로 죽는다.
        // 그대로 두면 다음 exec 이 "container not running" 으로 떨어져 진짜 원인을 못 본다
        const info = await container.inspect();
        if (!info.State.Running) {
            const logs = await container
                .logs({ stdout: true, stderr: true, tail: 20 })
                .then((b) => b.toString("utf8"))
                .catch(() => "");
            throw new Error(
                `러너 컨테이너 ${name} 이(가) 기동 직후 종료됐습니다 (exit ${info.State.ExitCode}).\n${logs}`,
            );
        }

        return { key, runner, container, hostBoxRoot };
    }

    /** 박스 하나를 빌린다. 없으면 반납될 때까지 기다린다 */
    async acquire(runner: RunnerId): Promise<Box> {
        const pool = this.free.get(runner);
        if (!pool) {
            const why = this.unavailable.get(runner);
            // 여기서 던진 메시지가 제출의 judge_error 에 그대로 들어간다. 운영자가 읽을 문장이어야 한다
            throw new Error(
                why
                    ? `${runner} 러너를 쓸 수 없습니다: ${why}`
                    : `알 수 없는 러너: ${runner}`,
            );
        }
        const box = pool.pop();
        if (box) {
            try {
                await this.initBox(box);
            } catch (e) {
                // 여기서 그냥 던지면 박스가 free 목록에서 빠진 채로 영영 사라진다.
                // 몇 번 반복되면 풀이 말라 워커가 아무것도 못 집는 상태가 된다
                pool.push(box);
                throw e;
            }
            return box;
        }
        return new Promise<Box>((resolve, reject) => {
            this.waiters.get(runner)!.push({ resolve, reject });
        });
    }

    async release(box: Box): Promise<void> {
        try {
            await this.exec(box, ["isolate", ...isolate.cleanupArgs(box.boxId)]);
        } catch (e) {
            log.warn("box cleanup failed", { box: box.boxId, runner: box.runner, err: String(e) });
        }
        const waiter = this.waiters.get(box.runner)!.shift();
        if (!waiter) {
            this.free.get(box.runner)!.push(box);
            return;
        }
        try {
            await this.initBox(box);
            waiter.resolve(box);
        } catch (e) {
            // 기다리던 쪽을 깨우지 않으면 그 제출이 영원히 매달린다.
            // 에러로 깨워서 재시도 경로를 타게 한다
            this.free.get(box.runner)!.push(box);
            waiter.reject(e);
        }
    }

    private async initBox(box: Box): Promise<void> {
        // init 전에 cleanup 을 한 번 더 친다. 앞선 실행이 비정상 종료해 남은 게 있을 수 있다
        await this.exec(box, ["isolate", ...isolate.cleanupArgs(box.boxId)]).catch(() => {});
        const r = await this.exec(box, ["isolate", ...isolate.initArgs(box.boxId)]);
        if (r.exitCode !== 0) {
            throw new Error(`isolate --init failed (box ${box.boxId}): ${r.stderr || r.stdout}`);
        }
    }

    /**
     * 컨테이너 안에서 명령 하나 실행. docker CLI 프로세스를 띄우지 않고 소켓으로 직접 간다.
     *
     * 컨테이너가 사라졌으면 한 번 다시 만들고 재시도한다.
     * docker system prune 이나 Docker 재시작으로 실제로 일어나는 일이고, 그대로 두면
     * 워커가 좀비로 남아 집어 가는 제출마다 internal_error 를 찍는다. 재시도가 아니라
     * 복구가 필요한 상황이다.
     */
    async exec(box: Box, argv: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        try {
            return await this.execOnce(box, argv);
        } catch (e) {
            if (!isContainerGone(e)) throw e;

            /**
             * 컨테이너가 사라졌으면 여기서 다시 만들지 않는다.
             *
             * 한 번 시도했다가 뺐다. 컨테이너를 새로 만들면 그 안의 박스가 전부 비는데,
             * 같은 컨테이너를 쓰던 다른 채점이 그걸 모르고 계속 돌다가 "사라졌다"를 만나
             * 또 다시 만들려 든다. 그 연쇄가 이름 충돌(409)로 번져서, 원래 막으려던
             * 문제보다 훨씬 자주 실패했다.
             *
             * 컨테이너가 사라지는 건 docker prune 이나 Docker 재시작 같은 운영 조작이다.
             * 드물고, 사람이 워커를 다시 띄우면 끝난다. 여기서는 사유만 분명히 남긴다.
             */
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(
                `러너 컨테이너(${box.containerKey})에 접근하지 못했습니다. 워커를 다시 띄우세요. 원인: ${msg}`,
            );
        }
    }

    private async execOnce(
        box: Box,
        argv: string[],
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        const slot = this.slots.get(box.runner)!.find((s) => s.key === box.containerKey);
        if (!slot) throw new Error(`no container for ${box.containerKey}`);

        const exec = await slot.container.exec({
            Cmd: argv,
            AttachStdout: true,
            AttachStderr: true,
        });
        const stream = await exec.start({ hijack: true, stdin: false });

        const out = new PassThrough();
        const err = new PassThrough();
        slot.container.modem.demuxStream(stream, out, err);

        const outChunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        out.on("data", (c: Buffer) => outChunks.push(c));
        err.on("data", (c: Buffer) => errChunks.push(c));

        await new Promise<void>((resolve, reject) => {
            stream.on("end", resolve);
            stream.on("error", reject);
        });

        const info = await exec.inspect();
        return {
            exitCode: info.ExitCode ?? -1,
            stdout: Buffer.concat(outChunks).toString("utf8"),
            stderr: Buffer.concat(errChunks).toString("utf8"),
        };
    }

    async stop(): Promise<void> {
        for (const slots of this.slots.values()) {
            for (const s of slots) {
                await s.container.remove({ force: true }).catch(() => {});
            }
        }
        this.slots.clear();
        this.free.clear();
    }
}

/**
 * 컨테이너가 없어서 난 오류인지 본다.
 * dockerode 는 statusCode 를 붙여 주지만 경로에 따라 메시지만 오는 경우도 있어 둘 다 본다.
 */
function isContainerGone(e: unknown): boolean {
    const status = (e as { statusCode?: number } | null)?.statusCode;
    if (status === 404) return true;
    const msg = e instanceof Error ? e.message : String(e);
    return /no such container|is not running/i.test(msg);
}
