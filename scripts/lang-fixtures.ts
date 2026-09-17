import type { LanguageId } from "@ojik/core";

/**
 * 언어별 확인용 소스.
 *
 * 스모크 테스트가 등록된 전 언어를 한 번씩 돌리는 데 쓴다. 언어를 추가하면 여기에도
 * 한 항목을 넣어야 하고, 안 넣으면 스모크가 "확인용 소스가 없습니다"라고 알린다.
 * 등록만 해 놓고 실제로는 안 도는 상태를 막는 장치다.
 *
 * 세 가지를 확인한다.
 *   ok       정상 동작. 3 4 를 읽어 7 을 낸다
 *   loop     무한 루프. 시간 초과로 끊겨야 한다
 *   compile  문법 오류. 컴파일 단계에서 잡혀야 한다
 *
 * 문자열은 배열 join 으로 만든다. 템플릿 리터럴에 \n 을 넣으면 편집 도구를 거치면서
 * 진짜 개행으로 바뀌어 소스가 깨지는 일이 있었다.
 */
export interface LangFixture {
    ok: string;
    loop: string;
    compile: string;
}

const NL = String.fromCharCode(92, 110); // 소스 안에 넣을 두 글자 \n

const lines = (...xs: string[]) => xs.join("\n") + "\n";

const C_OK = lines(
    "#include <stdio.h>",
    "int main(void){",
    "    int a, b;",
    '    if (scanf("%d %d", &a, &b) != 2) return 1;',
    `    printf("%d${NL}", a + b);`,
    "    return 0;",
    "}",
);
const CPP_OK = lines(
    "#include <iostream>",
    "int main(){",
    "    int a, b;",
    "    std::cin >> a >> b;",
    `    std::cout << a + b << "${NL}";`,
    "}",
);
const C_LOOP = lines("int main(void){ for(;;); }");
const CPP_LOOP = lines("int main(){ for(;;); }");
const C_BAD = lines("int main(void){ this is not c }");
const CPP_BAD = lines("int main(){ this is not c++ }");

const PY_OK = lines("a, b = map(int, input().split())", "print(a + b)");
const PY_LOOP = lines("while True:", "    pass");
const PY_BAD = lines("def f(:");

export const FIXTURES: Partial<Record<LanguageId, LangFixture>> = {
    c: { ok: C_OK, loop: C_LOOP, compile: C_BAD },
    c99: { ok: C_OK, loop: C_LOOP, compile: C_BAD },
    cpp: { ok: CPP_OK, loop: CPP_LOOP, compile: CPP_BAD },
    cpp17: { ok: CPP_OK, loop: CPP_LOOP, compile: CPP_BAD },

    python3: { ok: PY_OK, loop: PY_LOOP, compile: PY_BAD },
    pypy3: { ok: PY_OK, loop: PY_LOOP, compile: PY_BAD },

    java: {
        ok: lines(
            "import java.util.*;",
            "public class Main {",
            "    public static void main(String[] args) {",
            "        Scanner sc = new Scanner(System.in);",
            "        System.out.println(sc.nextInt() + sc.nextInt());",
            "    }",
            "}",
        ),
        loop: lines("public class Main { public static void main(String[] a){ while(true){} } }"),
        compile: lines("public class Main { this is not java }"),
    },

    javascript: {
        // isolate 는 stdin 을 파일로 넘긴다. fd 0 을 직접 읽는 게 가장 확실하다.
        // /dev/stdin 은 샌드박스의 최소 /dev 에 없을 수 있다
        ok: lines(
            'const data = require("fs").readFileSync(0, "utf8");',
            "const [a, b] = data.trim().split(/\\s+/).map(Number);",
            "console.log(a + b);",
        ),
        loop: lines("while (true) {}"),
        compile: lines("function f( {"),
    },
};
