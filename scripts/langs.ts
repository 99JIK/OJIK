import { LANGUAGES, RUNNER_IDS } from "@ojik/core";

/**
 * 등록된 채점 언어를 표로 찍는다.
 *
 * README 에 목록을 손으로 적으면 언어를 늘릴 때마다 어긋난다. 출처는 languages.ts 하나고
 * 여기는 그걸 읽어서 보여 줄 뿐이다. 러너 열은 어떤 이미지를 빌드해야 하는지도 겸한다.
 */
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));

const w = {
    id: Math.max(2, ...LANGUAGES.map((l) => l.id.length)),
    label: Math.max(4, ...LANGUAGES.map((l) => l.label.length)),
    runner: Math.max(6, ...LANGUAGES.map((l) => l.runner.length)),
};

console.log(`${pad("id", w.id)}  ${pad("이름", w.label)}  ${pad("러너", w.runner)}  컴파일`);
console.log("-".repeat(w.id + w.label + w.runner + 14));
for (const l of LANGUAGES) {
    console.log(
        `${pad(l.id, w.id)}  ${pad(l.label, w.label)}  ${pad(l.runner, w.runner)}  ${l.compile ? "예" : "아니오"}`,
    );
}

console.log(`\n언어 ${LANGUAGES.length}종, 러너 이미지 ${RUNNER_IDS.length}종`);
console.log(`러너: ${RUNNER_IDS.join(", ")}`);
