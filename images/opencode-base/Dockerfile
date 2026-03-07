FROM ghcr.io/anomalyco/opencode:latest

ENV OPENCODE_HOST=0.0.0.0
ENV OPENCODE_PORT=4096
ENV HOME=/home/opencode
ENV PATH=/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}

RUN apk add --no-cache \
    bash \
    coreutils \
    curl \
    git \
    netcat-openbsd \
    ruby \
    wget

RUN addgroup -S opencode && adduser -S -G opencode -h /home/opencode opencode

RUN mkdir -p /home/linuxbrew/.linuxbrew /home/opencode/.cache/Homebrew \
    && chown -R opencode:opencode /home/linuxbrew /home/opencode

RUN su opencode -s /bin/bash -c 'NONINTERACTIVE=1 CI=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

COPY entrypoint.sh /usr/local/bin/opencode-entrypoint
RUN chmod +x /usr/local/bin/opencode-entrypoint

USER opencode
WORKDIR /workspace

EXPOSE 4096

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD /bin/sh -c 'nc -z 127.0.0.1 "$OPENCODE_PORT" || exit 1'

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint"]
