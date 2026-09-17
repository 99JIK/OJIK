// 언어 정의의 유일한 출처. API 검증, 워커 실행, 프론트 선택지가 전부 여기서 나온다.
// KOJ 는 같은 정보가 6군데(백엔드 enum, PG enum SQL, 이미지 compile.go, 프론트 타입 2개, 모달 배열)에
// 흩어져 있어서 언어 추가가 실질적으로 불가능했다. 여기 한 항목 추가하면 끝이도록 유지할 것.

/** 컴파일이나 실행 한 스텝의 자원 상한. isolate 에 그대로 넘어간다. */
export interface StepLimits {
    /** CPU 시간 ms. isolate --time */
    timeMs: number;
    /** 벽시계 시간 ms. isolate --wall-time. sleep 으로 CPU 를 안 쓰며 버티는 걸 막음 */
    wallMs: number;
    /** cgroup 메모리 KB. isolate --cg-mem.
     *  주소공간(--mem)이 아니라 cgroup 이라야 JVM 처럼 가상메모리를 크게 잡는 런타임이 정상 동작함 */
    memoryKb: number;
    /** 프로세스/스레드 상한. isolate --processes. JVM 은 GC 스레드 때문에 1 로는 못 뜬다 */
    procLimit: number;
}

export interface CompileSpec {
    argv: string[];
    limits: StepLimits;
    /** 실행 단계로 넘길 산출물. 컴파일 박스에서 실행 박스로 이 파일들만 옮긴다 */
    artifacts: string[];
}

export interface RunSpec {
    /** {memMb} 는 문제 메모리 제한으로 치환됨. JVM 힙 지정에 필요 */
    argv: string[];
    /** 문제 시간 제한에 곱할 비율(%). 인터프리터/VM 언어 보정. 100 이면 그대로 */
    timeFactorPercent: number;
    /** 위 비율 적용 후 더할 고정 ms. 런타임 기동 비용 */
    timeExtraMs: number;
    /** 문제 메모리 제한에 더할 KB. 런타임 자체가 먹는 몫 */
    memoryExtraKb: number;
    procLimit: number;
}

export interface LanguageSpec {
    id: string;
    /** UI 표시 이름 */
    label: string;
    /** 제출 코드를 저장할 파일명. 컴파일/실행 argv 가 이 이름에 의존한다 */
    sourceName: string;
    /** 다운로드 파일 확장자 */
    extension: string;
    /** 어느 상주 러너 이미지에 붙일지. images/runner/ 의 태그와 일치해야 함 */
    runner: RunnerId;
    /** null 이면 인터프리터. 문법 검사조차 안 함 */
    compile: CompileSpec | null;
    run: RunSpec;
    /** CodeMirror 6 언어 확장 선택 키 */
    editorMode: EditorMode;
}

/**
 * CodeMirror 6 에서 고를 문법 확장. 언어마다 하나씩 두지 않고 문법 단위로 묶는다.
 * 여기 없는 값을 쓰면 에디터가 cpp 로 떨어진다. 언어를 늘릴 때 새 문법이 필요하면
 * 이 유니온에 먼저 넣어야 웹이 타입으로 잡아 준다
 */
export type EditorMode = "c" | "cpp" | "python" | "java" | "javascript";

export type RunnerId = "c-cpp" | "python" | "java" | "pypy" | "node";

const COMPILE_LIMITS: StepLimits = {
    timeMs: 10_000,
    wallMs: 20_000,
    memoryKb: 512 * 1024,
    // 컴파일러는 자식 프로세스를 여럿 띄운다. gcc 는 cc1, as, ld 로 갈라짐
    procLimit: 64,
};

