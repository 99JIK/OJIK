/**
 * 테스트용 DB 주소.
 *
 * TEST_DATABASE_URL 을 주면 그걸 쓰고, 없으면 DATABASE_URL 의 데이터베이스 이름에
 * _test 를 붙인다. 따로 적게 하면 둘이 어긋나서 "테스트가 개발 DB 를 비웠다" 가 된다.
 *
 * scripts 와 tests 가 같은 값을 봐야 해서 한곳에 둔다.
 */
export function testDatabaseUrl(): string {
    const explicit = process.env.TEST_DATABASE_URL;
    if (explicit) return explicit;

    const base = process.env.DATABASE_URL;
    if (!base) {
        throw new Error("DATABASE_URL 이 없습니다. 저장소 루트의 .env 를 보세요.");
    }

    const u = new URL(base);
    const name = u.pathname.slice(1) || "oj";
    u.pathname = `/${name}_test`;
    return u.toString();
}
