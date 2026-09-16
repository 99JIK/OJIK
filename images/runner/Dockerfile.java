ARG BASE=ojik-runner-base:latest
FROM ${BASE}

# headless 면 충분하다. AWT 를 끌고 오면 이미지가 수백 MB 더 커진다
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends openjdk-21-jdk-headless; \
    rm -rf /var/lib/apt/lists/*

# Debian 의 OpenJDK 는 실행 파일과 설정을 /etc 를 거쳐 잇는다.
#   /usr/bin/java            -> /etc/alternatives/java
#   $JDK/conf/security/*     -> /etc/java-21-openjdk/security/*
#
# isolate 기본 디렉터리 규칙에는 /etc 가 없다. 그래서 샌드박스 안에서 이 링크들이 전부 끊기고,
# javac 는 "No such file or directory", java 는 "Error loading java.security file" 로 죽는다.
#
# --dir=/etc 로 열어 주면 한 줄로 끝나지만 제출 코드에 /etc 를 통째로 보여주게 된다.
# 링크를 실파일로 바꿔서 JDK 가 /usr 안에서 자립하게 만든다.
RUN set -eux; \
    for bin in java javac; do \
        ln -sf "$(readlink -f "/usr/bin/$bin")" "/usr/bin/$bin"; \
    done; \
    J=/usr/lib/jvm/java-21-openjdk-amd64; \
    find "$J" -type l | while read -r link; do \
        # 끊어진 링크(src.zip)에서 readlink 가 실패한다. set -e 에 걸리지 않게 받아 낸다
        target="$(readlink -f "$link" 2>/dev/null || true)"; \
        case "$target" in /usr/*) continue ;; esac; \
        rm -f "$link"; \
        if [ -n "$target" ] && [ -e "$target" ]; then cp -a "$target" "$link"; fi; \
        :; \
    done

# /usr 밖을 가리키는 링크가 남아 있으면 그 언어는 샌드박스에서 못 돈다. 빌드에서 막는다
RUN set -eux; \
    outside=$(find /usr/lib/jvm /usr/bin/java /usr/bin/javac -type l 2>/dev/null \
        | while read -r l; do case "$(readlink -f "$l")" in /usr/*) ;; *) echo "$l" ;; esac; done); \
    if [ -n "$outside" ]; then \
        echo "아직 /usr 밖을 가리키는 링크가 있습니다:"; echo "$outside"; exit 1; \
    fi; \
    echo "JDK 가 /usr 안에서 자립함"

RUN java -version && javac -version
