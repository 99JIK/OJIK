import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "@ojik/core/env";
import { requireLanguage, effectiveRunLimits, resolveRunArgv } from "@ojik/core";
import * as isolate from "../apps/worker/src/isolate";
import { docker, imageExists, removeContainer } from "./docker";

/**
 * isolate 호출 규약이 실물에서 먹는지 확인한다.
 *
 * apps/worker/src/isolate.ts 의 플래그 집합은 문서를 보고 쓴 것이라, 이미지를 실제로 빌드해
 * 돌려 보기 전까지는 가정이다. 이 스크립트가 그 가정을 검증한다.
 *
 * 중요한 점: 인자를 손으로 베끼지 않고 워커가 쓰는 runArgs / parseMeta / classify 를
 * 그대로 부른다. 사본을 검증하면 원본이 바뀔 때 테스트가 거짓 통과한다.
 *
 * 러너 이미지 태그나 isolate 버전을 올리면 반드시 먼저 돌릴 것.
 * DB 도 API 도 필요 없다. 컨테이너 하나만 띄운다.
 */

loadEnv();

const prefix = process.env.RUNNER_IMAGE_PREFIX ?? "ojik-runner";
const image = `${prefix}-c-cpp:latest`;
const name = `ojik-smoke-${process.pid}`;
const BOX = 0;

let pass = 0;
let fail = 0;
const ok = (m: string) => {
    console.log(`  [OK]   ${m}`);
    pass++;
};
const bad = (m: string, detail = "") => {
    console.log(`  [FAIL] ${m}${detail ? "\n         " + detail.trim().split("\n").join("\n         ") : ""}`);
    fail++;
};

const x = (args: string[], input?: string) =>
    docker(["exec", ...(input !== undefined ? ["-i"] : []), name, ...args], input !== undefined ? { input } : {});

/** 박스 안 파일 읽기. 없으면 빈 문자열 */
const boxRead = async (p: string) => (await x(["cat", `/var/local/lib/isolate/${BOX}/${p}`])).stdout;