export const LANGUAGES: readonly LanguageSpec[] = [
    {
        id: "c",
        label: "C17 (gcc 14)",
        sourceName: "Main.c",
        extension: "c",
        runner: "c-cpp",
        compile: {
            // -static 은 실행 박스에 동적 링커를 안 넣어도 되게 해줌. isolate --dir 설정이 단순해진다
            argv: ["/usr/bin/gcc", "-x", "c", "-std=gnu17", "-O2", "-w", "-static", "-o", "Main", "Main.c", "-lm"],
            limits: COMPILE_LIMITS,
            artifacts: ["Main"],
        },
        run: { argv: ["./Main"], timeFactorPercent: 100, timeExtraMs: 0, memoryExtraKb: 0, procLimit: 1 },
        editorMode: "c",
    },
    {
        id: "cpp",
        label: "C++20 (g++ 14)",
        sourceName: "Main.cc",
        extension: "cc",
        runner: "c-cpp",
        compile: {
            argv: ["/usr/bin/g++", "-x", "c++", "-std=gnu++20", "-O2", "-w", "-static", "-o", "Main", "Main.cc"],
            limits: COMPILE_LIMITS,
            artifacts: ["Main"],
        },
        run: { argv: ["./Main"], timeFactorPercent: 100, timeExtraMs: 0, memoryExtraKb: 0, procLimit: 1 },
        editorMode: "cpp",
    },
    {
        // 표준만 다르고 이미지는 c-cpp 를 그대로 쓴다. 추가 비용이 사실상 없다.
        // 오래된 교재 코드나 대회 규정이 C++17 을 요구하는 경우가 있다
        id: "cpp17",
        label: "C++17 (g++ 14)",
        sourceName: "Main.cc",
        extension: "cc",
        runner: "c-cpp",
        compile: {
            argv: ["/usr/bin/g++", "-x", "c++", "-std=gnu++17", "-O2", "-w", "-static", "-o", "Main", "Main.cc"],
            limits: COMPILE_LIMITS,
            artifacts: ["Main"],
        },
        run: { argv: ["./Main"], timeFactorPercent: 100, timeExtraMs: 0, memoryExtraKb: 0, procLimit: 1 },
        editorMode: "cpp",
    },
    {
        id: "c99",
        label: "C99 (gcc 14)",
        sourceName: "Main.c",
        extension: "c",
        runner: "c-cpp",
        compile: {
            argv: ["/usr/bin/gcc", "-x", "c", "-std=gnu99", "-O2", "-w", "-static", "-o", "Main", "Main.c", "-lm"],
            limits: COMPILE_LIMITS,
            artifacts: ["Main"],
        },
        run: { argv: ["./Main"], timeFactorPercent: 100, timeExtraMs: 0, memoryExtraKb: 0, procLimit: 1 },
        editorMode: "c",
    },
    {
        id: "python3",
        label: "Python 3.13",
        sourceName: "Main.py",
        extension: "py",
        runner: "python",
        compile: {
            // 진짜 컴파일은 아니고 문법 검사. 이게 없으면 SyntaxError 가 CE 가 아니라 RE 로 잡혀서
            // 학생이 원인을 못 찾는다. 부산물 __pycache__ 는 실행 박스로 안 넘김
            argv: ["/usr/bin/python3", "-m", "py_compile", "Main.py"],
            limits: COMPILE_LIMITS,
            artifacts: ["Main.py"],
        },
        run: {
            argv: ["/usr/bin/python3", "-S", "Main.py"],
            timeFactorPercent: 300,
            timeExtraMs: 2000,
            memoryExtraKb: 32 * 1024,
            procLimit: 1,
        },
        editorMode: "python",
    },
    {
        id: "java",
        label: "Java 21",
        sourceName: "Main.java",
        extension: "java",
        runner: "java",
        compile: {
            argv: ["/usr/bin/javac", "-J-Xms64m", "-J-Xmx512m", "-encoding", "UTF-8", "Main.java"],
            limits: { ...COMPILE_LIMITS, procLimit: 128 },
            // 내부 클래스가 Main$1.class 로 떨어지므로 개별 파일명이 아니라 박스 전체를 넘긴다.
            // "*" 는 워커가 박스 디렉터리 통째 복사로 해석함
            artifacts: ["*"],
        },
        run: {
            // SerialGC: 병렬 GC 스레드가 CPU 시간 측정을 흔들어서 같은 코드가 돌 때마다 다른 시간이 나옴.
            // -Xss 는 재귀 깊은 풀이 대응
            argv: [
                "/usr/bin/java",
                "-XX:+UseSerialGC",
                "-XX:-UsePerfData",
                "-Xss64m",
                "-Xms{memMb}m",
                "-Xmx{memMb}m",
                "-Dfile.encoding=UTF-8",
                "Main",
            ],
            timeFactorPercent: 200,
            timeExtraMs: 2000,
            // JVM 이 힙 밖에서 먹는 몫(메타스페이스, 코드캐시, 스레드 스택)
            memoryExtraKb: 256 * 1024,
            procLimit: 128,
        },
        editorMode: "java",
    },
    {
        /**
         * PyPy. 경쟁 프로그래밍에서 가치가 제일 크다. 같은 파이썬 코드가 5~20배 빨라져서
         * CPython 으로는 시간 초과인 풀이가 통과한다.
         *
         * 시간 배율을 CPython(300%)보다 낮게 잡는다. JIT 웜업이 있어 100% 로는 빠듯하다.
         */
        id: "pypy3",
        label: "PyPy 3",
        sourceName: "Main.py",
        extension: "py",
        runner: "pypy",
        compile: {
            argv: ["/usr/bin/pypy3", "-m", "py_compile", "Main.py"],
            limits: COMPILE_LIMITS,
            artifacts: ["Main.py"],
        },
        run: {
            argv: ["/usr/bin/pypy3", "-S", "Main.py"],
            timeFactorPercent: 150,
            timeExtraMs: 1000,
            // JIT 가 코드를 들고 있어 CPython 보다 기본 메모리를 더 쓴다
            memoryExtraKb: 96 * 1024,
            procLimit: 1,
        },
        editorMode: "python",
    },
    {
        id: "javascript",
        label: "Node.js 22",
        sourceName: "Main.js",
        extension: "js",
        runner: "node",
        compile: {
            // 문법 검사만. 이게 없으면 SyntaxError 가 컴파일 에러가 아니라 런타임 에러로 잡힌다
            argv: ["/usr/bin/node", "--check", "Main.js"],
            limits: COMPILE_LIMITS,
            artifacts: ["Main.js"],
        },
        run: {
            argv: ["/usr/bin/node", "Main.js"],
            timeFactorPercent: 200,
            timeExtraMs: 1000,
            memoryExtraKb: 64 * 1024,
            // V8 이 GC 와 컴파일 스레드를 띄운다
            procLimit: 16,
        },
        editorMode: "javascript",
    },
] as const;

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));

