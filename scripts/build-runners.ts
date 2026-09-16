import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNNER_IDS } from "@ojik/core";
import { loadEnv } from "@ojik/core/env";
import { docker, imageExists } from "./docker";

/**
 * 러너 이미지를 전부 빌드한다. 베이스를 먼저 만들고 언어별 이미지가 그 위에 얹힌다.
 *
 * 빌드할 목록은 @ojik/core 의 RUNNER_IDS 에서 가져온다. 언어를 추가할 때 여기까지
 * 따로 고칠 필요가 없게.
 */

loadEnv();

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "images", "runner");
const prefix = process.env.RUNNER_IMAGE_PREFIX ?? "ojik-runner";
const baseTag = `${prefix}-base:latest`;

async function build(dockerfile: string, tag: string, extraArgs: string[] = []): Promise<void> {
    console.log(`\n== ${tag} ==`);
    const r = await docker(
        ["build", "-f", path.join(dir, dockerfile), "-t", tag, ...extraArgs, dir],
        { inherit: true },
    );
    if (r.code !== 0) {
        console.error(`\n${tag} 빌드 실패 (exit ${r.code})`);
        process.exit(1);
    }
}

// 베이스는 isolate 를 소스에서 빌드한다. 처음 한 번은 몇 분 걸린다
await build("Dockerfile.base", baseTag);

for (const runner of RUNNER_IDS) {
    await build(`Dockerfile.${runner}`, `${prefix}-${runner}:latest`, ["--build-arg", `BASE=${baseTag}`]);
}

console.log("\n== 결과 ==");
const fmt = await docker(["images", "--format", "{{.Repository}}:{{.Tag}}\t{{.Size}}"]);
for (const line of fmt.stdout.split("\n")) {
    if (line.startsWith(prefix)) console.log("  " + line.replace("\t", "  "));
}

// 이미지가 다 있어야 워커가 뜬다. 하나라도 없으면 전 제출이 internal_error 가 된다
const missing: string[] = [];
for (const runner of RUNNER_IDS) {
    if (!(await imageExists(`${prefix}-${runner}:latest`))) missing.push(runner);
}
if (missing.length > 0) {
    console.error(`\n빠진 이미지: ${missing.join(", ")}`);
    process.exit(1);
}

console.log("\n다음: npm run smoke:judge");