async function main() {
    if (!(await imageExists(image))) {
        console.error(`이미지 ${image} 가 없습니다. 먼저 'npm run runners:build' 를 돌리세요.`);
        process.exit(1);
    }

    console.log("== 러너 컨테이너 기동 ==");
    await removeContainer(name);
    const up = await docker([
        "run",
        "-d",
        "--name",
        name,
        // isolate 가 마운트 네임스페이스와 cgroup 을 직접 다룬다
        "--privileged",
        "--network",
        "none",
        image,
        "sleep",
        "infinity",
    ]);
    if (up.code !== 0) {
        console.error(`컨테이너 기동 실패:\n${up.stderr || up.stdout}`);
        process.exit(1);
    }
    ok(`컨테이너 기동 (${image})`);

    console.log("\n== isolate 환경 점검 ==");
    const env = await x(["isolate-check-environment", "--quiet"]);
    if (env.code === 0) ok("isolate-check-environment 통과");
    // 실패해도 치명적이진 않다. 호스트 커널 설정 권고까지 보기 때문. 아래 결과가 더 중요하다
    else console.log("  [WARN] isolate-check-environment 경고. 아래 실제 동작 결과를 보세요");

    console.log("\n== 박스 생성 ==");
    await x(["isolate", ...isolate.cleanupArgs(BOX)]);
    const init = await x(["isolate", ...isolate.initArgs(BOX)]);
    if (init.code !== 0) {
        bad("--cg --init 실패", init.stderr || init.stdout);
        console.error(
            "\nisolate 2.x 는 --cg 를 없앴습니다. images/runner/Dockerfile.base 의 ISOLATE_VERSION 과",
        );
        console.error("apps/worker/src/isolate.ts 의 플래그가 맞는지 확인하세요.");
        await removeContainer(name);
        process.exit(1);
    }
    ok(`--cg --init 동작 (box: ${init.stdout.trim()})`);

    const lang = requireLanguage("c");
    const SRC = `#include <stdio.h>
int main(void){ int a,b; if(scanf("%d %d",&a,&b)!=2) return 1; printf("%d\\n",a+b); return 0; }
`;

    console.log("\n== 컴파일 ==");
    await x(["sh", "-c", `cat > /var/local/lib/isolate/${BOX}/box/${lang.sourceName}`], SRC);
    const cArgs = isolate.runArgs({
        boxId: BOX,
        argv: lang.compile!.argv,
        limits: lang.compile!.limits,
        stdoutFile: "compile.out",
        stderrFile: "compile.err",
        metaPath: `/var/local/lib/isolate/${BOX}/compile.meta`,
        fsizeKb: 128 * 1024,
    });
    await x(["isolate", ...cArgs]);
    const cMeta = isolate.parseMeta(await boxRead("compile.meta"));
    const cOutcome = isolate.classify(cMeta, lang.compile!.limits);
    if (cOutcome === "ok" && (await x(["test", "-x", `/var/local/lib/isolate/${BOX}/box/Main`])).code === 0) {
        ok("컴파일 성공, 산출물 생성됨");
    } else {
        bad(`컴파일 실패 (${cOutcome})`, await boxRead("box/compile.err"));
    }

    const limits = effectiveRunLimits(lang, 1000, 256);
    const argv = resolveRunArgv(lang, 256);
    const runOnce = async (metaName: string) => {
        await x(["rm", "-f", `/var/local/lib/isolate/${BOX}/box/stdout`, `/var/local/lib/isolate/${BOX}/box/stderr`]);
        await x([
            "isolate",
            ...isolate.runArgs({
                boxId: BOX,
                argv,
                limits,
                stdinFile: "stdin",
                stdoutFile: "stdout",
                stderrFile: "stderr",
                metaPath: `/var/local/lib/isolate/${BOX}/${metaName}`,
                fsizeKb: 32 * 1024,
            }),
        ]);
        return isolate.parseMeta(await boxRead(metaName));
    };

    console.log("\n== 정상 실행 ==");
    await x(["sh", "-c", `printf '3 4\\n' > /var/local/lib/isolate/${BOX}/box/stdin`]);
    const meta = await runOnce("run.meta");
    const out = (await boxRead("box/stdout")).trim();
    out === "7" ? ok("3 4 -> 7") : bad("출력이 7 이 아님", `실제: ${JSON.stringify(out)}`);
    isolate.classify(meta, limits) === "ok"
        ? ok("판정 ok")
        : bad(`정상 실행인데 판정이 ${isolate.classify(meta, limits)}`, JSON.stringify(meta));

    const raw = await boxRead("run.meta");
    raw.includes("time:") ? ok("meta 에 time 있음") : bad("meta 에 time 없음", raw);
    // cg-mem 이 없으면 max-rss 로 대체되는데, 그건 메모리 초과 판정을 흔든다
    raw.includes("cg-mem:")
        ? ok("meta 에 cg-mem 있음")
        : bad("meta 에 cg-mem 없음. 메모리 판정이 max-rss 로 대체됨", raw);

    console.log("\n== 시간 초과 감지 ==");
    await x(["sh", "-c", `cat > /var/local/lib/isolate/${BOX}/box/Main.c`], "int main(void){ for(;;); }\n");
    await x([
        "isolate",
        ...isolate.runArgs({
            boxId: BOX,
            argv: lang.compile!.argv,
            limits: lang.compile!.limits,
            stdoutFile: "compile.out",
            stderrFile: "compile.err",
            metaPath: `/var/local/lib/isolate/${BOX}/c2.meta`,
            fsizeKb: 128 * 1024,
        }),
    ]);
    const toMeta = await runOnce("to.meta");
    const toVerdict = isolate.classify(toMeta, limits);
    toVerdict === "time_limit_exceeded"
        ? ok(`무한 루프가 time_limit_exceeded 로 잡힘 (${Math.round(toMeta.time * 1000)}ms)`)
        : bad(`무한 루프 판정이 ${toVerdict}`, JSON.stringify(toMeta));

    console.log("\n== 메모리 초과 감지 ==");
    await x(
        ["sh", "-c", `cat > /var/local/lib/isolate/${BOX}/box/Main.c`],
        `#include <stdlib.h>
#include <string.h>
int main(void){
    for(int i=0;i<4096;i++){ void*p=malloc(1<<20); if(!p) return 1; memset(p,1,1<<20); }
    return 0;
}
`,
    );
    await x([
        "isolate",
        ...isolate.runArgs({
            boxId: BOX,
            argv: lang.compile!.argv,
            limits: lang.compile!.limits,
            stdoutFile: "compile.out",
            stderrFile: "compile.err",
            metaPath: `/var/local/lib/isolate/${BOX}/c3.meta`,
            fsizeKb: 128 * 1024,
        }),
    ]);
    const mlMeta = await runOnce("ml.meta");
    const mlVerdict = isolate.classify(mlMeta, limits);
    // 4GB 를 잡으려 하는데 상한은 256MB. MLE 나 RE 로 끊기면 cgroup 제한이 살아 있는 것
    mlVerdict === "memory_limit_exceeded" || mlVerdict === "runtime_error"
        ? ok(`메모리 폭주가 ${mlVerdict} 로 끊김 (최대 ${Math.round(mlMeta.memoryKb / 1024)}MB)`)
        : bad(`메모리 폭주 판정이 ${mlVerdict}`, JSON.stringify(mlMeta));

    console.log("\n== 정리 ==");
    (await x(["isolate", ...isolate.cleanupArgs(BOX)])).code === 0 ? ok("--cleanup 동작") : bad("--cleanup 실패");

    await removeContainer(name);
    await bindMountCheck();
    await uidIsolationCheck();
}

