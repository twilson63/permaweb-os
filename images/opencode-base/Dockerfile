FROM ghcr.io/anomalyco/opencode:latest

ENV OPENCODE_HOST=0.0.0.0
ENV OPENCODE_PORT=4096
ENV HOME=/home/opencode

# Install Node.js, dev tools, and common utilities
RUN apk add --no-cache \
    nodejs npm \
    git \
    make cmake gcc g++ \
    python3 py3-pip \
    rust cargo \
    go \
    jq yq \
    curl wget \
    zip unzip \
    bash zsh \
    htop \
    netcat-openbsd

# Create user and set permissions
RUN addgroup -S opencode && adduser -S -G opencode -h /home/opencode opencode

# Copy entrypoint with proper permissions
COPY --chmod=755 entrypoint.sh /usr/local/bin/opencode-entrypoint

USER opencode
WORKDIR /workspace

EXPOSE 4096

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD /bin/sh -c 'nc -z 127.0.0.1 "$OPENCODE_PORT" || exit 1'

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint"]