export type LanguageId = (typeof LANGUAGES)[number]["id"];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id) as [string, ...string[]];

export function getLanguage(id: string): LanguageSpec | undefined {
    return BY_ID.get(id);
}

/** 미지원 언어를 조용히 통과시키지 않는다. KOJ 는 여기서 nil 을 반환해 채점 이미지가 죽었다 */
export function requireLanguage(id: string): LanguageSpec {
    const lang = BY_ID.get(id);
    if (!lang) throw new Error(`unsupported language: ${id}`);
    return lang;
}

export const RUNNER_IDS: readonly RunnerId[] = ["c-cpp", "python", "java", "pypy", "node"];

/** 문제 제한에 언어 보정을 먹인 실제 실행 상한 */
export function effectiveRunLimits(
    lang: LanguageSpec,
    problemTimeMs: number,
    problemMemoryMb: number,
): StepLimits {
    const timeMs = Math.round((problemTimeMs * lang.run.timeFactorPercent) / 100) + lang.run.timeExtraMs;
    return {
        timeMs,
        // 벽시계는 CPU 상한의 2배 + 1초. 무한루프가 아니라 블로킹으로 매달리는 경우를 끊는다
        wallMs: timeMs * 2 + 1000,
        memoryKb: problemMemoryMb * 1024 + lang.run.memoryExtraKb,
        procLimit: lang.run.procLimit,
    };
}

/** argv 의 {memMb} 치환. JVM 힙 지정처럼 문제 제한을 인자로 받아야 하는 언어가 있다 */
export function resolveRunArgv(lang: LanguageSpec, problemMemoryMb: number): string[] {
    return lang.run.argv.map((a) => a.replaceAll("{memMb}", String(problemMemoryMb)));
}