/**
 * 러너 컨테이너끼리 샌드박스 uid 가 안 겹치는지 본다.
 *
 * isolate 의 샌드박스 uid 는 first_uid + box_id 다. privileged 컨테이너는 호스트 uid 공간을
 * 공유하므로, 컨테이너가 달라도 박스 id 가 같으면 같은 uid 를 쓴다. RLIMIT_NPROC 은 uid 단위라
 * java 가 스레드를 많이 띄우면 같은 uid 를 쓰는 python 제출이 execve 에서 EAGAIN 으로 죽는다.
 *
 * 한 번 돌려서는 안 보인다. 그래서 부하를 걸고 반복해서 잰다.
 * 워커는 박스 id 를 전역으로 배분해 이걸 피한다 (apps/worker/src/pool.ts).
 */
async function uidIsolationCheck() {
    console.log("\n== 러너 간 uid 격리 ==");
    const pyImage = `${prefix}-python:latest`;
    const jvImage = `${prefix}-java:latest`;
    if (!(await imageExists(pyImage)) || !(await imageExists(jvImage))) {
        console.log("  [SKIP] python 과 java 이미지가 둘 다 있어야 검사합니다");
        return;
    }

    const py = `${name}-py`;
    const jv = `${name}-jv`;
    for (const [n, img] of [
        [py, pyImage],
        [jv, jvImage],
    ] as const) {
        await removeContainer(n);
        await docker(["run", "-d", "--name", n, "--privileged", "--network", "none", img, "sleep", "infinity"]);
    }
    const pe = (a: string[], i?: string) =>
        docker(["exec", ...(i !== undefined ? ["-i"] : []), py, ...a], i !== undefined ? { input: i } : {});
    const je = (a: string[], i?: string) =>
        docker(["exec", ...(i !== undefined ? ["-i"] : []), jv, ...a], i !== undefined ? { input: i } : {});

    // java: 박스 0 에서 스레드를 많이 띄운다
    await je(["isolate", ...isolate.cleanupArgs(0)]);
    await je(["isolate", ...isolate.initArgs(0)]);
    await je(
        ["sh", "-c", "cat > /var/local/lib/isolate/0/box/Main.java"],
        "public class Main { public static void main(String[] a) throws Exception {" +
            " for (int i=0;i<60;i++) new Thread(() -> { try { Thread.sleep(4000); } catch (Exception e) {} }).start();" +
            " Thread.sleep(4000); } }\n",
    );
    const jLang = requireLanguage("java");
    await je(["isolate", ...isolate.runArgs({
        boxId: 0, argv: jLang.compile!.argv, limits: jLang.compile!.limits,
        stdoutFile: "c.out", stderrFile: "c.err",
        metaPath: "/var/local/lib/isolate/0/c.meta", fsizeKb: 128 * 1024,
    })]);

    const pyLang = requireLanguage("python3");
    const pyLimits = effectiveRunLimits(pyLang, 1000, 256);

    // 박스 0 (java 와 같은 uid) 과 박스 50 (다른 uid) 을 같은 부하에서 비교한다
    const results: Record<number, number> = {};
    for (const box of [0, 50]) {
        await pe(["isolate", ...isolate.cleanupArgs(box)]);
        await pe(["isolate", ...isolate.initArgs(box)]);
        await pe(["sh", "-c", `cat > /var/local/lib/isolate/${box}/box/Main.py`], "a,b=map(int,input().split())\nprint(a+b)\n");
        await pe(["sh", "-c", `printf '3 4\\n' > /var/local/lib/isolate/${box}/box/stdin`]);

        const load = je(["isolate", ...isolate.runArgs({
            boxId: 0, argv: ["/usr/bin/java", "-XX:+UseSerialGC", "Main"],
            limits: { timeMs: 30000, wallMs: 60000, memoryKb: 512 * 1024, procLimit: 200 },
            stdoutFile: "stdout", stderrFile: "stderr",
            metaPath: "/var/local/lib/isolate/0/r.meta", fsizeKb: 32 * 1024,
        })]);
        await new Promise((r) => setTimeout(r, 1500));

        let fails = 0;
        for (let i = 0; i < 10; i++) {
            await pe(["rm", "-f", `/var/local/lib/isolate/${box}/box/stdout`]);
            await pe(["isolate", ...isolate.runArgs({
                boxId: box, argv: resolveRunArgv(pyLang, 256), limits: pyLimits,
                stdinFile: "stdin", stdoutFile: "stdout", stderrFile: "stderr",
                metaPath: `/var/local/lib/isolate/${box}/m.meta`, fsizeKb: 32 * 1024,
            })]);
            const got = (await pe(["cat", `/var/local/lib/isolate/${box}/box/stdout`])).stdout.trim();
            if (got !== "7") fails++;
        }
        await load;
        results[box] = fails;
        await pe(["isolate", ...isolate.cleanupArgs(box)]);
    }

    // 겹친 uid 에서만 실패가 나야 한다. 둘 다 0 이면 이 커널에서는 재현이 안 되는 것이고,
    // 둘 다 실패하면 uid 말고 다른 원인이 있다는 뜻이다
    if (results[50] !== 0) {
        bad(`uid 를 갈랐는데도 실패 ${results[50]}/10. uid 충돌 말고 다른 원인이 있습니다`);
    } else if (results[0] !== 0) {
        ok(`uid 충돌이 재현됨 (같은 uid ${results[0]}/10 실패, 다른 uid 0/10). 워커의 전역 박스 id 배분이 필요함`);
    } else {
        ok("이 커널에서는 uid 충돌이 재현되지 않음 (그래도 워커는 박스 id 를 전역으로 배분함)");
    }

    for (const n of [py, jv]) await removeContainer(n);
}

/**
 * 워커가 실제로 쓰는 경로 검증.
 *
 * 워커는 BOX_ROOT 를 컨테이너의 /var/local/lib/isolate 에 bind mount 하고, 박스 파일을
 * 호스트에서 직접 읽고 쓴다. 위 테스트는 컨테이너 자체 파일시스템만 봤으므로 이걸 따로 본다.
 *
 * Windows 에서 특히 중요하다. Docker Desktop 의 bind mount 는 소유권 개념이 없어서
 * isolate 가 박스 디렉터리를 자기 uid 로 만들지 못할 수 있다.
 */
async function bindMountCheck() {
    console.log("\n== bind mount 경로 (워커가 실제로 쓰는 방식) ==");
    const boxRoot = process.env.BOX_ROOT;
    if (!boxRoot) {
        bad("BOX_ROOT 가 설정되지 않음", ".env 를 확인하세요");
        return;
    }
    const hostDir = path.join(boxRoot, "smoke");
    await fs.mkdir(hostDir, { recursive: true });

    const bName = `${name}-bind`;
    await removeContainer(bName);
    const up = await docker([
        "run",
        "-d",
        "--name",
        bName,
        "--privileged",
        "--network",
        "none",
        "-v",
        `${hostDir}:/var/local/lib/isolate`,
        image,
        "sleep",
        "infinity",
    ]);
    if (up.code !== 0) {
        bad("bind mount 컨테이너 기동 실패", up.stderr || up.stdout);
        return;
    }

    const bx = (args: string[]) => docker(["exec", bName, ...args]);
    await bx(["isolate", ...isolate.cleanupArgs(BOX)]);
    const init = await bx(["isolate", ...isolate.initArgs(BOX)]);
    if (init.code !== 0) {
        bad("bind mount 위에서 isolate --init 실패", init.stderr || init.stdout);
        console.log(
            "         Windows 라면 BOX_ROOT 를 WSL2 안의 리눅스 경로로 두세요. docs/development.md 참고",
        );
        await removeContainer(bName);
        return;
    }
    ok("bind mount 위에서 --init 동작");

    // 워커는 소스를 호스트에서 직접 쓴다
    const srcPath = path.join(hostDir, String(BOX), "box", "probe.txt");
    try {
        await fs.writeFile(srcPath, "from-host\n");
        ok("호스트에서 박스에 파일 쓰기 가능");
    } catch (e) {
        bad("호스트에서 박스에 파일을 못 씀", String(e));
        await removeContainer(bName);
        return;
    }

    const seen = await bx(["cat", `/var/local/lib/isolate/${BOX}/box/probe.txt`]);
    seen.stdout.trim() === "from-host"
        ? ok("컨테이너에서 그 파일이 보임")
        : bad("컨테이너가 호스트가 쓴 파일을 못 봄", seen.stderr || seen.stdout);

    // 워커는 isolate 가 만든 결과 파일을 호스트에서 직접 읽는다
    await bx(["sh", "-c", `echo from-container > /var/local/lib/isolate/${BOX}/box/back.txt`]);
    try {
        const back = await fs.readFile(path.join(hostDir, String(BOX), "box", "back.txt"), "utf8");
        back.trim() === "from-container"
            ? ok("호스트에서 컨테이너가 쓴 파일이 보임")
            : bad("내용이 다름", back);
    } catch (e) {
        // 이게 실패하면 워커가 채점 결과를 못 읽는다. 전 제출이 internal_error 가 된다
        bad("호스트에서 컨테이너가 쓴 파일을 못 읽음", String(e));
    }

    /**
     * 여기까지는 셸이 root 로 쓴 파일이다. 진짜 관문은 샌드박스 안 프로세스다.
     * isolate 는 제출 코드를 uid 60000 으로 돌리는데, bind mount 에 소유권 개념이 없으면
     * 그 프로세스가 박스 파일을 못 읽거나 못 쓴다. 채점 전 과정을 마운트 위에서 돌려 본다.
     */
    const lang2 = requireLanguage("c");
    await fs.writeFile(
        path.join(hostDir, String(BOX), "box", lang2.sourceName),
        '#include <stdio.h>\nint main(void){int a,b;if(scanf("%d %d",&a,&b)!=2)return 1;printf("%d\\n",a+b);return 0;}\n',
    );
    await fs.writeFile(path.join(hostDir, String(BOX), "box", "stdin"), "11 31\n");

    await bx([
        "isolate",
        ...isolate.runArgs({
            boxId: BOX,
            argv: lang2.compile!.argv,
            limits: lang2.compile!.limits,
            stdoutFile: "compile.out",
            stderrFile: "compile.err",
            metaPath: `/var/local/lib/isolate/${BOX}/compile.meta`,
            fsizeKb: 128 * 1024,
        }),
    ]);
    const cErr = await fs
        .readFile(path.join(hostDir, String(BOX), "box", "compile.err"), "utf8")
        .catch(() => "");
    const built = await fs
        .stat(path.join(hostDir, String(BOX), "box", "Main"))
        .then(() => true)
        .catch(() => false);
    built
        ? ok("샌드박스가 마운트 위의 소스를 컴파일함")
        : bad("마운트 위에서 컴파일 실패", cErr || "산출물이 없음");

    if (built) {
        const l2 = effectiveRunLimits(lang2, 1000, 256);
        await bx([
            "isolate",
            ...isolate.runArgs({
                boxId: BOX,
                argv: resolveRunArgv(lang2, 256),
                limits: l2,
                stdinFile: "stdin",
                stdoutFile: "stdout",
                stderrFile: "stderr",
                metaPath: `/var/local/lib/isolate/${BOX}/run.meta`,
                fsizeKb: 32 * 1024,
            }),
        ]);
        const got = (
            await fs.readFile(path.join(hostDir, String(BOX), "box", "stdout"), "utf8").catch(() => "")
        ).trim();
        got === "42"
            ? ok("샌드박스 출력을 호스트가 읽음 (11 31 -> 42)")
            : bad("마운트 위 실행 결과가 42 가 아님", `실제: ${JSON.stringify(got)}`);
    }

    await bx(["isolate", ...isolate.cleanupArgs(BOX)]);
    await removeContainer(bName);
    await fs.rm(hostDir, { recursive: true, force: true }).catch(() => {});
}

try {
    await main();
} catch (e) {
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    await removeContainer(name).catch(() => {});
    process.exit(1);
}

console.log(`\n통과 ${pass}, 실패 ${fail}`);
if (fail > 0) {
    console.log("\n실패가 있으면 채점은 반드시 실패합니다. 워커를 띄우기 전에 해결하세요.");
}
process.exit(fail === 0 ? 0 : 1);
